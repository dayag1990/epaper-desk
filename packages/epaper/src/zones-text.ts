import type { Zone } from "@epaper/core";
import { bestArticle } from "./match.js";
import type { ArticleRef, Miss, TextLine, TextPage } from "./types.js";
import { round } from "./util.js";

type Rect = [number, number, number, number];
interface Head { lines: TextLine[]; x0: number; x1: number; y0: number; y1: number; text: string; h: number }

const lh = (l: TextLine) => l.y1 - l.y0;

/** Most common line height, weighted by characters: the body text size. */
export function bodyHeight(lines: TextLine[]): number {
  const w = new Map<number, number>();
  for (const l of lines) { const k = Math.round(lh(l) * 2) / 2; w.set(k, (w.get(k) ?? 0) + l.text.length); }
  let best = 12, bw = -1;
  for (const [k, v] of w) if (v > bw) { best = k; bw = v; }
  return best;
}

/** Headline candidates: lines clearly taller than body text, stacked lines of one headline merged. */
function headlines(lines: TextLine[], body: number): Head[] {
  const cand = lines.filter((l) => lh(l) >= body * 1.45).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const heads: Head[] = [];
  for (const l of cand) {
    const h = heads.find((g) => Math.abs(g.x0 - l.x0) < 3 && Math.abs(g.h - lh(l)) < g.h * 0.15 && l.y0 - g.y1 < g.h * 0.6 && l.y0 >= g.y0);
    if (h) {
      h.lines.push(l); h.y1 = Math.max(h.y1, l.y1); h.x1 = Math.max(h.x1, l.x1);
      h.text += " " + l.text;
    } else heads.push({ lines: [l], x0: l.x0, x1: l.x1, y0: l.y0, y1: l.y1, text: l.text, h: lh(l) });
  }
  return heads;
}

export interface TextZoning {
  zones: Zone[];
  misses: Miss[];
}

/**
 * Rule-based story zoning from the text layer only (no AI):
 * 1. headline = lines much taller than the body size, merged when stacked;
 * 2. a headline becomes a story when it matches an article headline (fuzzy);
 * 3. every other line joins the nearest headline above it whose column span it starts inside
 *    (column gaps and the headline above/beside it decide), small type right above a headline
 *    is its kicker; page furniture in the bottom band is ignored;
 * 4. the zone is the bounding box of the headline and its lines, as 0-1 fractions.
 */
export function zoneFromTextLayer(page: TextPage, articles: ArticleRef[], opts: { minScore?: number; idPrefix?: string } = {}): TextZoning {
  const minScore = opts.minScore ?? 0.6;
  const body = bodyHeight(page.lines);
  const lines = page.lines.filter((l) => !(l.y0 > page.h * 0.96 && lh(l) < body));
  const heads = headlines(lines, body);

  // Match headlines to articles, one article per headline, best scores first.
  const scored = heads
    .map((h) => ({ h, m: bestArticle(h.text, articles, minScore) }))
    .filter((x): x is { h: Head; m: { article: ArticleRef; score: number } } => x.m !== null)
    .sort((a, b) => b.m.score - a.m.score);
  const taken = new Set<string>();
  const stories: { h: Head; article: ArticleRef; score: number; lines: TextLine[] }[] = [];
  const misses: Miss[] = [];
  const matchedHeads = new Set<Head>();
  for (const s of scored) {
    if (taken.has(s.m.article.id)) continue;
    taken.add(s.m.article.id);
    matchedHeads.add(s.h);
    stories.push({ h: s.h, article: s.m.article, score: s.m.score, lines: [] });
  }
  const headLines = new Set(heads.flatMap((h) => h.lines));

  // Large type that matched nothing is furniture (masthead, running head) or a miss when it looks like a story.
  for (const h of heads) {
    if (matchedHeads.has(h)) continue;
    const below = lines.filter((l) => !headLines.has(l) && l.y0 >= h.y1 - 2 && l.x0 >= h.x0 - 4 && l.x0 <= h.x1 && l.y0 - h.y1 < body * 1.5).length;
    if (below >= 2) misses.push({ page: page.page, title: h.text, reason: "headline matched no article", rect: [h.x0 / page.w, h.y0 / page.h, (h.x1 - h.x0) / page.w, (h.y1 - h.y0) / page.h] });
  }

  const owned = new Set<TextLine>();
  // Kickers: small type directly above a headline.
  for (const s of stories) {
    for (const l of lines) {
      if (headLines.has(l) || owned.has(l) || lh(l) >= body) continue;
      if (l.y1 <= s.h.y0 + 2 && s.h.y0 - l.y1 < body * 0.9 && l.x0 >= s.h.x0 - 4 && l.x0 <= s.h.x1) { s.lines.push(l); owned.add(l); }
    }
  }
  for (const l of lines) {
    if (headLines.has(l) || owned.has(l)) continue;
    let best: (typeof stories)[number] | null = null;
    for (const s of stories) {
      if (s.h.y1 > l.y0 + 2 || l.x0 < s.h.x0 - 4 || l.x0 > s.h.x1 + 4) continue;
      if (!best || s.h.y1 > best.h.y1) best = s;
    }
    if (best) { best.lines.push(l); owned.add(l); }
  }

  const zones: Zone[] = [];
  stories.sort((a, b) => a.h.y0 - b.h.y0 || a.h.x0 - b.h.x0);
  stories.forEach((s, i) => {
    const all = [...s.h.lines, ...s.lines];
    const x0 = Math.max(0, Math.min(...all.map((l) => l.x0)));
    const y0 = Math.max(0, Math.min(...all.map((l) => l.y0)));
    const x1 = Math.min(page.w, Math.max(...all.map((l) => l.x1)));
    const y1 = Math.min(page.h, Math.max(...all.map((l) => l.y1)));
    const rect: Rect = [round(x0 / page.w), round(y0 / page.h), round((x1 - x0) / page.w), round((y1 - y0) / page.h)];
    rect[2] = Math.min(rect[2], round(1 - rect[0])); rect[3] = Math.min(rect[3], round(1 - rect[1]));
    const confidence = round(Math.min(1, s.score * (s.lines.length >= 3 ? 1 : 0.7)), 3);
    zones.push({
      id: `z_${opts.idPrefix ?? `p${page.page}`}_${i + 1}` as Zone["id"],
      article_id: s.article.id as Zone["article_id"],
      title: s.article.headline,
      url: s.article.url ?? null,
      rects: [rect],
      confidence,
      source: "auto",
    });
  });
  return { zones, misses };
}

/** Without articles: zones with the headline text as title and no article link. */
export function zoneFromTextLayerUnlinked(page: TextPage, opts: { idPrefix?: string } = {}): TextZoning {
  // Every large-type headline matches itself.
  const body = bodyHeight(page.lines);
  const texts = headlines(page.lines, body).map((h, i) => ({ id: `art_unlinked${page.page}x${i}`, headline: h.text, url: null }));
  const z = zoneFromTextLayer(page, texts as unknown as ArticleRef[], { ...opts, minScore: 0.99 });
  for (const zone of z.zones) { zone.article_id = null; zone.confidence = Math.min(zone.confidence, 0.4); }
  return z;
}
