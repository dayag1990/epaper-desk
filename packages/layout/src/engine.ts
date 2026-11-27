import { chromium, type Browser, type Page } from "playwright";
import { LayoutSnapshotSchema, type Article, type LayoutSnapshot, type PageDoc } from "@epaper/core";
import { domFill, domFrames, domHoles, domLines, domReady, domSpaceStats, type DomLine, type RawFrame, type SpaceStat } from "./dom.js";
import { fitBodySizeAsync, lowResCheck, type FitResult } from "./fit.js";
import { renderDocument, renderPage, type RenderOptions } from "./render.js";
import { SERVER_FONT_BASE, installFonts } from "./fonts.js";
import type { Template } from "./template.js";
import { pxToPt, round, storedBodyPx } from "./units.js";

export interface LowResWarning {
  item: string;
  asset_id?: string;
  natural_px: number;
  need_px: number;
  dpi: number;
}
export interface FitReport {
  doc: PageDoc; // body_pt set to the fitted size
  body_px: number;
  fill: number; // raw ratio, may exceed 1
  fill_pct: number; // rounded, may exceed 100
  overflow: boolean;
  overflow_pct: number; // 0 when it fits
  state: "ok" | "low" | "over";
  steps: number;
  low_res: LowResWarning[];
  /** Empty paper left under short stories in stretched rows, as a % of the sheet (ruled pages; 0 when none). */
  hole_pct?: number;
}
export interface FitOptions {
  /** After the text size hits its minimum and the page still overflows, make images shorter (ratio x1.2) up to this many times. 0 = off (prototype behaviour). */
  imageSqueeze?: number;
}

const fillArgs = (doc: PageDoc, t: Template) => ({
  padTB: t.pad.top + t.pad.bottom,
  canvas: t.canvas_px,
  wmm: doc.page.w_mm,
  hmm: doc.page.h_mm,
});

/** Headless Chromium (Playwright bundled build) that renders PageDocs with the one renderer. */
export class LayoutEngine {
  private constructor(private browser: Browser, private page: Page) {}

  static async launch(): Promise<LayoutEngine> {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
    return LayoutEngine.fromPage(browser, await ctx.newPage());
  }
  /** An engine on a page of a browser somebody else owns (the worker's pool). Installs the font route. */
  static async fromPage(browser: Browser, page: Page): Promise<LayoutEngine> {
    await installFonts(page);
    return new LayoutEngine(browser, page);
  }
  async close(): Promise<void> {
    await this.browser.close();
  }

  /** Load one page into Chromium and wait until fonts and images settle. */
  async load(doc: PageDoc, t: Template, articles: readonly Article[] = [], opts: RenderOptions = {}): Promise<void> {
    const r = renderPage(doc, t, articles, { fontBase: SERVER_FONT_BASE, ...opts });
    await this.page.setContent(renderDocument([r], `page ${doc.page.no}`), { waitUntil: "load" });
    await this.page.evaluate(domReady);
  }

  /** Every line of text of the page loaded last, as broken at editor zoom `zoom` (a transform: it must not matter). */
  async lines(zoom = 1): Promise<DomLine[]> {
    await this.page.evaluate((z) => document.querySelector<HTMLElement>(".page")!.style.setProperty("--z", String(z)), zoom);
    return this.page.evaluate(domLines);
  }

  /** Font sizes (px on the canvas) of the caption and of the credit run, on the page loaded last (0 when there is none). */
  async captionSizes(): Promise<{ caption: number; credit: number }> {
    return this.page.evaluate(() => {
      const c = document.querySelector(".cap"), r = document.querySelector(".cap .credit");
      return { caption: c ? parseFloat(getComputedStyle(c).fontSize) : 0, credit: r ? parseFloat(getComputedStyle(r).fontSize) : 0 };
    });
  }

  /** The masthead name on the page loaded last: its font size and how many lines it takes. */
  async mastheadBox(): Promise<{ fontPx: number; lines: number }> {
    return this.page.evaluate(() => {
      const n = document.querySelector<HTMLElement>(".mast .name");
      if (!n) return { fontPx: 0, lines: 0 };
      const cs = getComputedStyle(n);
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
      return { fontPx: parseFloat(cs.fontSize), lines: Math.round((n.getBoundingClientRect().height - parseFloat(cs.paddingBottom || "0")) / lh) };
    });
  }

