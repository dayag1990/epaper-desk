import * as cheerio from "cheerio";
import { z } from "zod";
import type { Mapping, RawItem } from "@epaper/core";
import type { Adapter, ArticleDraft, IngestContext } from "./types.js";
import { RejectError } from "./types.js";
import { PoliteFetcher, type Fetcher } from "./fetcher.js";
import { applyMapping } from "./expr.js";
import { completeDraft } from "./ingest.js";
import { absUrl } from "./util.js";
import { parseFeed } from "./rss.js";
import { XMLParser } from "fast-xml-parser";

/** Article-looking page URLs from a sitemap (one level of sitemap index followed), newest first when dated. */
export async function listSitemapUrls(fetcher: Fetcher, url: string, obey = true, depth = 0): Promise<string[]> {
  const res = await fetcher.get(url, { accept: "application/xml, text/xml", skipRobots: !obey });
  const doc: any = new XMLParser({ ignoreAttributes: true }).parse(res.text);
  const arr = (x: any) => (x == null ? [] : Array.isArray(x) ? x : [x]);
  if (doc?.sitemapindex && depth < 1) {
    const out: string[] = [];
    for (const sm of arr(doc.sitemapindex.sitemap).slice(0, 5)) {
      try { out.push(...(await listSitemapUrls(fetcher, String(sm.loc), obey, depth + 1))); } catch { /* skip a broken child */ }
    }
    return out;
  }
  const host = new URL(res.url).host;
  const rows = arr(doc?.urlset?.url)
    .map((u: any) => ({ loc: String(u.loc ?? "").trim(), last: String(u.lastmod ?? "") }))
    .filter((r) => { try { const p = new URL(r.loc); return p.host === host && p.pathname !== "/" && !SKIP_PATH.test(p.pathname) && !/index\.html?$/i.test(p.pathname); } catch { return false; } });
  rows.sort((a, b) => b.last.localeCompare(a.last));
  return rows.map((r) => r.loc);
}

/** The generic HTML door ("scrape" in the spec). For sites the paper owns or has rights to. */
export const HtmlConfigSchema = z
  .object({
    /** index pages that list articles */
    list: z.array(z.string().url()).default([]),
    /** article pages given directly */
    pages: z.array(z.string().url()).default([]),
    /** CSS selector for the links on an index page. Left out: the link finder guesses. */
    link_selector: z.string().optional(),
    obey_robots: z.boolean().default(true),
    max_links: z.number().int().positive().max(100).default(30),
    /** a sitemap.xml to list article pages from */
    sitemap: z.string().url().optional(),
    /** an RSS/Atom feed used only to list article links; the text still comes from the page */
    feed: z.string().url().optional(),
  })
  .refine((c) => c.list.length + c.pages.length > 0 || c.sitemap || c.feed, { message: "give at least one index page (list), article page (pages), sitemap or feed" });
export type HtmlConfig = z.infer<typeof HtmlConfigSchema>;

export const HTML_DEFAULT_MAPPING: Mapping = {
  headline: "jsonld:headline || css:article h1 || css:h1 || meta:og:title || css:title",
  subhead: "css:.standfirst,.dek,.subhead,.subtitle,.lede,.article-summary | text || meta:og:description || meta:description",
  body:
    "css:[itemprop=articleBody] | blocks || css:.entry-content,.post-content,.article-body,.story-body,.article-content | blocks || readable: | blocks",
  byline: "jsonld:author.name || meta:author || css:[rel=author],.byline,.author | text",
  published_at: "jsonld:datePublished || meta:article:published_time || css:time[datetime]@datetime || meta:date",
  updated_at: "jsonld:dateModified || meta:article:modified_time || meta:og:updated_time",
  section: "jsonld:articleSection || meta:article:section",
  tags: "meta:keywords",
  lang: "css:html@lang",
  "images[0].src": "jsonld:image.url || jsonld:image || meta:og:image || meta:twitter:image || css:article img@src",
  "images[0].caption": "css:article figure figcaption | text",
};

const SKIP_PATH = /^\/(tag|tags|category|categories|author|authors|page|search|about|contact|login|feed|wp-|cart|privacy|terms)(\/|$)|\.(jpe?g|png|gif|webp|svg|pdf|css|js|xml|zip)$/i;

export interface FoundLink { url: string; text: string; score: number }

