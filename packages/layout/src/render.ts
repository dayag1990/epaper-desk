import type { Article, PageDoc, PageItem } from "@epaper/core";
import { packSpans } from "./pack.js";
import { splitCaption } from "./caption.js";
import { paperCss } from "./css.js";
import { colsForSpan, dropcapAllowed, firstGrapheme, isRuled, type Template } from "./template.js";
import { round, storedBodyPx } from "./units.js";

export const esc = (s: unknown): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface RenderOptions {
  /** Editor mode: contenteditable + placeholders. Print/server mode (default) renders no editing aids. */
  editable?: boolean;
  /** Override the body size (px on the template canvas); default comes from doc.page.body_pt. */
  bodyPx?: number;
  /** URL prefix the template's web fonts are served from (editor: "/fonts" on the API origin; server: see fonts.ts). */
  fontBase?: string;
}
export interface RenderedPage {
  html: string; // one <div class="page">…</div>
  css: string; // the paper CSS (include once per document)
  spans: number[]; // packed spans, same order as doc.items
  bodyPx: number;
}

/** Prototype defSpan(): "span-N" in the slot name wins, else a default per kind. */
export function defaultSpan(item: Pick<PageItem, "kind" | "slot">, columns = 8): number {
  const m = /span[-_](\d+)/i.exec(item.slot ?? "");
  if (m) return Math.min(columns, Math.max(1, +m[1]!));
  const base = ({ ad: 8, side: 2, feature: 6, edit: 8, story: 3 } as const)[item.kind];
  return Math.min(columns, Math.max(1, columns === 8 ? base : Math.round((base * columns) / 8)));
}
/** Prototype storyEl(): default image ratio from the (packed) span. */
export const defaultRatio = (kind: PageItem["kind"], span: number): number => (kind === "ad" ? 9 : span >= 6 ? 3.2 : span >= 4 ? 2.3 : 1.78);

/** Spans of every item after row packing (items without an explicit span get the default). */
export function packedSpans(doc: PageDoc, t: Template): number[] {
  return packSpans(doc.items.map((i) => i.span ?? defaultSpan(i, t.columns)), t.columns);
}

function articleImage(item: PageItem, articles: readonly Article[]): Article["images"][number] | null {
  if (!item.image) return null;
  const id = item.image.asset_id;
  for (const a of articles) for (const im of a.images) if (im.asset_id === id) return im;
  return null;
}
const imageSrc = (item: PageItem, articles: readonly Article[]): string | null => articleImage(item, articles)?.src ?? null;

/**
 * The caption line under a photo: the caption in the page's caption size, the credit (when there is one) as a smaller run
 * of the SAME line ("Photo: Jane Doe, CC BY 4.0, Wikimedia Commons"). It comes from the article, so a re-sync keeps it.
 * Empty when the article has neither; an ad never has one.
 */
export function captionHtml(item: PageItem, articles: readonly Article[]): string {
  if (item.kind === "ad") return "";
  const im = articleImage(item, articles);
  if (!im) return "";
  const { text, credit } = splitCaption(im.caption, im.credit);
  if (!text && !credit) return "";
  const cr = credit ? `<span class="credit">${text ? "· " : ""}${esc(credit)}</span>` : "";
  return `<div class="cap" data-asset="${esc(item.image!.asset_id)}">${text ? esc(text) + (credit ? " " : "") : ""}${cr}</div>`;
}

function figHtml(item: PageItem, src: string | null, isAd: boolean, editable: boolean): string {
  const img = item.image!;
  const [fx, fy] = img.focal;
  if (src) {
    return `<div class="fig" data-asset="${esc(img.asset_id)}"><img alt="" src="${esc(src)}" style="object-position:${round(fx * 100, 1)}% ${round(fy * 100, 1)}%"></div>`;
  }
  // Like the prototype's view/print mode: an empty image slot takes no room.
  if (!editable) return "";
  const label = `${isAd ? "ADVERT SLOT" : "PHOTO SLOT"}<small>tap to add image</small>`;
  return `<div class="fig empty" data-asset="${esc(img.asset_id)}">${label}</div>`;
}

