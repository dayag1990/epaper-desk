import type { ArticleRef } from "./types.js";

export const normalize = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** 0-1 similarity of two headlines: half token Dice, half edit-distance ratio. */
export function similarity(a: string, b: string): number {
  const x = normalize(a), y = normalize(b);
  if (!x || !y) return 0;
  const ta = x.split(" "), tb = y.split(" ");
  const bag = new Map<string, number>();
  for (const t of tb) bag.set(t, (bag.get(t) ?? 0) + 1);
  let hit = 0;
  for (const t of ta) { const c = bag.get(t) ?? 0; if (c > 0) { hit++; bag.set(t, c - 1); } }
  const dice = (2 * hit) / (ta.length + tb.length);
  const ed = 1 - lev(x, y) / Math.max(x.length, y.length);
  return 0.5 * dice + 0.5 * ed;
}

/** Best article for a headline, or null under minScore. */
export function bestArticle(text: string, articles: ArticleRef[], minScore: number): { article: ArticleRef; score: number } | null {
  let best: { article: ArticleRef; score: number } | null = null;
  for (const article of articles) {
    const score = similarity(text, article.headline);
    if (!best || score > best.score) best = { article, score };
  }
  return best && best.score >= minScore ? best : null;
}
