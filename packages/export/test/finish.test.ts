import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { LayoutEngine } from "@epaper/layout";
import { exportScreenPdf } from "../src/index.js";
import { extractTextLayer, buildEdition } from "../../epaper/src/index.js";
import { showcase } from "../../layout/test/finish-fixture.js";

const tmp = mkdtempSync(join(tmpdir(), "finish-pdf-"));
const run = (cmd: string, ...args: string[]) => execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 26 });
let browser: Browser, engine: LayoutEngine, pdf: string;
const sc = showcase();

beforeAll(async () => {
  browser = await chromium.launch();
  engine = await LayoutEngine.launch();
  const r = await exportScreenPdf({ paper: "finish", date: "2026-11-27", pages: [{ doc: sc.doc, template: sc.template }], articles: sc.articles, browser, outDir: tmp });
  pdf = join(tmp, r.edition.name);
}, 120000);
afterAll(async () => { await engine.close(); await browser.close(); });

describe("the finish in the screen PDF and the e-paper text layer", () => {
  it("prints byline, dateline, jump lines, pull quote, kicker, caption and credit as real text", () => {
    const text = run("pdftotext", "-raw", pdf, "-").replace(/\s+/g, " ").toLowerCase();
    for (const s of ["by hannah oakes", "riverton, 27 nov", "riverton, 26 nov", "continued on page 3", "continued from page 1", "we avoided a bridge that nobody wanted to pay for", "maria delaney, councillor", "fact box", "councillor maria delaney at the bridge", "jane doe, riverton herald", "page 2"]) expect(text, s).toContain(s);
  });
  it("the same text is in the e-paper text layer (read from the PDF the way the e-paper build reads it)", async () => {
    const layer = await extractTextLayer(pdf, 1);
    const all = layer.lines.map((l) => l.text).join(" ").replace(/\s+/g, " ").toLowerCase();
    for (const s of ["hannah oakes", "continued on page 3", "we avoided a bridge", "riverton, 26 nov"]) expect(all, s).toContain(s);
    expect(buildEdition).toBeTypeOf("function");
  });
  it("the cut-out wrap in the PDF is the wrap the editor shows: the same lines start at the same places, to 2 px", async () => {
    await engine.load(sc.doc, sc.template, sc.articles);
    const figRight = await engine["page"].evaluate(() => document.querySelector(".cutbox")!.getBoundingClientRect().right - document.querySelector(".page")!.getBoundingClientRect().left);
    const dom = (await engine.lines()).filter((l) => l.key === "it_lead.body.0" || l.key === "it_lead.body.1");
    const solo = await exportScreenPdf({ paper: "solo", date: "2026-11-27", pages: [{ doc: sc.doc, template: sc.template }], articles: sc.articles, browser, outDir: tmp });
    const xml = run("pdftotext", "-bbox-layout", join(tmp, solo.edition.name), "-");
    const k = sc.template.canvas_px / ((sc.doc.page.w_mm / 25.4) * 72); // canvas px per pt
    const words = [...xml.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="[\d.]+" yMax="[\d.]+">([^<]*)<\/word>/g)].map((m) => ({ x: +m[1]! * k, y: +m[2]! * k, t: m[3]! }));
    let matched = 0, worst = 0, inFigure = 0;
    for (const l of dom) {
      const w = words.filter((p) => p.t === l.first && Math.abs(p.y - l.y0) < 9 && Math.abs(p.x - l.x0) < 120).sort((a, b) => Math.abs(a.x - l.x0) - Math.abs(b.x - l.x0))[0];
      if (!w) continue;
      matched++; worst = Math.max(worst, Math.abs(w.x - l.x0));
      if (l.x0 < figRight - 6) inFigure++;
    }
    console.log(`cut-out wrap: ${matched}/${dom.length} lines matched, worst x difference ${worst.toFixed(2)} px, lines that start inside the figure's box (round the outline): ${inFigure}`);
    expect(matched).toBeGreaterThan(dom.length * 0.8);
    expect(worst).toBeLessThanOrEqual(2);
    expect(inFigure).toBeGreaterThan(0);
  }, 120000);
  it("renders to a picture (pdftoppm) that is not blank", () => {
    run("pdftoppm", "-r", "30", "-png", pdf, join(tmp, "p"));
    expect(readFileSync(join(tmp, "p-1.png")).length).toBeGreaterThan(5000);
  });
});
