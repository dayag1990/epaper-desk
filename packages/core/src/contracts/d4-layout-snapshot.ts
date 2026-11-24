import { z } from "zod";
import { AssetId, EditionId, ItemId } from "../ids.js";
import { Fraction, Mm } from "../common.js";

// D4: what every exporter reads. mm, origin page top-left.

// "caption" (the photo caption line, credit included) was added after the first freeze: a new value, nothing renamed.
export const FrameRoleSchema = z.enum(["masthead", "strip", "kicker", "head", "sub", "body", "image", "ad", "caption"]);

export const FrameSchema = z.object({
  id: z.string().min(1), // e.g. "it_1.head" (item id + role), so not a plain prefixed id
  item: ItemId,
  role: FrameRoleSchema,
  x: Mm,
  y: Mm,
  w: Mm.refine((v) => v >= 0, "must not be negative"),
  h: Mm.refine((v) => v >= 0, "must not be negative"),
  // SPEC-VAGUE: which fields apply to which role is not stated; all optional.
  style: z.string().optional(),
  font: z.string().optional(),
  size_pt: z.number().positive().optional(),
  text: z.string().optional(),
  asset_id: AssetId.optional(),
  file: z.string().optional(),
  crop: z.tuple([Fraction, Fraction, Fraction, Fraction]).optional(), // x, y, w, h as 0-1 of the image
  wrap: z.enum(["none", "alpha"]).optional(),
  cols: z.number().int().positive().optional(),
  gutter: Mm.optional(),
  paras: z.array(z.string()).optional(),
  overset: z.boolean().optional(),
});

export const SnapshotPageSchema = z.object({
  no: z.number().int().min(1),
  w: Mm,
  h: Mm,
  fill_pct: z.number().min(0).max(100), // SPEC-VAGUE: assumed 0-100
  frames: z.array(FrameSchema),
});

export const LayoutSnapshotSchema = z.object({
  edition_id: EditionId,
  unit: z.literal("mm"),
  origin: z.literal("page top-left"),
  pages: z.array(SnapshotPageSchema),
});
export type LayoutSnapshot = z.infer<typeof LayoutSnapshotSchema>;
export type Frame = z.infer<typeof FrameSchema>;
