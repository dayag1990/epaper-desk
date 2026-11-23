import type { Template } from "./template.js";

/** CSS px on the template canvas -> pt on the printed page (prototype pt()). */
export const pxToPt = (px: number, t: Pick<Template, "size" | "canvas_px">): number =>
  (px * t.size.w_mm) / t.canvas_px / 25.4 * 72;
export const ptToPx = (pt: number, t: Pick<Template, "size" | "canvas_px">): number =>
  (pt * t.canvas_px * 25.4) / (72 * t.size.w_mm);
export const round = (v: number, d: number): number => {
  const k = 10 ** d;
  return Math.round(v * k) / k;
};
