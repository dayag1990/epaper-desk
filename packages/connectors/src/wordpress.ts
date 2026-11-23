import { z } from "zod";
import type { Mapping, RawItem } from "@epaper/core";
import type { Adapter, ArticleDraft, IngestContext } from "./types.js";
import { RejectError } from "./types.js";
import { PoliteFetcher, type Fetcher } from "./fetcher.js";
import { applyMapping } from "./expr.js";
import { completeDraft } from "./ingest.js";

export const WordpressConfigSchema = z.object({
  base: z.string().url(),
  poll: z.string().min(1).default("*/5 * * * *"),
  per_page: z.number().int().min(1).max(100).default(20),
  max_pages: z.number().int().min(1).max(20).default(1),
});
export type WpConfig = z.infer<typeof WordpressConfigSchema>;

export const WP_DEFAULT_MAPPING: Mapping = {
  external_id: "$.id | prefix('wp:')",
  url: "$.link",
  headline: "$.title.rendered | strip_html",
  subhead: "$.excerpt.rendered | strip_html",
  body: "$.content.rendered | html_to_blocks",
  byline: "$._embedded.author[0].name",
  section: "$._embedded['wp:term'][0][0].slug | map(sections)",
  tags: "$._embedded['wp:term'][1]",
  "images[0].src": "$._embedded['wp:featuredmedia'][0].source_url",
  "images[0].caption": "$._embedded['wp:featuredmedia'][0].caption.rendered | strip_html",
  published_at: "$.date_gmt | parse_date('UTC')",
  updated_at: "$.modified_gmt | parse_date('UTC')",
};

export function createWordpressConnector(fetcher: Fetcher = new PoliteFetcher()): Adapter<WpConfig> {
  return {
    kind: "wordpress",
    configSchema: WordpressConfigSchema as unknown as z.ZodType<WpConfig>,
    defaultMapping: WP_DEFAULT_MAPPING,
    async *discover(cfg, since) {
      const base = cfg.base.replace(/\/+$/, "");
      for (let page = 1; page <= cfg.max_pages; page++) {
        const q = new URLSearchParams({ _embed: "1", per_page: String(cfg.per_page), page: String(page), orderby: "date", order: "desc" });
        if (since.getTime() > 0) q.set("modified_after", since.toISOString());
        let res;
        try {
          res = await fetcher.get(`${base}/wp-json/wp/v2/posts?${q}`, { accept: "application/json" });
        } catch (e) {
          // WordPress answers 400 past the last page
          if (page > 1 && (e as any)?.code === "http_error") return;
          throw e;
        }
        let posts: unknown;
        try {
          posts = JSON.parse(res.text);
        } catch {
          throw new RejectError("That site did not answer like WordPress (the reply was not JSON). Is the WordPress REST API switched on?");
        }
        if (!Array.isArray(posts)) throw new RejectError("That site did not give a list of posts. The WordPress REST API may be switched off or locked.");
        for (const post of posts) yield { id: (post as any).id, post };
        if (posts.length < cfg.per_page) return;
      }
    },
    async fetch(_cfg, ref): Promise<RawItem> {
      return { ref, format: "json", data: (ref as { post: unknown }).post, fetchedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") };
    },
    normalize(raw: RawItem, mapping: Mapping | undefined, ctx: IngestContext): ArticleDraft | null {
      const post: any = raw.data;
      if (post?.status && post.status !== "publish") return null;
      const p = applyMapping(mapping ?? WP_DEFAULT_MAPPING, { json: post, url: post?.link }, { maps: ctx.maps });
      if (!p.lang && typeof post?.lang === "string") p.lang = post.lang;
      return completeDraft(p, { url: post?.link, ctx, fetchedAt: raw.fetchedAt });
    },
  };
}