/**
 * A cut-out photo (a PNG with a transparent background) sits INSIDE the text columns as a float (the "cutbox": photo + caption), so the body text runs round its
 * outline: domReady() reads the PNG's alpha channel and sets `shape-outside: polygon(...)` on the figure (see dom.ts); where it
 * cannot (the picture is on another origin without CORS headers, or has no alpha) the float's own rectangle is the shape, which is
 * the rectangular fallback. (CSS `shape-outside: url()` was tried first: Chromium places the image at its natural pixel size,
 * not stretched to the figure, so the outline would be wrong whenever the picture is scaled.) The figure is a little wider than the column on the outer side so it breaks the frame. It carries
 * data-noedit so the editor never makes it part of the typed text.
 */
function cutoutHtml(item: PageItem, src: string, cap: string): string {
  const img = item.image!;
  const fig = `<div class="fig cutout${cap ? " has-cap" : ""}" data-asset="${esc(img.asset_id)}"><img alt="" src="${esc(src)}"></div>`;
  // one float holds the picture and its caption, so the caption always sits right under the photo and wraps with it
  return `<div class="cutbox" data-noedit="1">${fig}${cap ? cap.replace('class="cap"', 'class="cap cutcap"') : ""}</div>`;
}

const DASH_END = /[\u2014\u2013-]\s*$/;
/** The dateline as printed: "Riverton, 3 Nov" -> "Riverton, 3 Nov \u2014". Case is the CSS's job (small caps). */
export function datelineText(d: string | null | undefined): string {
  const t = (d ?? "").replace(/\s+/g, " ").trim();
  return !t ? "" : DASH_END.test(t) ? t : `${t} \u2014`;
}
/** "By Jane Doe": the byline as printed (the template's prefix is added only when the text does not start with it). */
export function bylineText(b: string | null | undefined, t: Pick<Template, "finish">): string {
  const x = (b ?? "").replace(/\s+/g, " ").trim();
  const pre = t.finish?.byline_prefix ?? "";
  return x && pre && !x.toLowerCase().startsWith(pre.trim().toLowerCase()) ? pre + x : x;
}
const jumpLine = (j: NonNullable<PageItem["jump"]>, t: Template): string => {
  const f = t.finish;
  const tpl = j.role === "to" ? f?.jump_to ?? "Continued on page {n}" : f?.jump_from ?? "Continued from page {n}";
  return j.page != null ? tpl.replace("{n}", String(j.page)) : j.role === "to" ? "Continued on the next page" : "Continued from the previous page";
};

