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
  /** Newspaper finish: 1 = the page's dominant lead slot (auto-plan gives it to the first story whatever its length); others step down. */
  tier: z.number().int().min(1).max(4).optional(),
  /** Headline scale and photo ratio (width / height) this slot gives its story. */
  hs: z.number().positive().optional(),
  ratio: z.number().positive().optional(),
});
export type Slot = z.infer<typeof SlotSchema>;

/**
 * Newspaper finish ("ruled style"): print rules and furniture, driven by colors.rule. Absent = the plain prototype look.
 * Everything is optional so a template written before the finish existed loads unchanged.
 */
export const FinishSchema = z.object({
  ruled: z.boolean().default(true),
  /** Line weights on the template canvas, in CSS px (hair = 1 px is 0.7 pt on a 381 mm broadsheet; Chromium draws nothing thinner). */
  hair_px: z.number().positive().default(1),
  heavy_px: z.number().positive().default(4),
  /** Tinted panel / brief background, #rrggbb. Default: the template's blue mixed 9 % into the paper colour. */
  tint: z.string().optional(),
  /** Scripts (Unicode script names) that get a drop cap when a block asks for one. Default: Latin only. */
  dropcap_scripts: z.array(z.string()).default(["Latin"]),
  /** Lines the drop cap spans. */
  dropcap_lines: z.number().int().min(2).max(5).default(3),
  /** Printed before a byline that does not already start with it ("By "); empty for scripts that have no such custom. */
  byline_prefix: z.string().default(""),
  /** Jump lines. {n} = the other page's number. */
  jump_to: z.string().default("Continued on page {n}"),
  jump_from: z.string().default("Continued from page {n}"),
});
export type Finish = z.infer<typeof FinishSchema>;

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
  /** Section names in page order: the default page order of auto-plan for this paper (page 1 = first name). */
  section_order: z.array(z.string()).optional(),
  /** How the edition date is printed in the strip, e.g. {locale: "ta", pattern: "{month} {day}, {year}"}. Default: English uppercase weekday and date. */
  date_format: z.object({ locale: z.string(), pattern: z.string() }).optional(),
  /** What the IDML export needs to know about this template (paragraph style -> FontStyle named instance, Indic composer). */
  idml: z.object({ font_styles: z.record(z.string()).default({}) }).optional(),
  finish: FinishSchema.optional(),
  slots: z.array(SlotSchema),
  css_extra: z.string().default(""),
});
export type Template = z.infer<typeof TemplateSchema>;

/** Number of text columns a story of `span` grid columns gets by default. */
export const colsForSpan = (span: number, t: Pick<Template, "body">): number => Math.max(1, Math.round(span / (t.body.span_per_col ?? 1)));

const hex = (h: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (c: readonly number[]) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
/** `pct` percent of colour `a` over colour `b`, as #rrggbb (the input is returned as is when it is not a hex colour). */
export function mixHex(a: string, b: string, pct: number): string {
  const x = hex(a), y = hex(b);
  if (!x || !y) return b;
  return toHex(x.map((v, i) => (v * pct) / 100 + y[i]! * (1 - pct / 100)));
}
/** Is the ruled style on for this template? */
export const isRuled = (t: Pick<Template, "finish">): boolean => !!t.finish && t.finish.ruled !== false;
/** The tint of panels and briefs: from the template's own colours (never a fixed grey). */
export const panelTint = (t: Pick<Template, "finish" | "colors">): string => t.finish?.tint ?? mixHex(t.colors.blue, t.colors.paper, 9);

/**
 * Drop cap rule: the first letter of the paragraph is set as a drop cap only in scripts where that looks right. The first
 * GRAPHEME (Intl.Segmenter, so a Tamil consonant with its vowel sign stays whole) is checked against the template's script list.
 * Latin: yes. Tamil and Gurmukhi: off by default (see docs/newspaper-finish.md).
 */
export function firstGrapheme(text: string): string {
  const seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: object) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  if (!seg) return [...text][0] ?? "";
  for (const g of new seg(undefined, { granularity: "grapheme" }).segment(text)) return g.segment;
  return "";
}
export function dropcapAllowed(text: string, t: Pick<Template, "finish">): boolean {
  const g = firstGrapheme(text.trimStart());
  if (!g || !t.finish) return false;
  const scripts = t.finish.dropcap_scripts ?? ["Latin"];
  return scripts.some((s) => new RegExp(`^\\p{Script=${s}}`, "u").test(g)) && /\p{L}/u.test(g);
}
