import { lowResCheck, lowResText, type LowRes } from "@epaper/layout";

export interface PrintCheck extends LowRes {
  /** Plain-words warning for the editor; null when the image is big enough. Never blocks anything. */
  warning: string | null;
}

/** M2 print check, reusing @epaper/layout's rule (150 dpi at frame width). Unknown size never warns. */
export function printCheck(naturalWidthPx: number, frameWmm: number): PrintCheck {
  const r = lowResCheck(naturalWidthPx, frameWmm);
  return { ...r, warning: r.low ? lowResText(naturalWidthPx, r.needPx) : null };
}
