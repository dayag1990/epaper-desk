import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import type { Mapping, RawItem } from "@epaper/core";
import type { Adapter, ArticleDraft, IngestContext } from "./types.js";
import { RejectError } from "./types.js";
import { PoliteFetcher, type Fetcher } from "./fetcher.js";
import { applyMapping } from "./expr.js";
import { completeDraft } from "./ingest.js";
import { absUrl, toIso } from "./util.js";

export const RssConfigSchema = z.object({
  url: z.string().url(),
  limit: z.number().int().positive().max(200).default(50),
  poll: z.string().default("*/15 * * * *"),
});
export type RssConfig = z.infer<typeof RssConfigSchema>;

/** One feed entry in a shape that does not care if it came from RSS 2.0, RDF or Atom. */
export interface FeedItem {
  id: string; link: string; title: string; summary: string; content_html: string; subhead: string;
  author: string; published: string; updated: string; categories: string[]; image: string; image_caption: string;
}

export const RSS_DEFAULT_MAPPING: Mapping = {
  external_id: "$.id | prefix('rss:')",
  url: "$.link",
  headline: "$.title | strip_html",
  subhead: "$.subhead | strip_html",
  body: "$.content_html | html_to_blocks",
  byline: "$.author",
  section: "$.categories[0]",
  tags: "$.categories",
  "images[0].src": "$.image",
  "images[0].caption": "$.image_caption",
  published_at: "$.published | parse_date('UTC')",
  updated_at: "$.updated | parse_date('UTC')",
};

const arr = <T>(x: T | T[] | undefined): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);
const txt = (x: any): string => {
  if (x == null) return "";
  if (typeof x === "string" || typeof x === "number") return String(x);
  if (typeof x === "object") return String(x["#text"] ?? x.name ?? x["@_href"] ?? "");
  return "";
};

export function parseFeed(xml: string, baseUrl: string): FeedItem[] {
  const p = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", processEntities: true, trimValues: true, removeNSPrefix: false });
  let doc: any;
  try {
    doc = p.parse(xml);
  } catch {
    throw new RejectError("That address did not give a readable feed (the XML is broken).");
  }
  const rssItems = arr(doc?.rss?.channel?.item ?? doc?.["rdf:RDF"]?.item);
  const atomEntries = arr(doc?.feed?.entry);
  if (!rssItems.length && !atomEntries.length && !doc?.rss && !doc?.feed && !doc?.["rdf:RDF"])
    throw new RejectError("That address is not an RSS or Atom feed.");
  const out: FeedItem[] = [];
  for (const it of rssItems) {
    const link = absUrl(txt(it.link), baseUrl) ?? "";
    const content = txt(it["content:encoded"]);
    const desc = txt(it.description);
    const enc = arr(it.enclosure).find((e: any) => /^image\//.test(e?.["@_type"] ?? "") || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(e?.["@_url"] ?? ""));
    const media = arr(it["media:content"] ?? it["media:thumbnail"])[0];
    out.push({
      id: txt(it.guid) || link,
      link,
      title: txt(it.title),
      summary: desc,
      content_html: content || desc,
      subhead: content && desc ? desc : "",
      author: txt(it["dc:creator"] ?? it.author),
      published: txt(it.pubDate ?? it["dc:date"]),
      updated: txt(it["atom:updated"] ?? it.pubDate ?? it["dc:date"]),
      categories: arr(it.category).map(txt).filter(Boolean),
      image: absUrl(enc?.["@_url"] ?? media?.["@_url"], baseUrl) ?? "",
      image_caption: "",
    });
  }
  for (const e of atomEntries) {
    const links = arr(e.link);
    const alt = links.find((l: any) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
    const imgLink = links.find((l: any) => l["@_rel"] === "enclosure" && /^image\//.test(l["@_type"] ?? ""));
    const link = absUrl(alt?.["@_href"], baseUrl) ?? "";
    const content = txt(e.content);
    const summary = txt(e.summary);
    const media = arr(e["media:thumbnail"] ?? e["media:content"])[0];
    out.push({
      id: txt(e.id) || link,
      link,
      title: txt(e.title),
      summary,
      content_html: content || summary,
      subhead: content && summary ? summary : "",
      author: txt(e.author?.name ?? e.author),
      published: txt(e.published ?? e.updated),
      updated: txt(e.updated ?? e.published),
      categories: arr(e.category).map((c: any) => (typeof c === "string" ? c : c?.["@_term"] ?? "")).filter(Boolean),
      image: absUrl(imgLink?.["@_href"] ?? media?.["@_url"], baseUrl) ?? "",
      image_caption: "",
    });
  }
  return out;
}

export function createRssConnector(fetcher: Fetcher = new PoliteFetcher()): Adapter<RssConfig> {
  return {
    kind: "rss",
    configSchema: RssConfigSchema as unknown as z.ZodType<RssConfig>,
    defaultMapping: RSS_DEFAULT_MAPPING,
    async *discover(cfg, since) {
      const res = await fetcher.get(cfg.url, { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" });
      let n = 0;
      for (const item of parseFeed(res.text, res.url)) {
        const when = toIso(item.updated || item.published);
        if (when && since.getTime() > 0 && new Date(when) < since) continue;
        if (n++ >= cfg.limit) break;
        yield { id: item.id, item };
      }
    },
    async fetch(_cfg, ref): Promise<RawItem> {
      const r = ref as { id: string; item: FeedItem };
      return { ref, format: "json", data: r.item, fetchedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") };
    },
    normalize(raw: RawItem, mapping: Mapping | undefined, ctx: IngestContext): ArticleDraft | null {
      const item = raw.data as FeedItem;
      const p = applyMapping(mapping ?? RSS_DEFAULT_MAPPING, { json: item, url: item.link }, { maps: ctx.maps });
      return completeDraft(p, { url: item.link, ctx, fetchedAt: raw.fetchedAt });
    },
  };
}
