import * as cheerio from "cheerio";
import type { Article, Mapping } from "@epaper/core";
import { FetchError, PoliteFetcher, plainError, type Fetcher } from "./fetcher.js";
import { applyMapping, type Partial1 } from "./expr.js";
import { createHtmlConnector, findArticleLinks, listSitemapUrls, HTML_DEFAULT_MAPPING } from "./html.js";
import { createRssConnector, parseFeed, RSS_DEFAULT_MAPPING } from "./rss.js";
import { createWordpressConnector, WP_DEFAULT_MAPPING } from "./wordpress.js";
import { testSource } from "./ingest.js";
import { readableElement, selectorFor } from "./readable.js";
import { absUrl } from "./util.js";
import type { IngestContext } from "./types.js";

// The mapping wizard. Rules only: no AI, no key, no code per site.
// 1. find the best door: WordPress API, then a feed, then plain HTML pages
// 2. sample pages, try ready-made selector rules on every sample, keep the ones that work
// 3. score how sure we are, and show what the first five articles would look like

export type ProposedKind = "wordpress" | "rss" | "scrape";

export interface Discovery {
  wordpress?: string;
  feeds: string[];
  sitemaps: string[];
  notes: string[];
}

export interface Proposal {
  site: string;
  kind: ProposedKind;
  config: Record<string, unknown>;
  mapping: Mapping;
  /** 0 to 1. Below about 0.6 a person should look at the sample before saving. */
  confidence: number;
  fields: Record<string, number>;
  discovery: Discovery;
  sample: Article[];
  errors: { ref: unknown; reasons: string[] }[];
  notes: string[];
}

export interface WizardOptions {
  fetcher?: Fetcher;
  sampleSize?: number;
  ctx?: IngestContext;
}

const WEIGHTS: Record<string, number> = { headline: 0.3, body: 0.35, published_at: 0.1, "images[0].src": 0.1, byline: 0.05, subhead: 0.05, section: 0.05 };

function textLen(p: Partial1): number {
  return ((p.body as { text: string }[] | undefined) ?? []).reduce((n, b) => n + b.text.length, 0);
}

/** Share of samples where each scored field gave a believable value. */
export function fieldCoverage(partials: Partial1[]): Record<string, number> {
  const out: Record<string, number> = {};
  const n = Math.max(partials.length, 1);
  const ok: Record<string, (p: Partial1) => boolean> = {
    headline: (p) => typeof p.headline === "string" && p.headline.length >= 8 && p.headline.length <= 220,
    body: (p) => ((p.body as unknown[] | undefined)?.length ?? 0) >= 2 && textLen(p) >= 200,
    published_at: (p) => !!p.published_at,
    "images[0].src": (p) => !!p.images?.[0]?.src,
    byline: (p) => !!p.byline,
    subhead: (p) => !!p.subhead,
    section: (p) => !!p.section,
  };
  for (const k of Object.keys(WEIGHTS)) out[k] = partials.filter(ok[k]).length / n;
  return out;
}

export const confidenceOf = (cov: Record<string, number>): number =>
  Math.round(Object.entries(WEIGHTS).reduce((s, [k, w]) => s + w * (cov[k] ?? 0), 0) * 100) / 100;

async function tryGet(f: Fetcher, url: string, accept?: string) {
  try {
    return await f.get(url, { accept });
  } catch (e) {
    if (e instanceof FetchError && (e.code === "robots_blocked" || e.code === "timeout")) throw e;
    return null;
  }
}

