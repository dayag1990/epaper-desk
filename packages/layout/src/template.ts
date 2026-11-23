import { z } from "zod";

/**
 * A template = page size + column grid + slots + CSS tokens + fonts (M4 build list).
 * Template files in /templates are "demo default" sets. They are NOT any client's template.
 */
export const SlotSchema = z.object({
  id: z.string(), // feed-compatible: story_col_span-N-k | sidebar | feature-n | editorial | adverts-n
  span: z.number().int().min(1),
  cols: z.number().int().min(1),
  kind: z.enum(["story", "side", "feature", "edit", "ad"]),
  words_min: z.number().int().min(0),
  words_max: z.number().int().min(0),
  image: z.boolean(),
});
export type Slot = z.infer<typeof SlotSchema>;

export const TemplateSchema = z.object({
  id: z.string().min(1),
  set: z.string().min(1),
  name: z.string(),
  demo_default: z.literal(true),
  notice: z.string(),
  role: z.enum(["front", "inner"]),
  /** BCP 47 language of the page text (sets lang on .page: shaping and line-break rules follow it). */
  lang: z.string().optional(),
  max_stories: z.number().int().min(1), // variant pick: inner variants take up to this many stories
  size: z.object({ id: z.string(), w_mm: z.number().positive(), h_mm: z.number().positive() }),
  canvas_px: z.number().positive(), // CSS px width the page is laid out at (prototype: 1520)
  pad: z.object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() }),
  columns: z.number().int().min(1),
  gap: z.object({ row_px: z.number(), col_px: z.number() }),
  body: z.object({
    default_px: z.number().positive(),
    start_px: z.number().positive(), // auto-fit starts here
    min_px: z.number().positive(),
    max_px: z.number().positive(),
    step_px: z.number().positive(),
    line_height: z.number().positive(),
    col_gap_px: z.number(),
    /** Grid columns per text column (default 1). Tamil sets 2 so a body column is never narrower than about 24 characters. */
    span_per_col: z.number().positive().optional(),
  }),
  furniture: z.object({ masthead: z.string(), tagline: z.string(), strip: z.tuple([z.string(), z.string(), z.string()]), /** word before the page number in the inner-page strip (default "PAGE") */ page_label: z.string().optional() }),
  fonts: z.object({
    body: z.string(),
    head: z.string(),
    /**
     * Web fonts. `src` is a file name relative to the font base (templates/fonts, served at /fonts), e.g.
     * "noto-serif-tamil/NotoSerifTamil[wdth,wght].ttf"; an absolute URL or data: URI is used as is.
     * `weight` / `stretch` are the explicit @font-face ranges ("100 900", "75% 125%").
     */
    faces: z
      .array(z.object({ family: z.string(), src: z.string(), weight: z.string().optional(), stretch: z.string().optional(), format: z.string().optional() }))
      .default([]),
  }),
  colors: z.object({ ink: z.string(), red: z.string(), blue: z.string(), rule: z.string(), paper: z.string(), mast: z.string() }),
  masthead_px: z.object({ name: z.number(), tag: z.number() }),
  styles: z.object({ head: z.string(), sub: z.string(), body: z.string() }),
  slots: z.array(SlotSchema),
  css_extra: z.string().default(""),
});
export type Template = z.infer<typeof TemplateSchema>;

/** Number of text columns a story of `span` grid columns gets by default. */
export const colsForSpan = (span: number, t: Pick<Template, "body">): number => Math.max(1, Math.round(span / (t.body.span_per_col ?? 1)));
