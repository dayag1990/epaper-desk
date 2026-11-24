// Tamil line-break proof, server side: the headless render at editor zoom 0.5 / 1 / 1.5 and the PDF (exportScreenPdf, text read with pdftotext).
// The editor side (real editor build) is apps/editor/e2e-ta/linebreaks.spec.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import type { Article } from "@epaper/core";
import { exportScreenPdf } from "../../packages/export/dist/index.js";
import { LayoutEngine, type DomLine, type PageDoc, type Template } from "../../packages/layout/dist/index.js";
import { badStart, ingestTamil, matchPage, pdfFonts, pdfWords, planTamil, proofDocs, proofInputs, squash, taTemplates } from "./lib/tamil.js";

let eng: LayoutEngine, browser: Browser, arts: Article[];
let docs: { doc: PageDoc; template: Template }[] = [];
const lines: Record<number, Record<string, DomLine[]>> = {};
let pdf: Awaited<ReturnType<typeof exportScreenPdf>>;

beforeAll(async () => {
  eng = await LayoutEngine.launch();
  browser = await chromium.launch();
  arts = await ingestTamil();
  const plan = await planTamil(eng, arts);
  const all = [...plan.pages.map((p) => ({ doc: p.fit.doc, template: p.template })), ...proofDocs(arts, taTemplates())];
  // stored size = the size the fit loop gives, as the editor stores it
  for (const { doc, template } of all) docs.push({ doc: (await eng.fit(doc, template, arts)).doc, template });
  for (const { doc, template } of docs) {
    await eng.load(doc, template, arts);
    lines[doc.page.no] = {};
    for (const z of [1, 0.5, 1.5]) lines[doc.page.no]![String(z)] = await eng.lines(z);
  }
  pdf = await exportScreenPdf({ paper: "ta", date: "2026-11-24", pages: docs, articles: arts, browser });
}, 240_000);
afterAll(async () => { await eng?.close(); await browser?.close(); });

describe("line breaks: headless render at three zooms vs the PDF", () => {
  it("has 8 planned pages and 2 proof pages with 8 headlines and 8 paragraphs", () => {
    expect(docs.map((d) => d.doc.page.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const { paragraphs, headlines } = proofInputs(arts);
    expect(paragraphs).toHaveLength(8);
    expect(headlines).toHaveLength(8);
    expect(new Set(paragraphs.map((p) => p.text)).size).toBe(8);
    const p10 = docs[9]!.doc.items.map((i) => i.text!.body[0]);
    expect(p10).toEqual(paragraphs.map((p) => p.text));
    expect(docs[8]!.doc.items.map((i) => i.text!.head)).toEqual(headlines.map((h) => h.text));
    // the proof paragraphs cover digits, Latin acronyms, quotes, rupee amounts and hyphen ranges
    const all = paragraphs.map((p) => p.text).join("\n");
    expect(all).toMatch(/\d,\d{3}/); expect(all).toMatch(/\(GST\)/); expect(all).toMatch(/“/); expect(all).toMatch(/ரூ\./); expect(all).toMatch(/\b3-1\b/);
  });

  it("breaks every line the same at zoom 0.5, 1 and 1.5 (zoom is a transform, not a re-layout)", () => {
    let n = 0;
    for (const [no, z] of Object.entries(lines)) {
      const t = (k: string) => z[k]!.map((l) => `${l.key}#${l.n}|${l.text}`);
      expect(t("0.5"), `page ${no} zoom 0.5`).toEqual(t("1"));
      expect(t("1.5"), `page ${no} zoom 1.5`).toEqual(t("1"));
      expect(z["0.5"]!.map((l) => l.first), `first words, page ${no}`).toEqual(z["1"]!.map((l) => l.first));
      n += z["1"]!.length;
    }
    expect(n).toBeGreaterThan(1500); // the stories were trimmed to fit eight pages (was 2,706 lines)
  });

  it("no line starts with a vowel sign, pulli or other combining mark (never a broken cluster)", () => {
    for (const z of Object.values(lines)) for (const l of z["1"]!) expect(badStart(l.text), `${l.key}#${l.n}: ${l.text}`).toBe(false);
  });

  it("every line of the PDF is the line the browser broke, in the same place; first word identical", () => {
    const ws = pdfWords(pdf.edition.bytes);
    let n = 0;
    for (const { doc, template } of docs) {
      const k = (doc.page.w_mm / 25.4 * 72) / template.canvas_px;
      const { matched, stray } = matchPage(lines[doc.page.no]!["1"]!, ws.filter((w) => w.page === doc.page.no), k);
      expect(stray.map((w) => w.text), `page ${doc.page.no}: PDF words on no line`).toEqual([]);
      for (const m of matched) {
        expect(squash(m.pdf), `${m.line.key}#${m.line.n}, page ${doc.page.no}`).toBe(squash(m.line.text));
        expect(squash(m.pdf).startsWith(squash(m.line.first))).toBe(true);
        expect(badStart(m.pdf.trim()), `PDF line starts with a combining mark: ${m.pdf}`).toBe(false);
        n++;
      }
    }
    console.log(`server: ${n} lines on ${docs.length} pages, PDF = browser at zoom 1 = 0.5 = 1.5`);
  });

  it("the PDF text is the exact NFC text of every headline, kicker, sub-head and paragraph", () => {
    const ws = pdfWords(pdf.edition.bytes);
    let elements = 0;
    for (const { doc, template } of docs) {
      const k = (doc.page.w_mm / 25.4 * 72) / template.canvas_px;
      const { matched } = matchPage(lines[doc.page.no]!["1"]!, ws.filter((w) => w.page === doc.page.no), k);
      const got = new Map<string, string>();
      for (const m of matched) got.set(m.line.key, (got.get(m.line.key) ?? "") + m.pdf);
      for (const it of doc.items) {
        const want: [string, string | null | undefined][] = [[`${it.id}.kicker`, it.text?.kicker], [`${it.id}.head`, it.text?.head], [`${it.id}.sub`, it.text?.sub]];
        (it.text?.body ?? []).forEach((b, i) => want.push([`${it.id}.body.${i}`, b]));
        for (const [key, src] of want) {
          if (!src) continue;
          expect(src.normalize("NFC")).toBe(src);
          expect(squash(got.get(key) ?? ""), `${key} page ${doc.page.no}`).toBe(squash(src));
          elements++;
        }
      }
    }
    expect(elements).toBeGreaterThan(200); // trimmed stories (was 330 text elements)
  });

  it("pdffonts lists Noto Serif Tamil and Anek Tamil, all embedded", () => {
    const f = pdfFonts(pdf.edition.bytes);
    expect(f.length).toBeGreaterThan(1);
    expect(f.every((x) => x.emb), JSON.stringify(f)).toBe(true);
    expect(f.some((x) => /NotoSerifTamil/.test(x.name))).toBe(true);
    expect(f.some((x) => /AnekTamil/.test(x.name))).toBe(true);
  });
});
