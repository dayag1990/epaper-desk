import type { TextPage, Zone } from "./types";
import type { Rect } from "./zones";

export interface IndexPage { page: number; text: TextPage | null; zones: readonly Zone[] }
export interface Hit { page: number; snippet: string; rects: Rect[]; kind: "story" | "text"; zoneId?: string }

/** Case/width-fold only: stripping combining marks would damage Gurmukhi and Telugu vowel signs. */
export const norm = (s: string) => s.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();

/** Search one edition: story titles first, then the text layer. Hits carry fractional rects. */
export function searchEdition(pages: readonly IndexPage[], query: string, limit = 50): Hit[] {
  const q = norm(query);
  if (q.length < 2) return [];
  const hits: Hit[] = [];
  const seenZones = new Set<string>();
  for (const p of pages) {
    for (const z of p.zones) {
      if (z.title && norm(z.title).includes(q)) {
        seenZones.add(`${p.page}:${z.id}`);
        hits.push({ page: p.page, snippet: z.title, rects: z.rects as Rect[], kind: "story", zoneId: z.id });
      }
    }
  }
  for (const p of pages) {
    const t = p.text;
    if (!t) continue;
    const lines = t.lines.map((l) => ({ l, n: norm(l.text) }));
    let joined = "";
    const starts: number[] = [];
    for (const { n } of lines) { starts.push(joined.length); joined += n + " "; }
    let from = 0;
    for (;;) {
      const at = joined.indexOf(q, from);
      if (at < 0) break;
      from = at + q.length;
      const end = at + q.length;
      const rects: Rect[] = [];
      let first = -1;
      lines.forEach(({ l, n }, i) => {
        const s = starts[i], e = s + n.length;
        if (e <= at || s >= end) return;
        if (first < 0) first = i;
        rects.push([l.x0 / t.w, l.y0 / t.h, (l.x1 - l.x0) / t.w, (l.y1 - l.y0) / t.h]);
      });
      if (first < 0) continue;
      const snippet = lines.slice(Math.max(0, first - 1), first + 2).map((x) => x.l.text).join(" ");
      // a text hit inside a story already listed by title adds nothing new
      const dup = hits.some((h) => h.kind === "story" && h.page === p.page && h.rects.some((r) => rects.every((x) => x[0] >= r[0] - 1e-3 && x[1] >= r[1] - 1e-3 && x[0] + x[2] <= r[0] + r[2] + 1e-3 && x[1] + x[3] <= r[1] + r[3] + 1e-3)) && norm(h.snippet).includes(q));
      if (!dup) hits.push({ page: p.page, snippet, rects, kind: "text" });
      if (hits.length >= limit) return hits;
    }
  }
  return hits.slice(0, limit);
}