  /** Word-space growth, characters per line and rag of the body text of the page loaded last (see domSpaceStats). */
  async spaceStats(extraCss = ""): Promise<SpaceStat[]> {
    if (extraCss) await this.page.addStyleTag({ content: extraCss });
    return this.page.evaluate(domSpaceStats);
  }

  private async fillAt(doc: PageDoc, t: Template, px?: number): Promise<number> {
    return this.page.evaluate(domFill, { ...fillArgs(doc, t), fsPx: px });
  }

  /** Measure the page as it stands in `doc` (no fitting). */
  async measure(doc: PageDoc, t: Template, articles: readonly Article[] = []): Promise<FitReport> {
    await this.load(doc, t, articles);
    const fill = await this.fillAt(doc, t);
    const px = storedBodyPx(doc.page.body_pt, t);
    return this.report(doc, t, fill, px, 0);
  }

  /**
   * Fit loop for one page: render, measure fill %, step the body size down within [min, max],
   * then (optionally) squeeze image ratios, then flag overflow honestly. No AI involved.
   */
  async fit(doc: PageDoc, t: Template, articles: readonly Article[] = [], opts: FitOptions = {}): Promise<FitReport> {
    let cur = doc;
    await this.load(cur, t, articles);
    const params = { start: Math.min(t.body.start_px, t.body.max_px), min: t.body.min_px, step: t.body.step_px };
    const loop = (): Promise<FitResult> => fitBodySizeAsync((px) => this.fillAt(cur, t, px), params);
    let res = await loop();
    let squeeze = opts.imageSqueeze ?? 0;
    while (res.overflow && squeeze > 0 && cur.items.some((i) => i.image && i.kind !== "ad")) {
      squeeze--;
      cur = {
        ...cur,
        items: cur.items.map((i) => (i.image && i.kind !== "ad" ? { ...i, image: { ...i.image, ratio: round(i.image.ratio * 1.2, 2) } } : i)),
      };
      await this.load(cur, t, articles);
      res = await loop();
    }
    return this.report(cur, t, res.fill, res.px, res.steps);
  }

  /**
   * Grow-to-fill, for a page the normal fit loop leaves under `target` (fill ratio): load once, then
   * pick the smallest body size in [start, max] whose fill reaches `target` without overflowing.
   * Falls back to the largest size that still fits. The fit loop itself (fit) is untouched; this only
   * chooses a larger starting size, within the template's own limits, and reports honestly.
   */
  async fitGrow(doc: PageDoc, t: Template, articles: readonly Article[] = [], target = 0.9): Promise<FitReport> {
    await this.load(doc, t, articles);
    const step = t.body.step_px;
    const lo0 = Math.min(t.body.start_px, t.body.max_px);
    const n = Math.max(0, Math.floor((t.body.max_px - lo0) / step + 1e-9));
    const px = (i: number) => +(lo0 + i * step).toFixed(2);
    const memo = new Map<number, number>();
    const at = async (i: number) => { if (!memo.has(i)) memo.set(i, await this.fillAt(doc, t, px(i))); return memo.get(i)!; };
    // largest index that does not overflow (fill is non-decreasing in size)
    let a = 0, b = n;
    if ((await at(0)) > 1) { const r = await fitBodySizeAsync((p) => this.fillAt(doc, t, p), { start: lo0, min: t.body.min_px, step }); return this.report(doc, t, r.fill, r.px, r.steps); }
    while (a < b) { const m = (a + b + 1) >> 1; if ((await at(m)) <= 1) a = m; else b = m - 1; }
    const hi = a;
    let best = hi;
    if ((await at(hi)) >= target) {
      let l = 0, h = hi;
      while (l < h) { const m = (l + h) >> 1; if ((await at(m)) >= target) h = m; else l = m + 1; }
      best = l;
    }
    const fill = await this.fillAt(doc, t, px(best));
    return this.report(doc, t, fill, px(best), memo.size);
  }

  private async report(doc: PageDoc, t: Template, fill: number, px: number, steps: number): Promise<FitReport> {
    const pct = Math.round(fill * 100);
    const raw = await this.page.evaluate(domFrames);
    const hole_pct = round((await this.page.evaluate(domHoles)) * 100, 1);
    const low: LowResWarning[] = [];
    for (const fr of raw.frames) {
      if (fr.role !== "image" || !fr.natW) continue;
      const wmm = fr.w * doc.page.w_mm;
      const c = lowResCheck(fr.natW, wmm);
      if (c.low) low.push({ item: fr.item, asset_id: fr.asset, natural_px: fr.natW, need_px: Math.round(c.needPx), dpi: round(c.dpi, 1) });
    }
    return {
      doc: { ...doc, page: { ...doc.page, body_pt: round(pxToPt(px, t), 3) } },
      body_px: px,
      fill,
      fill_pct: pct,
      overflow: fill > 1,
      overflow_pct: Math.max(0, pct - 100),
      state: pct > 100 ? "over" : pct < 85 ? "low" : "ok",
      steps,
      low_res: low,
      hole_pct,
    };
  }

