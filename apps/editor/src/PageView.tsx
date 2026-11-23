import { useEffect, useRef } from "react";
import type { PageDoc } from "@epaper/core";
import type { Article } from "@epaper/core";
import { domReady, renderPage, type Template } from "./layout";
import { docSig, refitDom, type Meter } from "./refit";
import { applyText, type TextSnapshot } from "./tools";

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
    const b = s.querySelector(".body");
    if (b) {
      const paras: string[] = [];
      b.childNodes.forEach((n) => { const t = norm(n.textContent); if (t) paras.push(t); });
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
}

export function PageView(p: PageViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const sigRef = useRef("");
  const docRef = useRef(p.doc);
  docRef.current = p.doc;
  const props = useRef(p);
  props.current = p;
  const raf = useRef(0);

  const measure = () => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(async () => {
      if (!host.current?.querySelector(".page")) return;
      await domReady();
      const q = props.current;
      if (!host.current?.querySelector(".page")) return;
      q.onMeter(refitDom(docRef.current, q.template));
    });
  };

  // Put the page in the DOM only when something the page shows has changed from the outside (not for our own typing).
  const imgKey = p.articles.map((a) => a.images.map((i) => i.asset_id + i.src).join(",")).join("|");
  const sig = `${docSig(p.doc)}#${p.template.id}#${p.editable}#${imgKey}`;
  useEffect(() => {
    const h = host.current!;
    if (sig !== sigRef.current) {
      sigRef.current = sig;
      const r = renderPage(p.doc, p.template, p.articles, { editable: p.editable });
      h.innerHTML = `<style>${r.css}\n.story.sel{outline:4px solid #1a73e8;outline-offset:4px}[contenteditable]:focus{outline:none}</style>${r.html}`;
      h.querySelector<HTMLElement>(".page")!.style.setProperty("--z", String(props.current.zoom));
      measure();
    }
  });
  useEffect(() => {
    host.current?.querySelector<HTMLElement>(".page")?.style.setProperty("--z", String(p.zoom));
    measure();
  }, [p.zoom]);
  useEffect(() => {
    host.current?.querySelectorAll(".story.sel").forEach((e) => e.classList.remove("sel"));
    if (p.selected) host.current?.querySelector(`.story[data-item="${CSS.escape(p.selected)}"]`)?.classList.add("sel");
  });
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const storyOf = (t: EventTarget | null) => (t as HTMLElement | null)?.closest?.(".story[data-item]") as HTMLElement | null;
  return (
    <div
      ref={host}
      className="pv"
      data-testid="page-canvas"
      onClick={(e) => {
        const st = storyOf(e.target);
        p.onSelect(st?.dataset.item ?? null);
        const empty = (e.target as HTMLElement).closest(".fig.empty");
        if (empty && p.editable && st) p.onPickImage(st.dataset.item!);
      }}
      onFocus={(e) => { const st = storyOf(e.target); if (st) p.onSelect(st.dataset.item!); }}
      onInput={() => {
        const nd = applyText(docRef.current, readText(host.current!));
        if (nd === docRef.current) return;
        const key = `text:${(document.activeElement as HTMLElement | null)?.closest?.(".story")?.getAttribute("data-item") ?? "furniture"}:${document.activeElement?.className ?? ""}`;
        sigRef.current = `${docSig(nd)}#${props.current.template.id}#${props.current.editable}#${imgKey}`;
        p.onEdit(nd, key);
        measure(); // refit trigger: every edit re-measures and re-fits the page
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !(e.target as HTMLElement).closest(".body")) e.preventDefault();
      }}
      onPaste={(e) => {
        e.preventDefault();
        const t = e.clipboardData?.getData("text/plain") ?? "";
        document.execCommand("insertText", false, t);
      }}
    />
  );
}
