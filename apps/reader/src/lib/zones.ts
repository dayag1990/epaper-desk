import type { TextPage, Zone } from "./types";

export type Rect = [number, number, number, number]; // x, y, w, h as 0-1

const area = (z: Zone) => z.rects.reduce((a, r) => a + r[2] * r[3], 0);
const inRect = (r: readonly number[], x: number, y: number) => x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3];

/** Zone under a point given as 0-1 fractions of the page image. Smallest zone wins when they overlap. */
export function hitTest(zones: readonly Zone[], x: number, y: number): Zone | null {
  let best: Zone | null = null;
  for (const z of zones) {
    if (!z.rects.some((r) => inRect(r, x, y))) continue;
    if (!best || area(z) < area(best)) best = z;
  }
  return best;
}

/** Smallest image level that still gives ~1 image px per device px; the largest when none is enough. */
export function levelForZoom(zoom: number, cssWidth: number, dpr: number, levels: readonly number[]): number {
  const sorted = [...levels].sort((a, b) => a - b);
  const need = cssWidth * zoom * dpr;
  return sorted.find((l) => l >= need * 0.9) ?? sorted[sorted.length - 1];
}

/** Plain text of the lines whose centre lies inside the zone, in reading order (by column then y). */
export function zoneText(text: TextPage, zone: Zone): string[] {
  const out: string[] = [];
  for (const r of zone.rects) {
    const lines = text.lines
      .filter((l) => inRect(r, (l.x0 + l.x1) / 2 / text.w, (l.y0 + l.y1) / 2 / text.h))
      .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    for (const l of lines) out.push(l.text);
  }
  return out;
}