  /** Screenshot one page (PNG), for the editor-vs-headless comparison. */
  async screenshot(doc: PageDoc, t: Template, articles: readonly Article[] = []): Promise<Buffer> {
    await this.load(doc, t, articles);
    return (await this.page.locator(".page").screenshot()) as Buffer;
  }

  /** LayoutSnapshot (D4) for already-fitted PageDocs: every frame in mm, origin page top-left. */
  async snapshot(edition_id: string, docs: readonly { doc: PageDoc; template: Template }[], articles: readonly Article[] = []): Promise<LayoutSnapshot> {
    const pages = [];
    for (const { doc, template: t } of docs) {
      await this.load(doc, t, articles);
      const fill = await this.fillAt(doc, t);
      const raw = await this.page.evaluate(domFrames);
      const mm = (v: number) => round(v * doc.page.w_mm, 2);
      const pxMm = (px: number) => (px * doc.page.w_mm) / raw.pageW;
      const frames = raw.frames.map((f) => this.frame(f, doc, t, mm, pxMm));
      pages.push({ no: doc.page.no, w: doc.page.w_mm, h: doc.page.h_mm, fill_pct: Math.min(100, Math.round(fill * 100)), frames });
    }
    return LayoutSnapshotSchema.parse({ edition_id, unit: "mm", origin: "page top-left", pages });
  }

  private frame(f: RawFrame, doc: PageDoc, t: Template, mm: (v: number) => number, pxMm: (px: number) => number) {
    const id = `${f.item}.${f.role}${f.sfx ?? ""}`;
    const base = { id, item: f.item, role: f.role, x: mm(f.x), y: mm(f.y), w: mm(f.w), h: mm(f.h) };
    // fontPx is as laid out on the canvas; convert px on the canvas to pt on paper.
    const pt = f.fontPx ? round(pxToPt(f.fontPx, t), 2) : undefined;
    if (f.role === "image" || f.role === "ad") {
      const item = doc.items.find((i) => i.id === f.item);
      let crop: [number, number, number, number] = [0, 0, 1, 1];
      if (f.natW && f.natH && f.w && f.h) {
        const frameR = f.w / f.h, imgR = f.natW / f.natH, [fx, fy] = f.focal ?? [0.5, 0.5];
        if (imgR > frameR) { const w = frameR / imgR; crop = [round(Math.min(1 - w, Math.max(0, fx - w / 2)), 4), 0, round(w, 4), 1]; }
        else { const h = imgR / frameR; crop = [0, round(Math.min(1 - h, Math.max(0, fy - h / 2)), 4), 1, round(h, 4)]; }
      }
      return {
        ...base,
        ...(f.asset ? { asset_id: f.asset } : {}),
        ...(f.src ? { file: f.src.split("/").pop()!.split("?")[0] } : {}),
        crop,
        wrap: item?.image?.cutout ? ("alpha" as const) : ("none" as const),
      };
    }
    if (f.role === "rule") return { ...base, rule: f.rule, ...(f.color ? { color: f.color } : {}) };
    if (f.role === "box") return { ...base, ...(f.block ? { block: f.block } : {}), ...(f.color ? { color: f.color } : {}), ...(f.tint ? { tint: f.tint } : {}) };
    const common = { ...base, ...(f.style ? { style: f.style } : {}), ...(f.fontFamily ? { font: f.fontFamily } : {}), ...(pt ? { size_pt: pt } : {}), ...(f.block ? { block: f.block } : {}) };
    if (f.role === "body") {
      const bottom = f.y + f.h;
      const pageH = doc.page.h_mm / doc.page.w_mm;
      return {
        ...common, cols: f.cols, gutter: round(pxMm(f.gutterPx ?? 0), 2), paras: f.paras, overset: bottom > pageH + 0.001,
        ...(f.dropcap ? { dropcap_lines: t.finish?.dropcap_lines ?? 3 } : {}), ...(f.dateline ? { dateline: f.dateline } : {}),
      };
    }
    return { ...common, ...(f.text ? { text: f.text } : {}) };
  }
}
