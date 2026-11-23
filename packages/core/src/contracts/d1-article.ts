import { z } from "zod";
import { ArticleId, AssetId, PaperId, SourceId } from "../ids.js";
import { IsoTime } from "../common.js";

// D1: the one shape every source becomes.

export const BodyBlockSchema = z.object({
  t: z.enum(["p", "h", "quote"]),
  text: z.string(),
});

export const ArticleImageSchema = z.object({
  asset_id: AssetId,
  role: z.string(), // SPEC-VAGUE: only "lead" is shown; other roles unknown
  src: z.string().url(),
  caption: z.string().nullish(),
  credit: z.string().nullish(),
});

export const LayoutHintSchema = z.object({
  page: z.string(), // SPEC-VAGUE: example "Main" (a page name, not a number)
  slot: z.string(),
  span: z.number().int(),
  order: z.number().int(),
});

export const ArticleSchema = z.object({
  id: ArticleId,
  paper_id: PaperId,
  source_id: SourceId,
  external_id: z.string().min(1), // theirs, stable
  url: z.string().url(), // tap target
  lang: z.string().min(1), // SPEC-VAGUE: language code format not stated
  script: z.string().optional(), // SPEC-VAGUE: example "Guru"; optional is a guess
  section: z.string(), // SPEC-VAGUE: section vocabulary not stated
  tags: z.array(z.string()).default([]),
  priority: z.number().int().min(0).max(100),
  kicker: z.string().nullable().optional(),
  headline: z.string(),
  subhead: z.string().nullish(),
  byline: z.string().nullish(),
  dateline: z.string().nullish(),
  body: z.array(BodyBlockSchema),
  images: z.array(ArticleImageSchema).default([]),
  layout_hint: LayoutHintSchema.optional(),
  published_at: IsoTime,
  updated_at: IsoTime,
  content_hash: z.string().regex(/^sha256:.+/, "must look like sha256:<hash>"),
  rev: z.number().int().min(0),
});
export type Article = z.infer<typeof ArticleSchema>;
export type BodyBlock = z.infer<typeof BodyBlockSchema>;