/** Index page -> article links, by rules: headline-like anchors outside nav/header/footer. */
export function findArticleLinks(html: string, pageUrl: string, selector?: string): FoundLink[] {
  const $ = cheerio.load(html);
  const host = new URL(pageUrl).host;
  const found = new Map<string, FoundLink>();
  const anchors = selector ? $(selector).filter("a").add($(selector).find("a")) : $("a[href]");
  anchors.each((i, a) => {
    const url = absUrl($(a).attr("href"), pageUrl);
    if (!url) return;
    const u = new URL(url);
    if (u.host !== host || u.pathname === "/" || u.pathname === new URL(pageUrl).pathname) return;
    if (SKIP_PATH.test(u.pathname)) return;
    const text = $(a).text().replace(/\s+/g, " ").trim() || ($(a).find("img").attr("alt") ?? "").trim();
    let score = selector ? 10 : 0;
    if ($(a).closest("h1,h2,h3,h4").length) score += 3;
    if ($(a).closest("article,li.post,.post,.story,.entry,.card").length) score += 2;
    if (text.length >= 25) score += 2;
    else if (text.length < 8) score -= 2;
    const slug = u.pathname.split("/").filter(Boolean).pop() ?? "";
    if (/-/.test(slug) && slug.split("-").length >= 3) score += 1;
    if (u.pathname.split("/").filter(Boolean).length >= 2) score += 1;
    if ($(a).closest("nav,header,footer,aside,[role=navigation]").length) score -= 4;
    const prev = found.get(url);
    // the same article often has a picture link and a headline link; keep the best text
    if (!prev || score > prev.score || (score === prev.score && text.length > prev.text.length)) found.set(url, { url, text, score: Math.max(score, prev?.score ?? -99) });
  });
  return [...found.values()].filter((l) => l.score >= 3).sort((a, b) => b.score - a.score);
}

export function createHtmlConnector(fetcher: Fetcher = new PoliteFetcher()): Adapter<HtmlConfig> {
  return {
    kind: "scrape",
    configSchema: HtmlConfigSchema as unknown as z.ZodType<HtmlConfig>,
    defaultMapping: HTML_DEFAULT_MAPPING,
    async *discover(cfg) {
      const seen = new Set<string>();
      for (const p of cfg.pages) if (!seen.has(p)) { seen.add(p); yield { url: p }; }
      const extra: string[] = [];
      if (cfg.sitemap) extra.push(...(await listSitemapUrls(fetcher, cfg.sitemap, cfg.obey_robots)).slice(0, cfg.max_links));
      if (cfg.feed) {
        const res = await fetcher.get(cfg.feed, { skipRobots: !cfg.obey_robots });
        extra.push(...parseFeed(res.text, res.url).map((i) => i.link).filter(Boolean).slice(0, cfg.max_links));
      }
      for (const u of extra) if (!seen.has(u)) { seen.add(u); yield { url: u }; }
      for (const idx of cfg.list) {
        const res = await fetcher.get(idx, { accept: "text/html", skipRobots: !cfg.obey_robots });
        let n = 0;
        for (const l of findArticleLinks(res.text, res.url, cfg.link_selector)) {
          if (n >= cfg.max_links) break;
          if (seen.has(l.url)) continue;
          seen.add(l.url);
          n++;
          yield { url: l.url };
        }
      }
    },
    async fetch(cfg, ref): Promise<RawItem> {
      const url = (ref as { url: string }).url;
      const res = await fetcher.get(url, { accept: "text/html", skipRobots: !cfg.obey_robots });
      return { ref, format: "html", data: { html: res.text, url: res.url }, fetchedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") };
    },
    normalize(raw: RawItem, mapping: Mapping | undefined, ctx: IngestContext): ArticleDraft | null {
      return htmlToDraft(raw, mapping ?? HTML_DEFAULT_MAPPING, ctx);
    },
  };
}

export function htmlToDraft(raw: RawItem, mapping: Mapping, ctx: IngestContext): ArticleDraft {
  const d = raw.data as { html: string; url: string };
  if (!d?.html) throw new RejectError("The page came back empty.");
  const $ = cheerio.load(d.html);
  const p = applyMapping(mapping, { $, url: d.url }, { maps: ctx.maps });
  return completeDraft(p, { url: d.url, ctx, fetchedAt: raw.fetchedAt });
}
