import { z, type ZodType } from "zod";
import { IsoTime, Sha256Signature } from "../common.js";
import { ArticleImageSchema, ArticleSchema } from "./d1-article.js";

// D2: how a site is described, in data.

// SPEC-VAGUE: Ref is used but never defined; kept opaque.
export const RefSchema = z.unknown();
export type Ref = z.infer<typeof RefSchema>;

export const RawItemSchema = z.object({
  ref: RefSchema,
  format: z.enum(["json", "xml", "html"]),
  data: z.unknown(),
  fetchedAt: IsoTime,
});
export type RawItem = z.infer<typeof RawItemSchema>;

/** The connector interface from the spec (code shape, not data). */
export interface Connector<C> {
  kind: string; // "rss" | "wordpress" | "cxml" ...
  configSchema: ZodType<C>;
  discover(cfg: C, since: Date): AsyncIterable<Ref>;
  fetch(cfg: C, ref: Ref): Promise<RawItem>;
}

/** field path -> expression, e.g. "$.title.rendered | strip_html". */
// SPEC-VAGUE: the expression language (pipes, css:, jsonld:) is not formally defined; values are strings.
export const MappingSchema = z.record(z.string());
export type Mapping = z.infer<typeof MappingSchema>;

export const WordpressConfigSchema = z.object({
  base: z.string().url(),
  poll: z.string().min(1), // cron expression
});
export const ScrapeConfigSchema = z.object({
  list: z.array(z.string().url()),
  link_selector: z.string(),
  obey_robots: z.boolean(),
});

export const WordpressSourceSchema = z.object({
  kind: z.literal("wordpress"),
  config: WordpressConfigSchema,
  mapping: MappingSchema,
});
export const ScrapeSourceSchema = z.object({
  kind: z.literal("scrape"),
  config: ScrapeConfigSchema,
  mapping: MappingSchema,
});
/** Typefi ContentXML needs no mapping: kind "cxml" is built in. */
export const CxmlSourceSchema = z.object({
  kind: z.literal("cxml"),
  config: z.record(z.unknown()).optional(), // SPEC-VAGUE: cxml config not described
  mapping: MappingSchema.optional(),
});
/** Any other kind (e.g. "rss"): config shape not described. */
export const GenericSourceSchema = z.object({
  kind: z.string().min(1),
  config: z.record(z.unknown()), // SPEC-VAGUE: rss and other kinds have no config shape in the spec
  mapping: MappingSchema.optional(),
});
export const SourceRowSchema = z.union([
  WordpressSourceSchema,
  ScrapeSourceSchema,
  CxmlSourceSchema,
  GenericSourceSchema,
]);
export type SourceRow = z.infer<typeof SourceRowSchema>;

// PUSH door: POST /v1/ingest/articles
export const IngestHeadersSchema = z.object({
  "x-api-key": z.string().min(1),
  "x-signature": Sha256Signature,
});

/** An Article without our ids (id, paper_id, source_id, content_hash, rev). */
// SPEC-VAGUE: "without our ids" - content_hash and rev are assumed ours; image asset_id assumed ours too.
export const ArticleIngestSchema = ArticleSchema.omit({
  id: true,
  paper_id: true,
  source_id: true,
  content_hash: true,
  rev: true,
}).extend({
  images: z
    .array(
      ArticleImageSchema.omit({ asset_id: true }),
    )
    .default([]),
});
export const RawIngestSchema = z.object({ raw: z.unknown() });
export const IngestBodySchema = z.union([ArticleIngestSchema, RawIngestSchema]);
export type IngestBody = z.infer<typeof IngestBodySchema>;
