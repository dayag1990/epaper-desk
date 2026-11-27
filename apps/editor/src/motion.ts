import { useEffect, type RefObject } from "react";

/**
 * Blocks glide to their new place (about 180 ms, ease-out) when the page is laid out again: a refit, a move, a resize.
 * The page's HTML is replaced as a whole, so there is nothing for CSS to transition; instead each block's old box (page
 * coordinates, so the zoom does not matter) is compared with its new one and the block is animated from old to new (FLIP).
 * It stays still: while a drag is in progress, while someone is typing, when the person asked for less motion, and when the
 * set of blocks differs (another page, a story added or removed). The paper's own CSS is not touched.
 */
export const GLIDE_MS = 180;
const TYPING_QUIET_MS = 900;

type Box = { x: number; y: number; w: number; h: number };

export function readBoxes(stage: HTMLElement): Map<string, Box> {
  const out = new Map<string, Box>();
  const page = stage.querySelector<HTMLElement>(".page");
  if (!page) return out;
  const pr = page.getBoundingClientRect();
  const z = page.offsetWidth ? pr.width / page.offsetWidth : 1;
  stage.querySelectorAll<HTMLElement>(".story[data-item]").forEach((el) => {
    const r = el.getBoundingClientRect();
    out.set(el.dataset.item!, { x: (r.left - pr.left) / z, y: (r.top - pr.top) / z, w: r.width / z, h: r.height / z });
  });
  return out;
}

/** Pure part: which blocks moved, and from where (in page pixels). Same set of blocks required. */
export function movedBlocks(prev: Map<string, Box>, next: Map<string, Box>, minPx = 1): Array<{ id: string; dx: number; dy: number; sx: number; sy: number }> {
  if (!prev.size || prev.size !== next.size) return [];
  const out: Array<{ id: string; dx: number; dy: number; sx: number; sy: number }> = [];
  for (const [id, n] of next) {
    const o = prev.get(id);
    if (!o) return [];
    if (Math.abs(o.x - n.x) < minPx && Math.abs(o.y - n.y) < minPx && Math.abs(o.w - n.w) < minPx && Math.abs(o.h - n.h) < minPx) continue;
    out.push({ id, dx: o.x - n.x, dy: o.y - n.y, sx: n.w ? o.w / n.w : 1, sy: n.h ? o.h / n.h : 1 });
  }
  return out;
}

export function useBlockMotion(ref: RefObject<HTMLElement | null>, ready: boolean) {
  useEffect(() => {
    const stage = ref.current;
    if (!ready) return;
    if (!stage || typeof MutationObserver === "undefined") return;
    let prev = readBoxes(stage);
    let lastKey = -1e9;
    const typed = () => { lastKey = performance.now(); };
    stage.addEventListener("keydown", typed, true);
    stage.addEventListener("beforeinput", typed, true);
    const resettle = () => { prev = readBoxes(stage); };
    document.fonts?.addEventListener?.("loadingdone", resettle);
    let running = 0; // glides in progress: measuring now would read the animated boxes, so wait for them to end
    const mo = new MutationObserver((recs) => {
      if (running) return;
      if (recs.every((r) => (r.target as Element).closest?.(".pvo"))) return; // selection frame and handles are not the page
      if (stage.querySelector(".pvw.dragging")) return; // nothing moves during a drag (only the ghost); compare with the state before it
      const next = readBoxes(stage);
      const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
      const busy = performance.now() - lastKey < TYPING_QUIET_MS;
      if (!reduce && !busy && typeof Element.prototype.animate === "function") {
        const moved = movedBlocks(prev, next);
        for (const m of moved) {
          const el = stage.querySelector<HTMLElement>(`.story[data-item="${CSS.escape(m.id)}"]`);
          if (!el) continue;
          running++;
          const a = el.animate(
            [{ transform: `translate(${m.dx}px, ${m.dy}px) scale(${m.sx}, ${m.sy})`, transformOrigin: "0 0" }, { transform: "none", transformOrigin: "0 0" }],
            { duration: GLIDE_MS, easing: "ease-out" },
          );
          const end = () => { if (--running === 0) prev = readBoxes(stage); };
          a.finished.then(end, end);
        }
        if (moved.length) stage.dataset.glide = String(Number(stage.dataset.glide ?? 0) + 1); // how many times blocks glided (so tests can see it ran)
      }
      prev = next;
    });
    mo.observe(stage, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
    return () => { mo.disconnect(); document.fonts?.removeEventListener?.("loadingdone", resettle); stage.removeEventListener("keydown", typed, true); stage.removeEventListener("beforeinput", typed, true); };
  }, [ref, ready]);
}
