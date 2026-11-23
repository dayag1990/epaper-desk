import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { ArticleSchema, type Article } from "@epaper/core";
import { LayoutEngine, autoPlan, loadTemplateSet } from "@epaper/layout";
import { PressPdfNotAvailable, exportPressPdf, exportScreenPdf, pageDocsToModel, toCXML, type EditionPage } from "../src/index.js";
import { parseCxml } from "./helpers/parse-cxml.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const articles: Article[] = (JSON.parse(readFileSync(join(ROOT, "fixtures/english-15.json"), "utf8")) as { articles: unknown[] }).articles.map((a) => ArticleSchema.parse(a));
const tmp = mkdtempSync(join(tmpdir(), "m7-"));
const run = (cmd: string, ...args: string[]) => execFileSync(cmd, args, { encoding: "utf8" });

let browser: Browser, page: Page, engine: LayoutEngine;
let pages: EditionPage[];
beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  engine = await LayoutEngine.launch();
  const plan = await autoPlan(engine, articles, loadTemplateSet(join(ROOT, "templates/broadsheet-en")), { pages: 4, date: "MONDAY, 23 NOVEMBER 2026" });
  pages = plan.pages.map((p) => ({ doc: p.doc, template: p.template }));
}, 120000);
afterAll(async () => { await engine.close(); await browser.close(); });

describe("screen PDF", () => {
  it("4-page English edition: page count, size to 0.1 mm, text layer, fonts embedded, deterministic name", async () => {
    const t0 = Date.now();
    const r = await exportScreenPdf({ paper: "gazette", date: "2026-11-23", pages, articles, browser, outDir: tmp, perPage: true });
    console.log("export 4 pages ms", Date.now() - t0, "(whole+4 per-page files)", "whole only ms", r.elapsed_ms);
    const file = join(tmp, r.edition.name);
    const info = run("pdfinfo", "-box", file);
    expect(info).toMatch(/Pages:\s+4\b/);
    const mmOf = (label: string) => {
      const m = new RegExp(`${label}:\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)`).exec(info)!;
      return [(+m[3]! - +m[1]!) * 25.4 / 72, (+m[4]! - +m[2]!) * 25.4 / 72];
    };
    for (const box of ["MediaBox", "CropBox"]) {
      const [w, h] = mmOf(box);
      expect(Math.abs(w! - 381)).toBeLessThan(0.1);
      expect(Math.abs(h! - 578)).toBeLessThan(0.1);
    }
    const sz = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(info)!;
    expect(Math.abs(+sz[1]! * 25.4 / 72 - 381)).toBeLessThan(0.1);
    expect(Math.abs(+sz[2]! * 25.4 / 72 - 578)).toBeLessThan(0.1);

    // text selectable: every headline is in the text layer
    const text = run("pdftotext", "-layout", file, "-").replace(/\s+/g, " ");
    const flat = (s: string) => s.replace(/\s+/g, " ").trim();
    const heads = pages.flatMap((p) => p.doc.items.map((i) => i.text?.head).filter((h): h is string => !!h));
    expect(heads.length).toBeGreaterThanOrEqual(10);
    // columns of other stories can interleave in -layout mode; compare per headline word sequence from raw mode
    const raw = flat(run("pdftotext", "-raw", file, "-"));
    for (const h of heads) expect(raw, h).toContain(flat(h));
    expect(text.length).toBeGreaterThan(2000);

    // fonts embedded
    const fonts = run("pdffonts", file).trim().split("\n").slice(2);
    expect(fonts.length).toBeGreaterThan(0);
    for (const l of fonts) expect(l, l).toMatch(/\syes\s+(yes|no)\s+(yes|no)\s+\d+\s+\d+\s*$/);

    // per-page files and deterministic names
    expect(r.pages.map((p) => p.name)).toEqual([1, 2, 3, 4].map((n) => `gazette_2026-11-23_p0${n}.pdf`));
    for (const p of r.pages) expect(run("pdfinfo", join(tmp, p.name))).toMatch(/Pages:\s+1\b/);
    const again = await exportScreenPdf({ paper: "gazette", date: "2026-11-23", pages, articles, browser });
    expect(again.edition.name).toBe(r.edition.name);
    expect(r.edition.name).toMatch(/^gazette_2026-11-23_[0-9a-f]{10}\.pdf$/);
    const changed = structuredClone(pages);
    changed[0]!.doc.items[0]!.text!.head += " X";
    expect((await exportScreenPdf({ paper: "gazette", date: "2026-11-23", pages: changed, articles, browser })).edition.name).not.toBe(r.edition.name);
  }, 180000);

  it("refuses mixed page sizes in one file", async () => {
    const bad = structuredClone(pages);
    bad[1]!.doc.page.w_mm = 280;
    await expect(exportScreenPdf({ paper: "x", date: "d", pages: bad, articles, browser })).rejects.toThrow(/mixed page sizes/);
  });
});