interface StoryCtx { lead: boolean; rowStart: boolean }
function storyHtml(item: PageItem, span: number, articles: readonly Article[], t: Template, editable: boolean, cx: StoryCtx): string {
  const kind = item.kind;
  const ed = editable ? ` contenteditable="true" spellcheck="false"` : "";
  const ph = (s: string) => (editable ? ` data-ph="${esc(s)}"` : "");
  const cols = kind === "ad" ? (item.cols ?? 1) : (item.cols ?? colsForSpan(span, t));
  const hs = item.hs ?? 1;
  const ar = item.image?.ratio ?? defaultRatio(kind, span);
  const style = `--span:${span};--cols:${cols};--hs:${hs};--ar:${ar}`;
  const block = kind === "ad" ? "plain" : item.block ?? "plain";
  const tx = item.text ?? { head: "", body: [] };
  const paras = tx.body.length ? tx.body : [""];
  const dc = kind !== "ad" && !!item.dropcap && block !== "quote" && dropcapAllowed(paras[0]!, t);
  const src = imageSrc(item, [...articles]);
  const cut = kind !== "ad" && !!item.image?.cutout && !!src && block !== "quote";
  const cls = `story k-${kind}${block !== "plain" ? ` b-${block}` : ""}${cx.lead ? " lead" : ""}${cx.rowStart ? " rs" : ""}${dc ? " dc" : ""}${cut ? " has-cut" : ""}`;
  const attrs = `class="${cls}" data-item="${esc(item.id)}" data-type="${esc(item.slot ?? "")}" data-kind="${kind}" data-span="${span}" data-cols="${cols}" data-hs="${hs}" data-ar="${ar}"${block !== "plain" ? ` data-block="${block}"` : ""} style="${style}"`;
  if (kind === "ad") {
    return `<article ${attrs}>${item.image ? figHtml(item, src, true, editable) : ""}</article>`;
  }
  const st = item.styles ?? { head: t.styles.head, sub: t.styles.sub, body: t.styles.body };
  const parts: string[] = [];
  if (item.jump?.role === "from") parts.push(`<div class="jump from">${esc(jumpLine(item.jump, t))}</div>`);
  if (tx.kicker) parts.push(`<div class="kicker"${ed}${ph("Label")}>${esc(tx.kicker)}</div>`);
  if (editable || tx.head) parts.push(`<h2 class="head" data-style="${esc(st.head)}"${ed}${ph("Headline")}>${esc(tx.head)}</h2>`);
  if (editable || tx.sub) parts.push(`<div class="sub" data-style="${esc(st.sub)}"${ed}${ph("Sub-headline (optional)")}>${esc(tx.sub ?? "")}</div>`);
  const by = bylineText(tx.byline, t);
  const dl = datelineText(tx.dateline);
  // With a drop cap the dateline cannot run into the first line, so it joins the byline line instead.
  if (by || (dc && dl)) parts.push(`<div class="byline"${dc && dl ? ` data-dl="${esc(dl)}"` : ""} data-style="Story-byline"${by ? ed : ""}>${esc(by)}</div>`);
  let cutHtml = "";
  if (item.image) {
    const cap = src ? captionHtml(item, articles) : "";
    if (cut) cutHtml = cutoutHtml(item, src!, cap);
    else parts.push(cap ? figHtml(item, src, false, editable).replace('class="fig"', 'class="fig has-cap"') + cap : figHtml(item, src, false, editable));
  }
  const pHtml = paras.map((p, i) => {
    if (i === 0 && dc) {
      const g = firstGrapheme(p);
      return `<p><span class="dc">${esc(g)}</span>${esc(p.slice(g.length))}</p>`;
    }
    return i === 0 && dl && !dc ? `<p data-dl="${esc(dl)}">${esc(p)}</p>` : `<p>${esc(p)}</p>`;
  });
  parts.push(`<div class="body" data-style="${esc(st.body)}"${ed}>${cutHtml}${pHtml.join("")}</div>`);
  if (item.jump?.role === "to") parts.push(`<div class="jump to">${esc(jumpLine(item.jump, t))}</div>`);
  return `<article ${attrs}>${parts.join("")}</article>`;
}

/**
 * The masthead name stays on ONE line: a long paper name ("The Riverton Herald") would otherwise wrap in the red band and push the
 * page down. Its size shrinks only when the name would not fit next to the tagline (about 0.62 em per character; the band's
 * room is the canvas minus page padding, band padding, the tagline's minimum width and the gap).
 */
export function mastNameSize(name: string, t: Pick<Template, "canvas_px" | "pad" | "masthead_px">): number {
  const room = t.canvas_px - t.pad.left - t.pad.right - 56 - 120 - 24;
  const len = [...name].length || 1;
  return Math.min(t.masthead_px.name, Math.floor(room / (len * 0.62)));
}
function mastName(name: string, t: Template, editable: boolean): string {
  if (!editable && !name) return "";
  const px = mastNameSize(name, t);
  const small = px < t.masthead_px.name ? ` style="font-size:${px}px"` : "";
  const ed = editable ? ` contenteditable="true" spellcheck="false" data-ph="Newspaper name"` : "";
  return `<div class="name"${small}${ed}>${esc(name)}</div>`;
}

