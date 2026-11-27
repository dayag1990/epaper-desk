import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { PDFDocument } from "pdf-lib";
import type { Article, PageDoc } from "@epaper/core";
import { SCREEN_IMAGES, recompressPdfImages, type ScreenImageOptions } from "./pdf-images.js";
import { SERVER_FONT_BASE, domReady, installFonts, renderDocument, renderPage, type Template } from "@epaper/layout";

export interface EditionPage { doc: PageDoc; template: Template }
export interface ScreenPdfOptions {
  paper: string; // e.g. "gazette"
  date: string; // e.g. "2026-11-23"
  pages: readonly EditionPage[];
  articles?: readonly Article[];
  /** Reuse a running Chromium (the worker does); otherwise one is launched and closed. */
  browser?: Browser;
  /** Also write one PDF per page named {paper}_{date}_p{NN}.pdf (rendered per page; no merge step needed). */
  perPage?: boolean;
  /** When given, files are written here. */
  outDir?: string;
  /**
   * Pictures in the screen PDF are scaled down and stored as JPEG (default: 1280 px long edge, quality 75). `false` keeps
   * them as Chromium wrote them (full size). Only the screen PDF does this: the originals stay in the files store for print and IDML.
   */
  images?: ScreenImageOptions | false;
}
export interface PdfFile { name: string; bytes: Buffer; page?: number }
export interface ScreenPdfResult {
  /** Whole edition. Name = {paper}_{date}_{first 10 hex of the content hash}.pdf, same input -> same name. */
  edition: PdfFile;
  pages: PdfFile[];
  hash: string;
  w_mm: number;
  h_mm: number;
  elapsed_ms: number;
}

const mm = (n: number) => `${+n.toFixed(3)}mm`;
const slug = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-");

/** The HTML Chromium prints: @page = the template's paper size, each .page zoomed from canvas px to paper mm. */
export function buildPrintHtml(pages: readonly EditionPage[], articles: readonly Article[] = [], title = "edition"): { html: string; w_mm: number; h_mm: number } {
  if (!pages.length) throw new Error("no pages to export");
  const { w_mm, h_mm } = pages[0]!.doc.page;
  for (const p of pages) {
    if (Math.abs(p.doc.page.w_mm - w_mm) > 0.01 || Math.abs(p.doc.page.h_mm - h_mm) > 0.01)
      throw new Error(`mixed page sizes in one PDF (page ${p.doc.page.no} is ${p.doc.page.w_mm}x${p.doc.page.h_mm} mm, first is ${w_mm}x${h_mm} mm)`);
  }
  const canvas = pages[0]!.template.canvas_px;
  const z = (w_mm * 96) / 25.4 / canvas; // paper px / canvas px
  const rendered = pages.map((p) => renderPage(p.doc, p.template, articles, { fontBase: SERVER_FONT_BASE }));
  // Each page is laid out on the canvas (the same layout the editor shows at any zoom) and scaled to paper by a transform,
  // never by CSS zoom: zoom re-runs line breaking at another size and can move a word to the next line.
  const doc = renderDocument(rendered.map((r) => ({ ...r, html: `<div class="sheetbox">${r.html}</div>` })), title);
  const extra = `@page{size:${mm(w_mm)} ${mm(h_mm)};margin:0}
html,body{margin:0;background:#fff}
.sheetbox{width:${mm(w_mm)};height:${mm(h_mm)};overflow:hidden;position:relative;break-after:page;page-break-after:always}
.sheetbox:last-child{break-after:auto;page-break-after:auto}
.page{--z:${z.toFixed(6)}!important;height:${((canvas * h_mm) / w_mm).toFixed(3)}px!important;min-height:0!important;overflow:hidden;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}`;
  return { html: doc.replace("</style>", `\n${extra}</style>`), w_mm, h_mm };
}

/**
 * Chromium rounds the page box to whole points (578 mm -> 1638 pt = 577.85 mm, 0.15 mm short).
 * The done-when is 0.1 mm, so the boxes are set to the exact size, keeping the page top where Chromium drew it
 * (the sub-point difference is added below the page, which is paper-coloured).
 */
