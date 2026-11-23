import type { LayoutSnapshot, Zone } from "@epaper/core";
import { bestArticle } from "./match.js";
import type { ArticleRef } from "./types.js";
import { round } from "./util.js";

type Frame = LayoutSnapshot["pages"][number]["frames"][number];

const STORY_ROLES = new Set(["kicker", "head", "sub", "body", "image"]);

const frac = (v: number, total: number) => Math.min(1, Math.max(0, round(v / total)));

function rectOf(frames: Frame[], w: number, h: number): [number, number, number, number] {
  const x0 = Math.min(...frames.map((f) => f.x)), y0 = Math.min(...frames.map((f) => f.y));
  const x1 = Math.max(...frames.map((f) => f.x + f.w)), y1 = Math.max(...frames.map((f) => f.y + f.h));
  const x = frac(x0, w), y = frac(y0, h);
  return [x, y, Math.min(frac(x1 - x0, w), round(1 - x)), Math.min(frac(y1 - y0, h), round(1 - y))];
}

/**
 * Snapshot prior: map D4 mm frames to 0-1 fractions of the page. One zone per item, whose rect is the
 * bounding box of its kicker/head/sub/body/image frames; ads get a zone with article_id null.
 * The article comes from `itemArticles` or, failing that, the head frame text matched to headlines.
 */
export function zoneFromSnapshot(
  page: LayoutSnapshot["pages"][number],
  articles: ArticleRef[],
  opts: { itemArticles?: Record<string, string>; minScore?: number } = {},
): Zone[] {
  const byItem = new Map<string, Frame[]>();
  for (const f of page.frames) {
    if (f.role !== "ad" && !STORY_ROLES.has(f.role)) continue;
    (byItem.get(f.item) ?? byItem.set(f.item, []).get(f.item)!).push(f);
  }
  const byId = new Map(articles.map((a) => [a.id as string, a]));
  const zones: Zone[] = [];
  let n = 0;
  for (const [item, frames] of byItem) {
    const rect = rectOf(frames, page.w, page.h);
    const isAd = frames.every((f) => f.role === "ad");
    const head = frames.find((f) => f.role === "head");
    let article: ArticleRef | undefined;
    let confidence = 1;
    if (!isAd) {
      const mapped = opts.itemArticles?.[item];
      article = mapped ? byId.get(mapped) : undefined;
      if (!article && head?.text) {
        const m = bestArticle(head.text, articles, opts.minScore ?? 0.6);
        if (m) article = m.article;
      }
      if (!article) confidence = 0.5;
    }
    n++;
    zones.push({
      id: `z_s${page.no}_${n}` as Zone["id"],
      article_id: (isAd ? null : article?.id ?? null) as Zone["article_id"],
      title: isAd ? "Advertisement" : article?.headline ?? head?.text ?? item,
      url: article?.url ?? null,
      rects: [rect],
      confidence,
      source: "snapshot",
    });
  }
  return zones;
}
