import type { Article, PageDoc, PageItem } from "@epaper/core";
import { packSpans } from "./pack.js";
import { splitCaption } from "./caption.js";
import { paperCss } from "./css.js";
import { colsForSpan, type Template } from "./template.js";
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

function storyHtml(item: PageItem, span: number, articles: readonly Article[], t: Template, editable: boolean): string {
  const kind = item.kind;
  const ed = editable ? ` contenteditable="true" spellcheck="false"` : "";
  const ph = (s: string) => (editable ? ` data-ph="${esc(s)}"` : "");
  const cols = kind === "ad" ? (item.cols ?? 1) : (item.cols ?? colsForSpan(span, t));
  const hs = item.hs ?? 1;
  const ar = item.image?.ratio ?? defaultRatio(kind, span);
  const style = `--span:${span};--cols:${cols};--hs:${hs};--ar:${ar}`;
  const attrs = `class="story k-${kind}" data-item="${esc(item.id)}" data-type="${esc(item.slot ?? "")}" data-kind="${kind}" data-span="${span}" data-cols="${cols}" data-hs="${hs}" data-ar="${ar}" style="${style}"`;
  const src = imageSrc(item, [...articles]);
  if (kind === "ad") {
    return `<article ${attrs}>${item.image ? figHtml(item, src, true, editable) : ""}</article>`;
  }
  const tx = item.text ?? { head: "", body: [] };
  const st = item.styles ?? { head: t.styles.head, sub: t.styles.sub, body: t.styles.body };
  const parts: string[] = [];
  if (tx.kicker) parts.push(`<div class="kicker"${ed}${ph("Label")}>${esc(tx.kicker)}</div>`);
  if (editable || tx.head) parts.push(`<h2 class="head" data-style="${esc(st.head)}"${ed}${ph("Headline")}>${esc(tx.head)}</h2>`);
  if (editable || tx.sub) parts.push(`<div class="sub" data-style="${esc(st.sub)}"${ed}${ph("Sub-headline (optional)")}>${esc(tx.sub ?? "")}</div>`);
  if (item.image) {
    const cap = src ? captionHtml(item, articles) : "";
    parts.push(cap ? figHtml(item, src, false, editable).replace('class="fig"', 'class="fig has-cap"') + cap : figHtml(item, src, false, editable));
  }
  const paras = tx.body.length ? tx.body : [""];
  parts.push(`<div class="body" data-style="${esc(st.body)}"${ed}>${paras.map((p) => `<p>${esc(p)}</p>`).join("")}</div>`);
  return `<article ${attrs}>${parts.join("")}</article>`;
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
      ? `<div class="mast">${cell("div", "name", f.masthead, "Newspaper name")}${cell("div", "tag", f.tagline, "Tagline / website")}</div>` +
        `<div class="strip">${strip.map((s, i) => cell("span", "", s, ["EDITION · CITY", "DAY, DATE", "PAGES · PRICE"][i]!)).join("")}</div>`
      : `<div class="strip inner">${cell("span", "sec", strip[0]!, "Section name")}${cell("span", "", strip[1]!, "DAY, DATE")}${cell("span", "", strip[2]!, "PAGE")}</div>`;
  const stories = doc.items.map((it, n) => storyHtml(it, spans[n]!, articles, t, editable)).join("");
  const minH = Math.round((t.canvas_px * doc.page.h_mm) / doc.page.w_mm);
  const html =
    `<div class="page"${t.lang ? ` lang="${esc(t.lang)}"` : ""} data-page="${doc.page.no}" data-template="${esc(doc.page.template)}" data-fs="${bodyPx}" style="min-height:${minH}px;--fs:${bodyPx}px;--z:1">` +
    `<div class="sheet">${head}<div class="grid">${stories}</div></div></div>`;
  return { html, css: paperCss(t, { fontBase: opts.fontBase }), spans, bodyPx };
}

/** A full HTML document holding one or more rendered pages (what Chromium loads). */
export function renderDocument(pages: readonly RenderedPage[], title = "page"): string {
  const css = pages[0]?.css ?? "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}\nhtml,body{margin:0;background:#fff}</style></head><body>${pages.map((p) => p.html).join("\n")}</body></html>`;
}