describe("press PDF", () => {
  it("is a labelled-experimental stub that needs the client's press profile", async () => {
    await expect(exportPressPdf({ paper: "x", date: "d", pages })).rejects.toBeInstanceOf(PressPdfNotAvailable);
    await expect(exportPressPdf({ paper: "x", date: "d", pages })).rejects.toMatchObject({ experimental: true });
  });
});

describe("ContentXML", () => {
  const poc = readFileSync(join(ROOT, "fixtures/blinkcms-poc.cxml"), "utf8");
  it("blinkcms-poc.cxml -> model -> toCXML -> parse gives the same model (Punjabi intact)", async () => {
    const m1 = await parseCxml(page, poc);
    expect(m1.sections.length).toBeGreaterThan(0);
    const xml = toCXML(m1);
    const m2 = await parseCxml(page, xml);
    expect(m2).toEqual(m1);
    const firstHead = /<tps:p type="Story-head">([^<]+)</.exec(poc)![1]!; // straight from the fixture bytes
    expect(xml).toContain(firstHead);
    expect(m2.sections[0]!.stories[0]!.paras[0]!.text).toBe(firstHead);
    expect(xml).toMatch(/[਀-੿]{8}/);
    // stable: a second export is byte-identical, and the namespace/root attributes survive
    expect(toCXML(m2)).toBe(xml);
    expect(xml).toContain('xmlns:tps="http://www.typefi.com/ContentXML"');
    // the sample's image links, kickers and ads are all still there
    const count = (m: typeof m1, f: (s: (typeof m1.sections)[0]["stories"][0]) => boolean) => m.sections.flatMap((s) => s.stories).filter(f).length;
    expect(count(m2, (s) => !!s.img)).toBe(count(m1, (s) => !!s.img));
    expect(count(m2, (s) => s.kind === "ad")).toBe(count(m1, (s) => s.kind === "ad"));
    expect(count(m2, (s) => !!s.kicker)).toBe(count(m1, (s) => !!s.kicker));
  });

  it("a changed span is written into the slot name", async () => {
    const m = await parseCxml(page, poc);
    const s = m.sections[0]!.stories.find((x) => /^story_col_span-3-/.test(x.type))!;
    s.span = 5;
    const m2 = await parseCxml(page, toCXML(m));
    expect(m2.sections[0]!.stories.some((x) => x.type.startsWith("story_col_span-5-"))).toBe(true);
  });

  it("an edited edition (PageDocs from the auto-plan) exports and re-parses with the same text", async () => {
    const model = pageDocsToModel(pages.map((p) => p.doc), articles);
    const xml = toCXML(model);
    writeFileSync(join(tmp, "edition.cxml"), xml);
    const back = await parseCxml(page, xml);
    expect(back.sections.length).toBe(4);
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    for (const [i, p] of pages.entries()) {
      const items = p.doc.items.filter((it) => it.kind !== "ad");
      const stories = back.sections[i]!.stories.filter((s) => s.kind !== "ad");
      expect(stories.length).toBe(items.length);
      items.forEach((it, n) => {
        const heads = stories[n]!.paras.filter((q) => /head/i.test(q.ptype) && !/sub/i.test(q.ptype)).map((q) => q.text);
        expect(heads.join(" ")).toBe(norm(it.text?.head ?? ""));
        expect(stories[n]!.paras.filter((q) => /body/i.test(q.ptype)).map((q) => q.text)).toEqual(it.text!.body.map(norm).filter(Boolean));
      });
    }
  });
});
