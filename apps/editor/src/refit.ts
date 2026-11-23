import type { PageDoc } from "@epaper/core";
import { domFill, domFrames, fitBodySize, fitLabel, fitState, lowResCheck, pxToPt, round, type FitState, type Template } from "./layout";

/** Stable signature of a doc for "did anything the reader can see change?" (ignores server rev, status and the fitted text size). */
export function docSig(d: PageDoc): string {
  const { rev: _r, status: _s, ...rest } = d;
  return JSON.stringify({ ...rest, page: { ...d.page, body_pt: 0 } });
}
/** Full signature including the fitted size: what must be saved. */
export function saveSig(d: PageDoc): string {
  const { rev: _r, ...rest } = d;
  return JSON.stringify(rest);
}

/**
 * Refit trigger rule: any change to what is on the page (text, widths, columns, headline size, photos,
 * order, page size, furniture) re-runs the fit. A change to only the server rev, status or the fitted text
 * size does not (that is the fit's own output, and re-running on it would loop).
 */
export function needsRefit(prev: PageDoc | undefined, next: PageDoc): boolean {
  if (!prev) return true;
  return docSig(prev) !== docSig(next);
}

export interface Meter {
  pct: number;
  state: FitState;
  label: string;
  pt: number;
  bodyPx: number;
  lowRes: string[];
}

/**
 * Measure + fit the page that is in the DOM right now (the editor keeps exactly one `.page` mounted).
 * Same loop the server runs: start at the template's start size, step down until it fits or hits the minimum.
 */
export function refitDom(doc: PageDoc, t: Template): Meter {
  const args = { padTB: t.pad.top + t.pad.bottom, canvas: t.canvas_px, wmm: doc.page.w_mm, hmm: doc.page.h_mm };
  const r = fitBodySize((px) => domFill({ ...args, fsPx: px }), { start: Math.min(t.body.start_px, t.body.max_px), min: t.body.min_px, step: t.body.step_px });
  const pct = Math.round(r.fill * 100);
  const pt = round(pxToPt(r.px, t), 3);
  const low: string[] = [];
  try {
    for (const fr of domFrames().frames) {
      if (fr.role !== "image" || !fr.natW) continue;
      const c = lowResCheck(fr.natW, fr.w * doc.page.w_mm);
      if (c.low) low.push(`Photo is small for print (${fr.natW}px, wants ${Math.round(c.needPx)}px)`);
    }
  } catch {
    /* measuring is best effort */
  }
  return { pct, state: fitState(pct), label: fitLabel(pct, pt), pt, bodyPx: r.px, lowRes: low };
}