/**
 * The folio on an inner page ("PAGE 3"): when the stored text is the template's own "label + number" the number is the page's
 * real number, so a page that was deleted or moved never prints a stale one. Any other text is printed as typed.
 */
function folio(text: string, no: number, t: Template): string {
  if (!isRuled(t)) return text;
  const label = t.furniture.page_label ?? "PAGE";
  const m = /^(.*?)(\d+)\s*$/.exec(text);
  return m && m[1]!.trim() === label.trim() ? `${m[1]}${no}` : text;
}

/**
 * renderPage(pageDoc, template, articles) -> page HTML + CSS.
 * The one renderer: the editor puts `html` in the DOM, the worker loads it in Chromium.
 * Pure string output, no DOM needed, deterministic.
 */
export function renderPage(doc: PageDoc, template: Template, articles: readonly Article[] = [], opts: RenderOptions = {}): RenderedPage {
  const t = template;
  const editable = !!opts.editable;
  const ed = editable ? ` contenteditable="true" spellcheck="false"` : "";
  const ph = (s: string) => (editable ? ` data-ph="${esc(s)}"` : "");
  const bodyPx = opts.bodyPx ?? storedBodyPx(doc.page.body_pt, t);
  const spans = packedSpans(doc, t);
  const f = doc.furniture ?? { masthead: "", tagline: "", strip: [] as string[] };
  const strip = [0, 1, 2].map((i) => f.strip[i] ?? "");
  // Like the prototype's view mode: empty furniture cells are not rendered (editor mode keeps them as placeholders).
  const cell = (tag: string, cls: string, text: string, ph0: string): string =>
    editable || text ? `<${tag}${cls ? ` class="${cls}"` : ""}${ed}${ph(ph0)}>${esc(text)}</${tag}>` : "";
  const head =
    doc.page.no === 1
      ? `<div class="mast">${mastName(f.masthead, t, editable)}${cell("div", "tag", f.tagline, "Tagline / website")}</div>` +
        `<div class="strip">${strip.map((s, i) => cell("span", "", s, ["EDITION · CITY", "DAY, DATE", "PAGES · PRICE"][i]!)).join("")}</div>`
      : `<div class="strip inner">${cell("span", "sec", strip[0]!, "Section name")}${cell("span", "", strip[1]!, "DAY, DATE")}${cell("span", "folio", folio(strip[2]!, doc.page.no, t), "PAGE")}</div>`;
  let col = 0;
  let leadAt = doc.items.findIndex((i) => i.kind !== "ad");
  const stories = doc.items.map((it, n) => {
    const rowStart = col === 0;
    col += spans[n]!;
    if (col >= t.columns) col = 0;
    return storyHtml(it, spans[n]!, articles, t, editable, { lead: n === leadAt, rowStart });
  }).join("");
  const minH = Math.round((t.canvas_px * doc.page.h_mm) / doc.page.w_mm);
  const html =
    `<div class="page${isRuled(t) ? " ruled" : ""}"${t.lang ? ` lang="${esc(t.lang)}"` : ""} data-page="${doc.page.no}" data-template="${esc(doc.page.template)}" data-fs="${bodyPx}" style="min-height:${minH}px;--fs:${bodyPx}px;--z:1">` +
    `<div class="sheet">${head}<div class="grid">${stories}</div></div></div>`;
  return { html, css: paperCss(t, { fontBase: opts.fontBase }), spans, bodyPx };
}

/** A full HTML document holding one or more rendered pages (what Chromium loads). */
export function renderDocument(pages: readonly RenderedPage[], title = "page"): string {
  const css = pages[0]?.css ?? "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}\nhtml,body{margin:0;background:#fff}</style></head><body>${pages.map((p) => p.html).join("\n")}</body></html>`;
}
