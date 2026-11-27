import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PageDoc } from "@epaper/core";
import type { Article } from "@epaper/core";
import { domReady, renderPage, type Template } from "./layout";
import { fontBase } from "./config";
import { docSig, refitDom, type Meter } from "./refit";
import { BLOCK_LABELS, applyText, type StylePatch, type TextSnapshot } from "./tools";
import type { BlockStyle } from "@epaper/core";
import { COLS_STEP_PX, COLUMNS, DRAG_THRESHOLD_PX, colsFromDrag, dropIndex, predictSlot, readoutText, rowBottom, rowTop, rowsOf, spanFromLeft, spanFromRight, type Rect } from "./flow";
import { defaultSpan, dropcapAllowed } from "./layout";
import type { ToolAction } from "./tools";

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** Read the typed text back out of the page DOM (the prototype kept state in the DOM; we copy it into the PageDoc). */
export function readText(root: HTMLElement): TextSnapshot {
  const items: TextSnapshot["items"] = [];
  root.querySelectorAll<HTMLElement>(".story[data-item]").forEach((s) => {
    const o: TextSnapshot["items"][number] = { id: s.dataset.item! };
    const k = s.querySelector(".kicker");
    if (k) o.kicker = norm(k.textContent);
    const h = s.querySelector(".head");
    if (h) o.head = norm(h.textContent);
    const sub = s.querySelector(".sub");
    if (sub) o.sub = norm(sub.textContent);
    const by = s.querySelector(".byline");
    if (by) o.byline = norm(by.textContent);
    const b = s.querySelector(".body");
    if (b) {
      const paras: string[] = [];
      // the cut-out photo and its caption sit inside the text columns but are not typed text
      b.childNodes.forEach((n) => { if ((n as HTMLElement).hasAttribute?.("data-noedit")) return; const t = norm(n.textContent); if (t) paras.push(t); });
      o.body = paras;
    }
    items.push(o);
  });
  const out: TextSnapshot = { items };
  const mast = root.querySelector(".mast");
  const strip = root.querySelector(".strip");
  if (mast || strip) {
    out.furniture = {};
    if (mast) {
      out.furniture.masthead = norm(mast.querySelector(".name")?.textContent);
      out.furniture.tagline = norm(mast.querySelector(".tag")?.textContent);
    }
    if (strip) out.furniture.strip = Array.from(strip.querySelectorAll("span")).map((e) => norm(e.textContent));
  }
  return out;
}

const isRuledTemplate = (t: { finish?: { ruled?: boolean } }) => !!t.finish && t.finish.ruled !== false;

export type Edge = "e" | "w" | "s";
export interface PageViewProps {
  doc: PageDoc;
  template: Template;
  articles: readonly Article[];
  editable: boolean;
  zoom: number;
  selected: string | null;
  onEdit(doc: PageDoc, key: string): void;
  onSelect(id: string | null): void;
  onPickImage(itemId: string): void;
  onMeter(m: Meter): void;
  /** Keyboard step on the selected block (same tool actions as the toolbar). */
  onKeyStep(action: ToolAction, itemId: string): void;
  /** Drop: put the item at this index of the page's item order. */
  onMoveTo(itemId: string, toIndex: number): void;
  /** Edge handle: "e"/"w" give the new width in columns, "s" the new text columns. */
  onResize(itemId: string, edge: Edge, value: number): void;
  /** The block's Style control (newspaper finish): plain / boxed brief / pull quote / tinted panel, and the drop cap. */
  onStyle?(itemId: string, patch: StylePatch): void;
}

interface Box { x: number; y: number; w: number; h: number; span: number; cols: number; index: number; total: number }
type Drag =
  | { kind: "move"; id: string; x: number; y: number; w: number; h: number; mark: { x: number; y: number; w: number; h: number; col: number; row: number; index: number; span: number } }
  | { kind: "resize"; id: string; edge: Edge; x: number; y: number; w: number; h: number; span: number; cols: number };
interface Geo { wr: DOMRect; gx: number; gy: number; gw: number; gh: number; gap: number; pitch: number; scale: number; rects: Rect[] }

