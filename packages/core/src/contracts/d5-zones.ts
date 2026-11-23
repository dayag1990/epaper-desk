import { z } from "zod";
import { ArticleId, ZoneId } from "../ids.js";
import { Fraction } from "../common.js";

// D5: tap areas on an e-paper page. All geometry is 0-1 fractions of the page image.

const EPS = 1e-9;

/** [x, y, w, h], each 0-1, and the rectangle must stay inside the image. */
export const RectSchema = z
  .tuple([Fraction, Fraction, Fraction, Fraction])
  .refine(([x, y, w, h]) => x + w <= 1 + EPS && y + h <= 1 + EPS, {
    message: "rectangle runs past the edge of the page image (x+w and y+h must be 1 or less)",
  });

export const ZoneSchema = z.object({
  id: ZoneId,
  article_id: ArticleId.nullable(), // null for ads
  title: z.string(),
  url: z.string().url().nullable(), // SPEC-VAGUE: ads have no article; null assumed allowed
  rects: z.array(RectSchema).min(1),
  confidence: Fraction,
  source: z.enum(["auto", "snapshot", "manual"]),
});

export const ZoneSetSchema = z.object({
  page: z.number().int().min(1),
  image: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }), // pixels
  version: z.number().int().min(0),
  zones: z.array(ZoneSchema),
});
export type ZoneSet = z.infer<typeof ZoneSetSchema>;
export type Zone = z.infer<typeof ZoneSchema>;