export async function discoverSite(siteUrl: string, fetcher: Fetcher): Promise<{ disc: Discovery; home: { url: string; html: string } }> {
  const home = await fetcher.get(siteUrl, { accept: "text/html" });
  const $ = cheerio.load(home.text);
  const origin = new URL(home.url).origin;
  const disc: Discovery = { feeds: [], sitemaps: [], notes: [] };
  // feeds advertised in the page head
  $('link[rel~="alternate"]').each((_, el) => {
    const t = ($(el).attr("type") ?? "").toLowerCase();
    if (/rss|atom|xml/.test(t) && !/comments/i.test($(el).attr("title") ?? "")) {
      const u = absUrl($(el).attr("href"), home.url);
      if (u && !disc.feeds.includes(u)) disc.feeds.push(u);
    }
  });
  // WordPress
  const apiLink = $('link[rel="https://api.w.org/"]').attr("href");
  const probe = `${origin}/wp-json/wp/v2/posts?per_page=1&_embed=1`;
  const looksWp = !!apiLink || /wordpress/i.test($('meta[name="generator"]').attr("content") ?? "");
  const wp = await tryGet(fetcher, probe, "application/json");
  if (wp) {
    try {
      const j = JSON.parse(wp.text);
      if (Array.isArray(j) && j.length && j[0]?.content?.rendered !== undefined) disc.wordpress = origin;
    } catch { /* not WordPress */ }
  }
  if (looksWp && !disc.wordpress) disc.notes.push("The page says it is WordPress, but its REST API did not answer. It may be switched off.");
  // common feed paths
  if (!disc.feeds.length)
    for (const path of ["/feed", "/rss.xml", "/feed.xml", "/atom.xml", "/index.xml"]) {
      const r = await tryGet(fetcher, origin + path, "application/rss+xml, application/xml");
      if (r && /<(rss|feed|rdf:RDF)[\s>]/i.test(r.text.slice(0, 2000))) { disc.feeds.push(origin + path); break; }
    }
  // sitemaps
  const robots = fetcher instanceof PoliteFetcher ? await fetcher.sitemapsFor(origin) : [];
  for (const s of robots) disc.sitemaps.push(s);
  if (!disc.sitemaps.length) {
    const r = await tryGet(fetcher, origin + "/sitemap.xml", "application/xml");
    if (r && /<(urlset|sitemapindex)/i.test(r.text.slice(0, 2000))) disc.sitemaps.push(origin + "/sitemap.xml");
  }
  return { disc, home: { url: home.url, html: home.text } };
}

// ---- HTML rule candidates ----

const CANDIDATES: Record<string, string[]> = {
  headline: ["jsonld:headline", "css:article h1", "css:h1.entry-title,h1.post-title,h1.headline,h1.title", "css:h1", "meta:og:title"],
  subhead: ["css:.standfirst,.dek,.subhead,.subtitle,.lede,.article-summary,p.sub | text", "meta:og:description", "meta:description"],
  byline: ["jsonld:author.name", "meta:author", "css:.byline,[rel=author],[itemprop=author],.author | text"],
  published_at: ["jsonld:datePublished", "meta:article:published_time", "css:time[datetime]@datetime", "meta:date", "meta:og:updated_time"],
  updated_at: ["jsonld:dateModified", "meta:article:modified_time"],
  section: ["jsonld:articleSection", "meta:article:section"],
  tags: ["meta:keywords", "meta:article:tag"],
  lang: ["css:html@lang"],
  "images[0].src": ["jsonld:image.url", "jsonld:image", "meta:og:image", "meta:twitter:image", "css:article img@src"],
  "images[0].caption": ["css:article figure figcaption | text", "css:figure figcaption | text"],
};
const BODY_NAMED = [
  "css:[itemprop=articleBody] | blocks",
  "jsonld:articleBody | html_to_blocks",
  "css:.entry-content,.post-content,.article-body,.story-body,.article-content,.body | blocks",
];

function loadAll(pages: { url: string; html: string }[]) {
  return pages.map((p) => ({ url: p.url, $: cheerio.load(p.html) }));
}

