// Auto-plan of the 40 Tamil articles (through the connectors RSS adapter) onto 8 pages, one section per page, every page 85-100 % full.
// Photos are absent in the fixture, so a second run puts a placeholder photo on the lead story of every page.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Article } from "@epaper/core";
import { LayoutEngine, autoPlan, type PlanResult } from "../../packages/layout/dist/index.js";
import { DATE_TA, SECTIONS, ingestTamil, planTamil, taTemplates, withPlaceholder } from "./lib/tamil.js";

let eng: LayoutEngine, arts: Article[], plain: PlanResult, photo: PlanResult;
const line = (name: string, r: PlanResult) => `${name}: ${r.pages.map((p) => `p${p.doc.page.no} ${p.fit.fill_pct}% ${p.fit.body_px}px`).join(" | ")} | ${r.elapsed_ms} ms, ${r.evaluations} evals`;

beforeAll(async () => {
  eng = await LayoutEngine.launch();
  arts = await ingestTamil();
  plain = await planTamil(eng, arts);
  const leads = new Set(plain.pages.map((p) => p.articles[0]!));
  photo = await planTamil(eng, withPlaceholder(arts, leads));
  console.log(line("no photos", plain));
  console.log(line("lead photo", photo));
}, 240_000);
afterAll(async () => { await eng?.close(); });

describe("40 Tamil articles -> 8 pages", () => {
  it("was ingested through the RSS adapter: 40 articles, 8 sections of 5, Tamil, NFC", () => {
    expect(arts).toHaveLength(40);
    expect(arts.every((a) => a.lang === "ta" && a.script === "Taml")).toBe(true);
    for (const s of SECTIONS) expect(arts.filter((a) => a.section === s)).toHaveLength(5);
  });

  for (const [name, get] of [["without photos", () => plain], ["with a placeholder photo on every lead story", () => photo]] as const) {
    describe(name, () => {
      it("puts each section on its own page, in the paper's section order, and loses nothing", () => {
        const r = get();
        expect(r.unplaced).toEqual([]);
        expect(r.pages).toHaveLength(8);
        r.pages.forEach((p, i) => {
          expect(p.doc.page.no).toBe(i + 1);
          expect(p.articles).toHaveLength(5);
          expect(new Set(p.articles.map((id) => arts.find((a) => a.id === id)!.section))).toEqual(new Set([SECTIONS[i]!]));
          expect(p.template.set).toBe("broadsheet-ta");
          expect(p.template.id).toBe(i === 0 ? "front_a" : "inner_a");
        });
        expect(r.pages.flatMap((p) => p.articles).sort()).toEqual(arts.map((a) => a.id).sort());
      });

      it("fills every page 85-100 %, no overflow, no overset body frame", () => {
        for (const p of get().pages) {
          expect(p.fit.overflow, `page ${p.doc.page.no}`).toBe(false);
          expect(p.fit.fill, `page ${p.doc.page.no}`).toBeLessThanOrEqual(1);
          expect(p.fit.fill_pct, `page ${p.doc.page.no}`).toBeGreaterThanOrEqual(85);
          expect(p.fit.fill_pct, `page ${p.doc.page.no}`).toBeLessThanOrEqual(100);
          expect(p.fit.state).toBe("ok");
          expect(p.fit.body_px).toBeGreaterThanOrEqual(p.template.body.min_px);
        }
      });

      it("prints the Tamil date and the section name in the strip, with Tamil page labels", () => {
        get().pages.forEach((p, i) => {
          const strip = p.doc.furniture!.strip;
          if (i === 0) expect(p.doc.furniture!.masthead).toBe("தென்பொதிகை");
          else expect(strip[0]).toBe(SECTIONS[i]);
          expect(strip[1]).toBe(DATE_TA);
          if (i > 0) expect(strip[2]).toBe(`பக்கம் ${i + 1}`);
        });
      });
    });
  }

  it("the photo run has a photo on every page and still fits (the lead's picture takes room, the text size gives it)", () => {
    for (const p of photo.pages) expect(p.doc.items.filter((i) => i.image)).toHaveLength(1);
    expect(plain.pages.every((p) => p.doc.items.every((i) => !i.image))).toBe(true);
  });

  it("is deterministic: planning again gives the same pages", async () => {
    const again = await planTamil(eng, arts);
    expect(again.pages.map((p) => [p.articles, p.fit.fill_pct, p.fit.body_px])).toEqual(plain.pages.map((p) => [p.articles, p.fit.fill_pct, p.fit.body_px]));
  });
});

describe("sectionPages option", () => {
  it("orders the pages by the list, appends unlisted sections, skips listed sections with no articles, and stays optional", async () => {
    const some = arts.filter((a) => ["உலகம்", "சென்னை", "சினிமா"].includes(a.section));
    const r = await autoPlan(eng, some, taTemplates(), { sectionPages: ["சினிமா", "இல்லாத பிரிவு", "சென்னை"], date: DATE_TA });
    expect(r.pages.map((p) => p.doc.furniture!.strip[0])).toEqual(["டெமோ பதிப்பு", "சென்னை", "உலகம்"]); // page 1 is the front, with the edition line
    expect(r.pages[0]!.articles.every((id) => some.find((a) => a.id === id)!.section === "சினிமா")).toBe(true);
    expect(r.unplaced).toEqual([]);
    const free = await autoPlan(eng, some, taTemplates(), { date: DATE_TA });
    expect(free.pages).toHaveLength(3); // without the option: one page per section, as before
  }, 120_000);
});
