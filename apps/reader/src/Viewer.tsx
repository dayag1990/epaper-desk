import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { hitTest, levelForZoom, type Rect } from "./lib/zones";
import type { PageInfo, Zone } from "./lib/types";

interface View { s: number; tx: number; ty: number }
interface Props {
  page: PageInfo;
  zones: Zone[];
  marks: Rect[];
  showAll: boolean;
  onSwipe(dir: 1 | -1): void;
  onZone(z: Zone): void;
  onEmpty(): void;
}
const MAX = 6;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function Viewer({ page, zones, marks, showAll, onSwipe, onZone, onEmpty }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 400, h: 600 });
  const [v, setV] = useState<View>({ s: 1, tx: 0, ty: 0 });
  const [hot, setHot] = useState<string | null>(null);
  const [hiLoaded, setHiLoaded] = useState<string>("");
  const vr = useRef(v); vr.current = v;
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const g = useRef({ x0: 0, y0: 0, t0: 0, moved: 0, pinch: 0, base: v, lastTap: { t: 0, x: 0, y: 0 }, timer: 0 as number });

  useLayoutEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  useEffect(() => { setV({ s: 1, tx: 0, ty: 0 }); setHot(null); }, [page.no]);

  const aspect = page.image.w / page.image.h;
  const pw = Math.min(size.w, size.h * aspect), ph = pw / aspect;
  const ox = (size.w - pw) / 2, oy = (size.h - ph) / 2;

  const fix = (n: View): View => {
    const s = clamp(n.s, 1, MAX);
    const cw = pw * s, ch = ph * s;
    const tx = cw <= size.w ? 0 : clamp(n.tx, size.w - cw - ox, -ox);
    const ty = ch <= size.h ? 0 : clamp(n.ty, size.h - ch - oy, -oy);
    return { s, tx, ty };
  };
  /** Zoom to scale s keeping the stage point (px, py) fixed. */
  const zoomAt = (base: View, s: number, px: number, py: number): View => {
    const k = clamp(s, 1, MAX) / base.s;
    return fix({ s: base.s * k, tx: px - ox - (px - ox - base.tx) * k, ty: py - oy - (py - oy - base.ty) * k });
  };
  const stagePt = (e: PointerEvent) => { const r = box.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  const levels = Object.keys(page.images).map(Number);
  const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
  const level = levels.length ? levelForZoom(v.s, pw, dpr, levels) : 0;
  const lowest = Math.min(...levels);
  const hiUrl = page.images[level];

  const tap = (p: { x: number; y: number }) => {
    const fx = (p.x - ox - vr.current.tx) / (pw * vr.current.s), fy = (p.y - oy - vr.current.ty) / (ph * vr.current.s);
    const z = fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1 ? hitTest(zones, fx, fy) : null;
    if (z) { setHot(z.id); onZone(z); } else { setHot(null); onEmpty(); }
  };

  const down = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const p = stagePt(e);
    ptrs.current.set(e.pointerId, p);
    const st = g.current;
    if (ptrs.current.size === 1) { st.x0 = p.x; st.y0 = p.y; st.t0 = Date.now(); st.moved = 0; }
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      st.pinch = Math.hypot(a.x - b.x, a.y - b.y); st.base = vr.current; st.moved = 99;
    }
  };
  const move = (e: PointerEvent) => {
    const old = ptrs.current.get(e.pointerId);
    if (!old) return;
    const p = stagePt(e);
    ptrs.current.set(e.pointerId, p);
    const st = g.current;
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (st.pinch > 0) setV(zoomAt(st.base, st.base.s * (d / st.pinch), (a.x + b.x) / 2, (a.y + b.y) / 2));
      return;
    }
    st.moved = Math.max(st.moved, Math.hypot(p.x - st.x0, p.y - st.y0));
    if (vr.current.s > 1 && ptrs.current.size === 1) setV(fix({ ...vr.current, tx: vr.current.tx + p.x - old.x, ty: vr.current.ty + p.y - old.y }));
  };
  const up = (e: PointerEvent) => {
    const p = ptrs.current.get(e.pointerId);
    ptrs.current.delete(e.pointerId);
    const st = g.current;
    if (!p || ptrs.current.size > 0) return;
    const dx = p.x - st.x0, dy = p.y - st.y0;
    if (st.moved < 10 && Date.now() - st.t0 < 500) {
      const lt = st.lastTap, now = Date.now();
      if (now - lt.t < 320 && Math.hypot(p.x - lt.x, p.y - lt.y) < 30) {
        clearTimeout(st.timer);
        st.lastTap = { t: 0, x: 0, y: 0 };
        const cur = vr.current.s;
        setV(zoomAt(vr.current, cur < 2 ? 2.5 : cur < 4.5 ? 5 : 1, p.x, p.y));
      } else {
        st.lastTap = { t: now, x: p.x, y: p.y };
        // wait out a possible second tap before acting
        st.timer = window.setTimeout(() => tap(p), 260);
      }
    } else if (vr.current.s <= 1.01 && Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) {
      onSwipe(dx < 0 ? 1 : -1);
    }
  };
  const wheel = (e: WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey) && vr.current.s <= 1) return;
    e.preventDefault();
    const r = box.current!.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) setV(zoomAt(vr.current, vr.current.s * Math.exp(-e.deltaY / 300), e.clientX - r.left, e.clientY - r.top));
    else setV(fix({ ...vr.current, tx: vr.current.tx - e.deltaX, ty: vr.current.ty - e.deltaY }));
  };
  useEffect(() => { const el = box.current!; el.addEventListener("wheel", wheel, { passive: false }); return () => el.removeEventListener("wheel", wheel); });
  useEffect(() => () => clearTimeout(g.current.timer), []);

  const zoomBtn = (f: number) => setV(zoomAt(vr.current, vr.current.s * f, size.w / 2, size.h / 2));
  const rectStyle = (r: readonly number[]) => ({ left: `${r[0] * 100}%`, top: `${r[1] * 100}%`, width: `${r[2] * 100}%`, height: `${r[3] * 100}%` });

  return (
    <div class="stage" ref={box} data-testid="stage" data-zoom={v.s.toFixed(2)} data-level={level}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div class="sheet" style={{ left: ox, top: oy, width: pw, height: ph, transform: `translate(${v.tx}px,${v.ty}px) scale(${v.s})` }}>
        <img class="base" src={page.images[lowest]} alt={`Page ${page.no}`} draggable={false} />
        {level !== lowest && (
          <img class="hi" src={hiUrl} draggable={false} alt="" style={{ opacity: hiLoaded === hiUrl ? 1 : 0 }}
            onLoad={() => setHiLoaded(hiUrl)} />
        )}
        <div class="zones">
          {zones.map((z) => z.rects.map((r, i) => (
            <div key={z.id + i} class={"zone" + (showAll ? " all" : "") + (hot === z.id ? " hot" : "")}
              data-zone={z.id} style={rectStyle(r)} />
          )))}
          {marks.map((r, i) => <div key={"m" + i} class="mark" style={rectStyle(r)} />)}
        </div>
      </div>
      <div class="zoombtns">
        <button aria-label="Zoom in" onClick={() => zoomBtn(1.6)}>+</button>
        <button aria-label="Zoom out" onClick={() => zoomBtn(1 / 1.6)}>−</button>
      </div>
    </div>
  );
}