/** For one field: try each rule on every sample; keep rules that ever work, best coverage first. */
function chooseChain(field: string, exprs: string[], docs: ReturnType<typeof loadAll>, accept: (p: Partial1) => boolean): string | undefined {
  const scored = exprs.map((e, order) => {
    let hit = 0;
    for (const d of docs) {
      const p = applyMapping({ [field]: e }, { $: d.$, url: d.url });
      if (accept(p)) hit++;
    }
    return { e, hit, order };
  });
  const useful = scored.filter((s) => s.hit > 0).sort((a, b) => b.hit - a.hit || a.order - b.order);
  return useful.length ? useful.map((s) => s.e).join(" || ") : undefined;
}

export function proposeHtmlMapping(pages: { url: string; html: string }[]): { mapping: Mapping; fields: Record<string, number>; notes: string[] } {
  const docs = loadAll(pages);
  const notes: string[] = [];
  const mapping: Mapping = {};
  const accepts: Record<string, (p: Partial1) => boolean> = {
    headline: (p) => typeof p.headline === "string" && p.headline.length >= 8 && p.headline.length <= 220,
    published_at: (p) => !!p.published_at,
    "images[0].src": (p) => !!p.images?.[0]?.src,
  };
  for (const [field, exprs] of Object.entries(CANDIDATES)) {
    const key = field;
    const chain = chooseChain(field, exprs, docs, accepts[key] ?? ((p) => (key.startsWith("images") ? !!p.images?.[0] : p[key] != null)));
    if (chain) mapping[field] = chain;
  }
  // drop the site-name suffix from a title taken from the og:title / title fallbacks
  // body: named selectors, then a selector learned from text density, then density itself
  const bodyOk = (p: Partial1) => ((p.body as unknown[] | undefined)?.length ?? 0) >= 2 && textLen(p) >= 200;
  const learned = new Map<string, number>();
  for (const d of docs) {
    const el = readableElement(d.$);
    if (el) {
      const s = selectorFor(d.$, el);
      learned.set(s, (learned.get(s) ?? 0) + 1);
    }
  }
  const best = [...learned.entries()].sort((a, b) => b[1] - a[1])[0];
  const candidates = [...BODY_NAMED];
  if (best && best[1] >= Math.ceil(docs.length / 2)) candidates.push(`css:${best[0]} | blocks`);
  candidates.push("readable: | blocks");
  // body chain keeps order by coverage; a tie keeps the semantic rules ahead of density
  const body = chooseChain("body", candidates, docs, bodyOk);
  if (body) mapping.body = body;
  else notes.push("We could not find the article text on the sample pages. Add a body rule by hand.");
  const partials = docs.map((d) => applyMapping(mapping, { $: d.$, url: d.url }));
  const fields = fieldCoverage(partials);
  if (!mapping.headline) notes.push("We could not find a headline.");
  return { mapping, fields, notes };
}

function dedupe<T>(a: T[]): T[] {
  return [...new Set(a)];
}

