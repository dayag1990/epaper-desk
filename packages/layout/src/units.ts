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

/**
 * Body size in px from the page's stored pt. The fit loop moves in steps of 0.25 px and stores pt rounded to 3 decimals;
 * rounding the px back to 2 decimals returns the exact fitted size (rounding to 3 would give 12.7504 for 12.75 and shift
 * a word that fits a line by a hair, so the editor, the fit and the PDF could break a line differently).
 */
export const storedBodyPx = (pt: number, t: Pick<Template, "size" | "canvas_px">): number => round(ptToPx(pt, t), 2);