const FIELD = "[data-ce]";
const HANDLES: { id: string; label: string; edge: Edge | "move"; cls: string }[] = [
  { id: "nw", label: "Resize width from the top left corner", edge: "w", cls: "nw" },
  { id: "n", label: "Move this block (drag to another place)", edge: "move", cls: "n" },
  { id: "ne", label: "Resize width from the top right corner", edge: "e", cls: "ne" },
  { id: "w", label: "Resize width from the left edge", edge: "w", cls: "w" },
  { id: "e", label: "Resize width from the right edge", edge: "e", cls: "e" },
  { id: "sw", label: "Resize width from the bottom left corner", edge: "w", cls: "sw" },
  { id: "s", label: "Change text columns from the bottom edge", edge: "s", cls: "s" },
  { id: "se", label: "Resize width from the bottom right corner", edge: "e", cls: "se" },
];

export function PageView(p: PageViewProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const sigRef = useRef("");
  const docRef = useRef(p.doc);
  docRef.current = p.doc;
  const props = useRef(p);
  props.current = p;
  const raf = useRef(0);
  const editScope = useRef<HTMLElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [box, setBox] = useState<Box | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [gridBox, setGridBox] = useState<{ x: number; y: number; w: number; h: number; gap: number } | null>(null);
  const suppressClick = useRef(false);
  const refocus = useRef(false);
  const lastTap = useRef<{ t: number; x: number; y: number; id: string } | null>(null);

  /** Rendered geometry in wrapper coordinates (screen px, already scaled by the editor zoom: read from the DOM, never from template numbers). */
  const geo = (): Geo | null => {
    const w = wrap.current, h = host.current;
    const page = h?.querySelector<HTMLElement>(".page"), grid = h?.querySelector<HTMLElement>(".grid");
    if (!w || !h || !page || !grid) return null;
    const wr = w.getBoundingClientRect(), gr = grid.getBoundingClientRect(), pr = page.getBoundingClientRect();
    const scale = pr.width / props.current.template.canvas_px;
    const gap = props.current.template.gap.col_px * scale;
    const cols = props.current.template.columns;
    const pitch = (gr.width + gap) / cols;
    const rects: Rect[] = Array.from(h.querySelectorAll<HTMLElement>(".story[data-item]")).map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.item!, x: r.left - wr.left, y: r.top - wr.top, w: r.width, h: r.height };
    });
    return { wr, gx: gr.left - wr.left, gy: gr.top - wr.top, gw: gr.width, gh: gr.height, gap, pitch, scale, rects };
  };

  const updateBox = () => {
    const h = host.current, w = wrap.current;
    const id = props.current.selected;
    const st = id && h ? h.querySelector<HTMLElement>(`.story[data-item="${CSS.escape(id)}"]`) : null;
    if (!st || !w) { setBox(null); return; }
    const wr = w.getBoundingClientRect(), r = st.getBoundingClientRect();
    const all = Array.from(h!.querySelectorAll(".story[data-item]"));
    const nb: Box = { x: r.left - wr.left, y: r.top - wr.top, w: r.width, h: r.height, span: +st.dataset.span!, cols: +st.dataset.cols!, index: all.indexOf(st), total: all.length };
    setBox((o) => (o && Object.keys(nb).every((k) => Math.abs((o as never)[k] - (nb as never)[k]) < 0.01) ? o : nb));
  };

  /** The page is laid out at canvas size and scaled by a transform (see css.ts), so the host box gets the scaled size explicitly. */
  const fitHost = () => {
    const h = host.current, pg = h?.querySelector<HTMLElement>(".page");
    if (!h || !pg) return;
    const z = props.current.zoom;
    h.style.width = `${pg.offsetWidth * z}px`;
    h.style.height = `${pg.offsetHeight * z}px`;
  };

  /** Selection state on the rendered blocks: class, role, aria-pressed, focusable. */
  const decorate = () => {
    host.current?.querySelectorAll<HTMLElement>(".story[data-item]").forEach((e) => {
      const on = e.dataset.item === props.current.selected;
      e.classList.toggle("sel", on);
      e.setAttribute("role", "button");
      e.setAttribute("tabindex", "0");
      e.setAttribute("aria-pressed", on ? "true" : "false");
      e.setAttribute("aria-label", `Story block: ${e.querySelector(".head")?.textContent || "untitled"}`);
    });
  };
  const measure = () => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(async () => {
      if (!host.current?.querySelector(".page")) return;
      await domReady();
      const q = props.current;
      if (!host.current?.querySelector(".page")) return;
      q.onMeter(refitDom(docRef.current, q.template));
      updateBox();
    });
  };

  const enterEdit = (scope: HTMLElement, field?: HTMLElement | null, at?: { x: number; y: number }) => {
    if (!props.current.editable) return;
    const fields = Array.from(scope.querySelectorAll<HTMLElement>(FIELD));
    if (!fields.length) return;
    if (editScope.current !== scope) {
      leaveEdit(false);
      fields.forEach((f) => f.setAttribute("contenteditable", "true"));
      // a cut-out photo inside the body text is not typed text: keep it out of the editable area
      scope.querySelectorAll<HTMLElement>("[data-noedit]").forEach((n) => n.setAttribute("contenteditable", "false"));
      editScope.current = scope;
      setEditing(true);
    }
    const f = field && fields.includes(field) ? field : fields.find((x) => x.classList.contains("head")) ?? fields[0]!;
    f.focus({ preventScroll: true });
    const sel = getSelection();
    let range: Range | null = null;
    if (at && document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(at.x, at.y);
      if (r && f.contains(r.startContainer)) range = r;
    }
    if (!range) { range = document.createRange(); range.selectNodeContents(f); range.collapse(false); }
    sel?.removeAllRanges();
    sel?.addRange(range);
  };
  const leaveEdit = (focusBlock: boolean) => {
    const sc = editScope.current;
    if (!sc) return;
    sc.querySelectorAll<HTMLElement>(FIELD).forEach((f) => f.removeAttribute("contenteditable"));
    sc.querySelectorAll<HTMLElement>("[data-noedit]").forEach((n) => n.removeAttribute("contenteditable"));
    editScope.current = null;
    setEditing(false);
    getSelection()?.removeAllRanges();
    if (focusBlock && sc.matches(".story")) sc.focus({ preventScroll: true });
    else (document.activeElement as HTMLElement | null)?.blur?.();
  };

  const imgKey = p.articles.map((a) => a.images.map((i) => i.asset_id + i.src).join(",")).join("|");
  const sig = `${docSig(p.doc)}#${p.template.id}#${p.editable}#${imgKey}`;
  useEffect(() => {
    const h = host.current!;
    if (sig !== sigRef.current) {
      sigRef.current = sig;
      const hadFocus = refocus.current || !!(document.activeElement && h.contains(document.activeElement));
      refocus.current = false;
      const r = renderPage(p.doc, p.template, p.articles, { editable: p.editable, fontBase: fontBase() });
      h.innerHTML = `<style>${r.css}\n.story.sel{outline:4px solid #1a73e8;outline-offset:4px}[contenteditable]:focus{outline:none}</style>${r.html}`;
      // Nothing is editable until a double click / Enter; the renderer's editing aids are parked in data-ce.
      h.querySelectorAll("[contenteditable]").forEach((e) => { e.removeAttribute("contenteditable"); e.setAttribute("data-ce", "1"); });
      editScope.current = null;
      setEditing(false);
      h.querySelector<HTMLElement>(".page")!.style.setProperty("--z", String(props.current.zoom));
      fitHost();
      decorate();
      if (hadFocus && props.current.selected) h.querySelector<HTMLElement>(`.story[data-item="${CSS.escape(props.current.selected)}"]`)?.focus({ preventScroll: true });
      measure();
    }
  });
  useLayoutEffect(() => {
    host.current?.querySelector<HTMLElement>(".page")?.style.setProperty("--z", String(p.zoom));
    fitHost();
  }, [p.zoom]);
  useEffect(() => {
    measure();
    updateBox();
  }, [p.zoom]);
  useEffect(() => {
    const h = host.current!;
    decorate();
    if (editScope.current && editScope.current.matches(".story") && (editScope.current as HTMLElement).dataset.item !== p.selected) leaveEdit(false);
    updateBox();
  });
  useEffect(() => {
    const h = host.current;
    const page = h?.querySelector(".page");
    if (!h || !page || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { fitHost(); updateBox(); });
    ro.observe(page);
    const on = () => updateBox();
    addEventListener("resize", on);
    return () => { ro.disconnect(); removeEventListener("resize", on); };
  }, [sig]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const storyOf = (t: EventTarget | null) => (t as HTMLElement | null)?.closest?.(".story[data-item]") as HTMLElement | null;
  const scopeOf = (t: EventTarget | null) => (t as HTMLElement | null)?.closest?.(".story[data-item], .mast, .strip") as HTMLElement | null;

  /** Window-level pointer gesture: move/up until released. */
  const track = (e: { pointerId: number }, onMove: (ev: PointerEvent) => void, onUp: (ev: PointerEvent) => void) => {
    const mv = (ev: PointerEvent) => { if (ev.pointerId === e.pointerId) onMove(ev); };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      removeEventListener("pointermove", mv); removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
      onUp(ev);
    };
    addEventListener("pointermove", mv); addEventListener("pointerup", up); addEventListener("pointercancel", up);
  };

  /** After a drag or resize the browser still sends a click to whichever element is above both ends: swallow it. */
  const swallowNextClick = () => {
    const f = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
    addEventListener("click", f, { capture: true, once: true });
    setTimeout(() => removeEventListener("click", f, true), 80);
  };
  const startMove = (e: { pointerId: number; clientX: number; clientY: number }, id: string) => {
    const g0 = geo();
    if (!g0) return;
    const sx = e.clientX, sy = e.clientY;
    let started = false;
    track(e, (ev) => {
      if (!started && Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_THRESHOLD_PX) return;
      started = true;
      const g = geo();
      if (!g) return;
      const px = ev.clientX - g.wr.left, py = ev.clientY - g.wr.top;
      const from = g.rects.findIndex((r) => r.id === id);
      const me = g.rects[from]!;
      const to = dropIndex(g.rects, id, px, py);
      const spans = docRef.current.items.map((i) => i.span ?? defaultSpan(i, props.current.template.columns));
      const slot = predictSlot(spans, from, to, props.current.template.columns);
      const rows = rowsOf(g.rects);
      const row = rows[slot.row];
      const y = row ? rowTop(row) : (rows.length ? rowBottom(rows[rows.length - 1]!) + g.gap : g.gy);
      const hgt = row ? rowBottom(row) - rowTop(row) : 80 * g.scale;
      setGridBox({ x: g.gx, y: g.gy, w: g.gw, h: g.gh, gap: g.gap });
      setDrag({ kind: "move", id, x: px - me.w / 2, y: py - 12, w: me.w, h: Math.min(me.h, 120 * g.scale), mark: { x: g.gx + slot.col * g.pitch, y, w: slot.span * g.pitch - g.gap, h: hgt, col: slot.col, row: slot.row, index: to, span: slot.span } });
    }, () => {
      const d = dragRef.current;
      setDrag(null); setGridBox(null);
      if (!started) return;
      suppressClick.current = true;
      swallowNextClick();
      if (d && d.kind === "move") {
        refocus.current = true;
        const from = docRef.current.items.findIndex((i) => i.id === id);
        if (d.mark.index !== from) props.current.onMoveTo(id, d.mark.index);
      }
    });
  };
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  const startResize = (e: React.PointerEvent, edge: Edge) => {
    const id = props.current.selected;
    const g0 = geo();
    if (!id || !g0 || !props.current.editable) return;
    const me0 = g0.rects.find((r) => r.id === id)!;
    const st = host.current!.querySelector<HTMLElement>(`.story[data-item="${CSS.escape(id)}"]`)!;
    const span0 = +st.dataset.span!, cols0 = +st.dataset.cols!;
    const startY = e.clientY - g0.wr.top;
    track(e.nativeEvent, (ev) => {
      const g = geo();
      if (!g) return;
      const px = ev.clientX - g.wr.left, py = ev.clientY - g.wr.top;
      const me = g.rects.find((r) => r.id === id) ?? me0;
      setGridBox({ x: g.gx, y: g.gy, w: g.gw, h: g.gh, gap: g.gap });
      if (edge === "e") {
        const span = spanFromRight(px, me.x, g.pitch, g.gap, props.current.template.columns);
        setDrag({ kind: "resize", id, edge, x: me.x, y: me.y, w: span * g.pitch - g.gap, h: me.h, span, cols: cols0 });
      } else if (edge === "w") {
        const span = spanFromLeft(px, me.x + me.w, g.pitch, g.gap, props.current.template.columns);
        const w = span * g.pitch - g.gap;
        setDrag({ kind: "resize", id, edge, x: me.x + me.w - w, y: me.y, w, h: me.h, span, cols: cols0 });
      } else {
        const cols = colsFromDrag(cols0, startY, py, span0, COLS_STEP_PX * g.scale);
        setDrag({ kind: "resize", id, edge, x: me.x, y: me.y, w: me.w, h: Math.max(24, py - me.y), span: span0, cols });
      }
    }, () => {
      const d = dragRef.current;
      setDrag(null); setGridBox(null);
      if (!d || d.kind !== "resize") return;
      swallowNextClick();
      refocus.current = true;
      const val = edge === "s" ? d.cols : d.span;
      if (val !== (edge === "s" ? cols0 : span0)) props.current.onResize(id, edge, val);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const q = props.current;
    if (editScope.current) {
      if (e.key === "Escape") { e.preventDefault(); leaveEdit(true); return; }
      if (e.key === "Enter" && !(e.target as HTMLElement).closest(".body")) e.preventDefault();
      return;
    }
    const st = storyOf(e.target);
    if (!st || st.dataset.item !== q.selected) return;
    const id = st.dataset.item!;
    if (e.key === "Escape") { e.preventDefault(); q.onSelect(null); (document.activeElement as HTMLElement | null)?.blur?.(); return; }
    if (!q.editable) return; // read-only: selection only
    if (e.key === "Enter") { e.preventDefault(); enterEdit(st, st.querySelector<HTMLElement>(".head")); return; }
    const arrows: Record<string, [ToolAction, ToolAction]> = { ArrowLeft: ["mv-", "span-"], ArrowRight: ["mv+", "span+"], ArrowUp: ["row-", "cols-"], ArrowDown: ["row+", "cols+"] };
    const a = arrows[e.key];
    if (a && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); refocus.current = true; q.onKeyStep(e.shiftKey ? a[1] : a[0], id); return; }
    if (e.key === "Backspace" || e.key === "Delete" || e.key === " " || (e.key.length === 1 && !e.ctrlKey && !e.metaKey)) e.preventDefault();
  };

  const showHandles = p.editable && !editing && !!box;
  const selItem = p.selected ? p.doc.items.find((i) => i.id === p.selected) : undefined;
  const styleOk = showHandles && !drag && !!selItem && selItem.kind !== "ad" && !!p.onStyle && isRuledTemplate(p.template);
  const dcOk = !!selItem && dropcapAllowed(selItem.text?.body?.[0] ?? "", p.template);
  return (
    <div
      ref={wrap}
      className={`pvw ${drag ? "dragging" : ""}`}
      onClick={(e) => {
        if (suppressClick.current) { suppressClick.current = false; return; }
        if (!storyOf(e.target) && !(e.target as HTMLElement).closest?.(".mast, .strip, .pvo")) p.onSelect(null);
      }}
    >
      <div
        ref={host}
        className={`pv ${editing ? "editing" : ""}`}
        data-testid="page-canvas"
        onClick={(e) => {
          if (suppressClick.current) { suppressClick.current = false; e.stopPropagation(); return; }
          const st = storyOf(e.target);
          if (st) p.onSelect(st.dataset.item!);
          else if (!(e.target as HTMLElement).closest(".mast, .strip")) p.onSelect(null);
          const empty = (e.target as HTMLElement).closest(".fig.empty");
          if (empty && p.editable && st) p.onPickImage(st.dataset.item!);
          e.stopPropagation();
        }}
        onPointerDown={(e) => {
          suppressClick.current = false;
          if (e.button !== 0) return;
          const st = storyOf(e.target);
          if (!st) return;
          const id = st.dataset.item!;
          if (editScope.current === st) return; // caret placement inside the block being edited
          if (editScope.current) leaveEdit(false);
          if (props.current.selected !== id) p.onSelect(id);
          if (e.pointerType === "touch") {
            const now = Date.now(), lt = lastTap.current;
            if (lt && lt.id === id && now - lt.t < 400 && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < 30) {
              lastTap.current = null;
              if (props.current.editable) enterEdit(st, (e.target as HTMLElement).closest<HTMLElement>(FIELD), { x: e.clientX, y: e.clientY });
              return;
            }
            lastTap.current = { t: now, x: e.clientX, y: e.clientY, id };
            return; // on touch only the move handle drags, so the page can still scroll
          }
          if (props.current.editable && !(e.target as HTMLElement).closest(".fig.empty")) startMove(e.nativeEvent, id);
        }}
        onDoubleClick={(e) => {
          const sc = scopeOf(e.target);
          if (!sc || !p.editable || editScope.current === sc) return;
          enterEdit(sc, (e.target as HTMLElement).closest<HTMLElement>(FIELD), { x: e.clientX, y: e.clientY });
        }}
        onFocus={(e) => { const st = storyOf(e.target); if (st && st.dataset.item !== props.current.selected) p.onSelect(st.dataset.item!); }}
        onInput={() => {
          const nd = applyText(docRef.current, readText(host.current!));
          if (nd === docRef.current) return;
          const key = `text:${(document.activeElement as HTMLElement | null)?.closest?.(".story")?.getAttribute("data-item") ?? "furniture"}:${document.activeElement?.className ?? ""}`;
          sigRef.current = `${docSig(nd)}#${props.current.template.id}#${props.current.editable}#${imgKey}`;
          p.onEdit(nd, key);
          measure(); // refit trigger: every edit re-measures and re-fits the page
        }}
        onKeyDown={onKeyDown}
        onPaste={(e) => {
          e.preventDefault();
          const t = e.clipboardData?.getData("text/plain") ?? "";
          document.execCommand("insertText", false, t);
        }}
      />
      {box && (
        <div className="pvo" aria-hidden={false}>
          {gridBox && (
            <div className="gridov" data-testid="grid-overlay" style={{ left: gridBox.x, top: gridBox.y, width: gridBox.w, height: gridBox.h, columnGap: gridBox.gap }}>
              {Array.from({ length: COLUMNS }, (_, i) => <i key={i} className="gcol" />)}
            </div>
          )}
          <div className={`selframe ${editing ? "is-editing" : ""}`} data-testid="sel-frame" style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
            {showHandles && HANDLES.map((h) => (
              <button
                key={h.id}
                type="button"
                tabIndex={-1}
                className={`hnd hnd-${h.cls}`}
                data-testid={`handle-${h.id}`}
                data-handle={h.id}
                aria-label={h.label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault(); e.stopPropagation();
                  if (h.edge === "move") startMove(e.nativeEvent, props.current.selected!);
                  else startResize(e, h.edge);
                }}
              />
            ))}
          </div>
          {styleOk && selItem && (
            <div className="styleinsp" data-testid="style-control" style={{ left: box.x, top: box.y + box.h + 34 }} onClick={(e) => e.stopPropagation()}>
              <label>
                <span>Style</span>
                <select
                  data-testid="style-select"
                  aria-label="Block style"
                  value={selItem.block ?? "plain"}
                  onChange={(e) => p.onStyle!(selItem.id, { block: e.target.value as BlockStyle })}
                >
                  {(Object.keys(BLOCK_LABELS) as BlockStyle[]).map((k) => <option key={k} value={k}>{BLOCK_LABELS[k]}</option>)}
                </select>
              </label>
              <label className={dcOk ? "" : "off"} title={dcOk ? undefined : "A drop cap only looks right in English (Latin) text, so it is switched off for this story."}>
                <input
                  type="checkbox"
                  data-testid="dropcap-toggle"
                  checked={!!selItem.dropcap && dcOk}
                  disabled={!dcOk || selItem.block === "quote"}
                  onChange={(e) => p.onStyle!(selItem.id, { dropcap: e.target.checked })}
                />
                <span>Drop cap</span>
              </label>
              {selItem.block === "quote" && <small>A pull quote prints the headline as the quote and the sub-headline as who said it. The story text is kept, just not printed here.</small>}
            </div>
          )}
          <div className="readout" role="status" data-testid="sel-readout" data-span={box.span} data-cols={box.cols} data-place={box.index + 1} style={{ left: box.x, top: box.y + box.h + 6 }}>
            {readoutText(box.span, box.cols, box.index, box.total)}
          </div>
          {drag?.kind === "move" && (
            <>
              <div className="dropmark" data-testid="drop-marker" data-col={drag.mark.col} data-row={drag.mark.row} data-index={drag.mark.index} data-span={drag.mark.span} style={{ left: drag.mark.x, top: drag.mark.y, width: drag.mark.w, height: drag.mark.h }} />
              <div className="dragghost" style={{ left: drag.x, top: drag.y, width: drag.w, height: drag.h }} />
            </>
          )}
          {drag?.kind === "resize" && (
            <div className="ghost" data-testid="resize-ghost" data-edge={drag.edge} data-span={drag.span} data-cols={drag.cols} style={{ left: drag.x, top: drag.y, width: drag.w, height: drag.h }}>
              <span>{drag.edge === "s" ? `${drag.cols} text column${drag.cols === 1 ? "" : "s"}` : `${drag.span} of ${COLUMNS} wide`}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
