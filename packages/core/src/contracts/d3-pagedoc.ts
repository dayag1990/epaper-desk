import { z } from "zod";
import { ArticleId, AssetId, ItemId } from "../ids.js";
import { Fraction } from "../common.js";

// D3: one page as the editor saves it. Geometry is mm.

export const PageSchema = z.object({
  no: z.number().int().min(1),
  size: z.string(), // SPEC-VAGUE: "broadsheet"; full set of sizes unknown
  w_mm: z.number().positive(),
  h_mm: z.number().positive(),
  template: z.string(), // SPEC-VAGUE: template names not listed
  body_pt: z.number().positive(),
});

export const FurnitureSchema = z.object({
  masthead: z.string(),
  tagline: z.string(),
  strip: z.array(z.string()),
});

export const ItemKindSchema = z.enum(["story", "side", "feature", "edit", "ad"]);

export const ItemTextSchema = z.object({
  kicker: z.string().nullable().optional(),
  head: z.string(),
  sub: z.string().nullish(),
  body: z.array(z.string()), // print copy, not web copy
  /** "By Jane Doe": printed under the headline and deck (newspaper finish). Optional, additive. */
  byline: z.string().nullish(),
  /** "Riverton, 3 Nov": run into the first paragraph in small caps. Optional, additive. */
  dateline: z.string().nullish(),
});

export const ItemImageSchema = z.object({
  asset_id: AssetId,
  ratio: z.number().positive(), // width / height
  cutout: z.boolean(),
  focal: z.tuple([Fraction, Fraction]), // x, y as 0-1
});

/** How a block looks on the page (newspaper finish). Absent = plain. */
export const BlockStyleSchema = z.enum(["plain", "brief", "quote", "panel"]);
export type BlockStyle = z.infer<typeof BlockStyleSchema>;

/**
 * A story that runs on from one page to another: the "to" half says "Continued on page N", the "from" half says
 * "Continued from page N". `pair` is the item id of the other half; `page` is that half's page number, kept
 * in sync by syncJumps() when pages are deleted or renumbered.
 */
export const JumpSchema = z.object({
  role: z.enum(["to", "from"]),
  pair: ItemId,
  page: z.number().int().min(1).optional(),
});
export type Jump = z.infer<typeof JumpSchema>;

export const ItemStylesSchema = z.object({
  head: z.string(),
  sub: z.string(),
  body: z.string(),
});

export const PageItemSchema = z.object({
  id: ItemId,
  kind: ItemKindSchema,
  // SPEC-VAGUE: which fields are optional per kind is not stated (ads/edit likely lack article_id); all but id/kind optional.
  article_id: ArticleId.optional(),
  article_rev: z.number().int().min(0).optional(),
  slot: z.string().optional(),
  span: z.number().int().optional(),
  cols: z.number().int().optional(),
  hs: z.number().optional(), // SPEC-VAGUE: "hs" 1.0 meaning not stated (head scale?)
  text: ItemTextSchema.optional(),
  image: ItemImageSchema.optional(),
  styles: ItemStylesSchema.optional(),
  /** Newspaper finish (all optional and additive: a page without them looks and loads as before). */
  block: BlockStyleSchema.optional(),
  /** Drop cap on the first paragraph (only applied to scripts where it looks right; see docs/newspaper-finish.md). */
  dropcap: z.boolean().optional(),
  jump: JumpSchema.optional(),
});

export const PageDocSchema = z.object({
  page: PageSchema,
  furniture: FurnitureSchema.optional(), // SPEC-VAGUE: optionality not stated
  items: z.array(PageItemSchema),
  status: z.string(), // SPEC-VAGUE: only "draft" shown
  rev: z.number().int().min(0),
});
export type PageDoc = z.infer<typeof PageDocSchema>;
export type PageItem = z.infer<typeof PageItemSchema>;