/** Given a site address, propose how to read it. Nothing is saved. */
export async function proposeMapping(siteUrl: string, opts: WizardOptions = {}): Promise<Proposal> {
  const fetcher = opts.fetcher ?? new PoliteFetcher();
  const n = opts.sampleSize ?? 5;
  const ctx: IngestContext = opts.ctx ?? { paperId: "pap_wizard", sourceId: "src_wizard" };
  const { disc, home } = await discoverSite(siteUrl, fetcher);
  const base = { site: home.url, discovery: disc };
  const notes = [...disc.notes];

  // 1. WordPress
  if (disc.wordpress) {
    const adapter = createWordpressConnector(fetcher);
    const config = { base: disc.wordpress, poll: "*/5 * * * *", per_page: 20, max_pages: 1 };
    const t = await testSource(adapter, config, WP_DEFAULT_MAPPING, ctx, n);
    const cov = await coverageFromRaw(adapter, config, WP_DEFAULT_MAPPING, n);
    return { ...base, kind: "wordpress", config, mapping: WP_DEFAULT_MAPPING, confidence: confidenceOf(cov), fields: cov, sample: t.articles, errors: t.errors, notes };
  }

  // 2. a feed, if it carries real text
  let feedLinks: string[] = [];
  for (const feed of disc.feeds) {
    try {
      const res = await fetcher.get(feed, { accept: "application/rss+xml, application/atom+xml, application/xml" });
      const items = parseFeed(res.text, res.url);
      if (!items.length) continue;
      feedLinks = items.map((i) => i.link).filter(Boolean);
      const adapter = createRssConnector(fetcher);
      const config = { url: feed, limit: 50, poll: "*/15 * * * *" };
      const cov = await coverageFromRaw(adapter, config, RSS_DEFAULT_MAPPING, n);
      if (cov.body >= 0.8) {
        const t = await testSource(adapter, config, RSS_DEFAULT_MAPPING, ctx, n);
        return { ...base, kind: "rss", config, mapping: RSS_DEFAULT_MAPPING, confidence: confidenceOf(cov), fields: cov, sample: t.articles, errors: t.errors, notes };
      }
      notes.push("The feed only has short summaries, so we read the full text from the article pages instead.");
      break;
    } catch (e) {
      notes.push(`We found a feed at ${feed} but could not read it: ${plainError(e)}`);
    }
  }

  // 3. plain HTML: choose sample pages
  let urls: string[] = [];
  const config: Record<string, unknown> = { list: [], pages: [], obey_robots: true, max_links: 30 };
  if (feedLinks.length) {
    urls = feedLinks;
    config.feed = disc.feeds[0];
  }
  if (!urls.length && disc.sitemaps.length) {
    try {
      urls = await listSitemapUrls(fetcher, disc.sitemaps[0]);
      if (urls.length) config.sitemap = disc.sitemaps[0];
    } catch (e) {
      notes.push(`The sitemap could not be read: ${plainError(e)}`);
    }
  }
  if (!urls.length) {
    urls = findArticleLinks(home.html, home.url).map((l) => l.url);
    if (urls.length) config.list = [home.url];
  }
  urls = dedupe(urls).filter((u) => u !== home.url);
  if (!urls.length) {
    return { ...base, kind: "scrape", config: { ...config, list: [home.url] }, mapping: HTML_DEFAULT_MAPPING, confidence: 0, fields: {}, sample: [], errors: [], notes: [...notes, "We could not find any article links on this site."] };
  }
  const pages: { url: string; html: string }[] = [];
  for (const u of urls) {
    if (pages.length >= n) break;
    try {
      const r = await fetcher.get(u, { accept: "text/html" });
      pages.push({ url: r.url, html: r.text });
    } catch (e) {
      notes.push(`Skipped a sample page: ${plainError(e)}`);
    }
  }
  const prop = proposeHtmlMapping(pages);
  const adapter = createHtmlConnector(fetcher);
  const t = await testSource(adapter, { ...config, pages: config.list || config.feed || config.sitemap ? [] : urls.slice(0, n) }, prop.mapping, ctx, n);
  const conf = confidenceOf(prop.fields);
  return {
    ...base,
    kind: "scrape",
    config,
    mapping: prop.mapping,
    // a mapping that does not survive its own dry run is not trusted
    confidence: t.articles.length === 0 ? 0 : Math.round(conf * Math.min(1, t.articles.length / Math.min(pages.length, n)) * 100) / 100,
    fields: prop.fields,
    sample: t.articles,
    errors: t.errors,
    notes: [...notes, ...prop.notes],
  };
}

async function coverageFromRaw(adapter: any, config: unknown, mapping: Mapping, n: number): Promise<Record<string, number>> {
  const cfg = adapter.configSchema.parse(config);
  const partials: Partial1[] = [];
  for await (const ref of adapter.discover(cfg, new Date(0))) {
    if (partials.length >= n) break;
    const raw = await adapter.fetch(cfg, ref);
    partials.push(applyMapping(mapping, { json: raw.data }));
  }
  return fieldCoverage(partials);
}

