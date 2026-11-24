import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import sharp from "sharp";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { ArticleSchema } from "@epaper/core";
import { LayoutEngine, autoPlan, loadTemplateSet } from "@epaper/layout";
import { SCREEN_IMAGES, exportScreenPdf, recompressPdfImages } from "../src/index.js";

const tmp = mkdtempSync(join(tmpdir(), "pdfimg-"));
const run = (cmd: string, ...args: string[]) => execFileSync(cmd, args, { encoding: "utf8" });
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); }, 60000);
afterAll(async () => { await browser.close(); });

/** A noisy photo-like JPEG (a flat one compresses to nothing and proves nothing). */
async function photo(w: number, h: number): Promise<Buffer> {
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (Math.sin(i * 0.00013) * 90 + 128 + ((i * 2654435761) >>> 24) * 0.25) & 255;
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
}

async function printed(imgs: Buffer[]): Promise<Buffer> {
  const page = await browser.newPage();
  const html = `<html><body style="margin:0;font:20px serif"><h1>Headline kept as text</h1>${imgs
    .map((b) => `<div style="width:300px;aspect-ratio:2.3;overflow:hidden"><img style="width:100%;height:100%;object-fit:cover" src="data:image/jpeg;base64,${b.toString("base64")}"></div>`)
    .join("")}<p>Body text stays selectable.</p></body></html>`;
  await page.setContent(html, { waitUntil: "load" });
  const pdf = await page.pdf({ width: "120mm", height: "250mm", printBackground: true });
  await page.close();
  return pdf;
}
const list = (file: string) => run("pdfimages", "-list", file).trim().split("\n").slice(2).map((l) => l.trim().split(/\s+/));

describe("screen PDF pictures", () => {
  it("Chromium writes a cropped 3000 px photo as raw pixels; after the pass it is a JPEG of at most 1280 px, far smaller, text and fonts untouched", async () => {
    const big = await photo(3000, 2000);
    const raw = await printed([big, await photo(2400, 1600)]);
    const before = join(tmp, "before.pdf"), after = join(tmp, "after.pdf");
    writeFileSync(before, raw);
    const rawImgs = list(before);
    expect(rawImgs.length).toBe(2);
    expect(rawImgs.every((r) => r[8] === "image")).toBe(true); // raw, deflated
    expect(Math.max(...rawImgs.map((r) => +r[3]!))).toBeGreaterThan(2000);

    const r = await recompressPdfImages(raw);
    writeFileSync(after, r.bytes);
    const imgs = list(after);
    expect(imgs.length).toBe(2);
    for (const i of imgs) {
      expect(i[8], "stored as JPEG").toBe("jpeg");
      expect(Math.max(+i[3]!, +i[4]!)).toBeLessThanOrEqual(SCREEN_IMAGES.max_edge);
    }
    expect(r.report).toMatchObject({ images: 2, recompressed: 2 });
    expect(r.bytes.length).toBeLessThan(raw.length / 5);
    // text layer and fonts survive
    const text = run("pdftotext", after, "-");
    expect(text).toContain("Headline kept as text");
    expect(text).toContain("Body text stays selectable.");
    const fonts = run("pdffonts", after).trim().split("\n").slice(2);
    expect(fonts.length).toBeGreaterThan(0);
    for (const f of fonts) expect(f).toMatch(/\byes\s+(yes|no)\s+(yes|no)\b/);
    expect(run("pdfinfo", after)).toMatch(/Pages:\s+1\b/);
    // the picture still looks like the picture: render it back and compare the mean colour with the unprocessed PDF
    const png = (f: string) => { run("pdftoppm", "-r", "40", "-png", "-singlefile", f, f.replace(/\.pdf$/, "")); return f.replace(/\.pdf$/, ".png"); };
    const a = await sharp(png(before)).stats(), b = await sharp(png(after)).stats();
    for (let c = 0; c < 3; c++) expect(Math.abs(a.channels[c]!.mean - b.channels[c]!.mean)).toBeLessThan(6);
  }, 120000);

  it("a picture already smaller than the limit is not scaled up, and a pass over a PDF with no pictures changes nothing", async () => {
    const small = await recompressPdfImages(await printed([await photo(900, 600)]), { max_edge: 1280, quality: 75 });
    const f = join(tmp, "small.pdf");
    writeFileSync(f, small.bytes);
    const [row] = list(f);
    expect(Math.max(+row![3]!, +row![4]!)).toBeLessThanOrEqual(900);
    const page = await browser.newPage();
    await page.setContent("<p>no pictures</p>");
    const plain = await page.pdf();
    await page.close();
    const r = await recompressPdfImages(plain);
    expect(r.report).toMatchObject({ images: 0, recompressed: 0 });
  }, 60000);
});

describe("exportScreenPdf pictures", () => {
  it("the screen PDF scales photos down by default; images:false keeps them as Chromium wrote them", async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
    const src = "data:image/jpeg;base64," + (await photo(3200, 2100)).toString("base64");
    const arts = (JSON.parse(readFileSync(join(root, "fixtures/english-15.json"), "utf8")) as { articles: unknown[] }).articles
      .map((a) => ArticleSchema.parse(a)).filter((a) => a.images.length).slice(0, 2)
      .map((a) => ({ ...a, images: a.images.map((i) => ({ ...i, src })) }));
    const engine = await LayoutEngine.launch();
    try {
      const t = loadTemplateSet(join(root, "templates/broadsheet-en"));
      const plan = await autoPlan(engine, arts, t, { pages: 1, bySection: false, date: "TUESDAY" });
      const pages = plan.pages.map((p) => ({ doc: p.doc, template: p.template }));
      const small = await exportScreenPdf({ paper: "t", date: "2026-11-24", pages, articles: arts, browser });
      const full = await exportScreenPdf({ paper: "t", date: "2026-11-24", pages, articles: arts, browser, images: false });
      const fs = join(tmp, "small-edition.pdf"), ff = join(tmp, "full-edition.pdf");
      writeFileSync(fs, small.edition.bytes);
      writeFileSync(ff, full.edition.bytes);
      expect(list(fs).length).toBe(2);
      for (const r of list(fs)) { expect(r[8]).toBe("jpeg"); expect(Math.max(+r[3]!, +r[4]!)).toBeLessThanOrEqual(1280); }
      expect(Math.max(...list(ff).map((r) => +r[3]!))).toBeGreaterThan(1280);
      expect(small.edition.bytes.length).toBeLessThan(full.edition.bytes.length / 4);
      expect(small.edition.name).not.toBe(full.edition.name);
      expect(run("pdftotext", fs, "-")).toContain(arts[0]!.headline.split(" ")[0]!);
    } finally { await engine.close(); }
  }, 180000);
});
