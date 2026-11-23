/** Pure parts of the fit loop and the meter (ported from autoFit() / meter()). */

export interface FitParams {
  start: number;
  min: number;
  step: number;
}
export interface FitResult {
  px: number;
  fill: number; // ratio, 1 = exactly full
  overflow: boolean;
  steps: number;
}

/**
 * Prototype autoFit(): start at `start` px, step down while the page overflows and size > min.
 * Terminates: size falls by `step` each pass and stops at `min`.
 */
export function fitBodySize(fillAt: (px: number) => number, p: FitParams): FitResult {
  let f = p.start;
  let fill = fillAt(f);
  let steps = 0;
  while (fill > 1 && f > p.min) {
    f = +(f - p.step).toFixed(2);
    fill = fillAt(f);
    steps++;
  }
  return { px: f, fill, overflow: fill > 1, steps };
}

/** Same loop for a measure that has to go through the browser. */
export async function fitBodySizeAsync(fillAt: (px: number) => Promise<number>, p: FitParams): Promise<FitResult> {
  let f = p.start;
  let fill = await fillAt(f);
  let steps = 0;
  while (fill > 1 && f > p.min) {
    f = +(f - p.step).toFixed(2);
    fill = await fillAt(f);
    steps++;
  }
  return { px: f, fill, overflow: fill > 1, steps };
}

/** Prototype fillOf(): sheet height / page width, plus the page padding, over the page aspect. */
export function fillRatio(sheetH: number, pageW: number, padTB: number, canvasPx: number, pageWmm: number, pageHmm: number): number {
  if (!pageW) return 0;
  return (sheetH / pageW + padTB / canvasPx) / (pageHmm / pageWmm);
}

export type FitState = "over" | "low" | "ok";
/** Prototype meter() thresholds: >100 over, <85 low, else ok. */
export function fitState(pct: number): FitState {
  return pct > 100 ? "over" : pct < 85 ? "low" : "ok";
}
export function fitLabel(pct: number, pt: number): string {
  const s = fitState(pct);
  return (s === "over" ? `Overflow +${pct - 100}% — cut or move a story` : s === "low" ? `${pct}% full — room left` : `Fits · ${pct}% full`) + ` · text ${pt.toFixed(1)}pt`;
}

export const PRINT_DPI = 150;
/**
 * M2 rule, kept pure: pixels an image needs to print at `dpi` across a frame `frameWmm` wide.
 * (Prototype: frame width / page width * page mm / 25.4 * 150.)
 */
export function requiredPixels(frameWmm: number, dpi = PRINT_DPI): number {
  return (frameWmm / 25.4) * dpi;
}
export function effectiveDpi(naturalWidthPx: number, frameWmm: number): number {
  return frameWmm > 0 ? naturalWidthPx / (frameWmm / 25.4) : Infinity;
}
export interface LowRes {
  low: boolean;
  needPx: number;
  dpi: number;
}
/** Low-res when the image has fewer pixels than needed for 150 dpi at frame width. Unknown size (0) never warns. */
export function lowResCheck(naturalWidthPx: number, frameWmm: number, dpi = PRINT_DPI): LowRes {
  const needPx = requiredPixels(frameWmm, dpi);
  return { low: naturalWidthPx > 0 && naturalWidthPx < needPx, needPx, dpi: effectiveDpi(naturalWidthPx, frameWmm) };
}
export const lowResText = (naturalWidthPx: number, needPx: number): string =>
  `LOW-RES FOR PRINT · ${naturalWidthPx}px, needs ${Math.round(needPx)}px+`;