async function exactBoxes(raw: Buffer, w_mm: number, h_mm: number): Promise<Buffer> {
  const pt = (m: number) => Math.round((m * 72 * 1000) / 25.4) / 1000;
  const w = pt(w_mm), h = pt(h_mm);
  const doc = await PDFDocument.load(raw, { updateMetadata: false });
  for (const p of doc.getPages()) {
    const { x, y, width, height } = p.getMediaBox();
    const top = y + height;
    const left = x;
    const box = [left, top - h, w, h] as const;
    p.setMediaBox(...box);
    p.setCropBox(...box);
    p.setTrimBox(...box);
    p.setBleedBox(...box);
    p.setArtBox(...box);
    void width;
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

async function printPdf(browser: Browser, html: string, w_mm: number, h_mm: number, images: ScreenImageOptions | false): Promise<Buffer> {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await installFonts(page);
    await page.setContent(html, { waitUntil: "load" });
    // faces load lazily: ask for each one, then wait, so the PDF is never printed with a fallback font
    // (also reads every cut-out photo's outline, so the PDF wraps text round it exactly as the editor does)
    await page.evaluate(domReady);
    const raw = await page.pdf({ width: mm(w_mm), height: mm(h_mm), preferCSSPageSize: true, printBackground: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } });
    return await exactBoxes(images ? (await recompressPdfImages(raw, images)).bytes : raw, w_mm, h_mm);
  } finally {
    await ctx.close();
  }
}

/** Screen PDF (RGB proof / e-paper source): real text layer, fonts embedded by Chromium. */
export async function exportScreenPdf(opts: ScreenPdfOptions): Promise<ScreenPdfResult> {
  const t0 = Date.now();
  const articles = opts.articles ?? [];
  const images = opts.images === undefined ? SCREEN_IMAGES : opts.images;
  const whole = buildPrintHtml(opts.pages, articles, `${opts.paper} ${opts.date}`);
  const hash = createHash("sha256").update(whole.html).update(`${whole.w_mm}x${whole.h_mm}`).update(images ? `img${images.max_edge}q${images.quality}` : "img-full").digest("hex");
  const base = `${slug(opts.paper)}_${slug(opts.date)}`;
  const browser = opts.browser ?? (await chromium.launch());
  try {
    const edition: PdfFile = { name: `${base}_${hash.slice(0, 10)}.pdf`, bytes: await printPdf(browser, whole.html, whole.w_mm, whole.h_mm, images) };
    const pages: PdfFile[] = [];
    if (opts.perPage) {
      for (const p of opts.pages) {
        const one = buildPrintHtml([p], articles, `${opts.paper} ${opts.date} p${p.doc.page.no}`);
        pages.push({ name: `${base}_p${String(p.doc.page.no).padStart(2, "0")}.pdf`, page: p.doc.page.no, bytes: await printPdf(browser, one.html, one.w_mm, one.h_mm, images) });
      }
    }
    if (opts.outDir) {
      await mkdir(opts.outDir, { recursive: true });
      for (const f of [edition, ...pages]) await writeFile(join(opts.outDir, f.name), f.bytes);
    }
    return { edition, pages, hash, w_mm: whole.w_mm, h_mm: whole.h_mm, elapsed_ms: Date.now() - t0 };
  } finally {
    if (!opts.browser) await browser.close();
  }
}

export class PressPdfNotAvailable extends Error {
  readonly experimental = true;
  constructor() {
    super("Press PDF is phase 2 and needs the client's press profile (ICC, PDF/X output intent, image dpi, preflight rules). Not implemented; no press specs are invented.");
    this.name = "PressPdfNotAvailable";
  }
}
/**
 * Press PDF (CMYK, PDF/X). Phase 2, labelled EXPERIMENTAL until one press trial is signed off.
 * TODO(M7 phase 2): Ghostscript RGB->CMYK with the client's newspaper ICC profile, PDF/X output intent,
 * images to the client's dpi, preflight report. All of these come from the client's press spec (WAITING ON OWNER).
 */
export async function exportPressPdf(_opts: ScreenPdfOptions): Promise<never> {
  throw new PressPdfNotAvailable();
}
