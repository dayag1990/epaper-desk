import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { join } from "node:path";
import { LayoutEngine, autoPlan, planTiers, tierCols, type PlanResult, type Template } from "../src/index.js";
import { englishArticles, punjabiArticles, ROOT, tplSet } from "./helpers.js";
import { art } from "./finish-fixture.js";

let eng: LayoutEngine, browser: Browser;
beforeAll(async () => { eng = await LayoutEngine.launch(); browser = await chromium.launch(); }, 60000);
afterAll(async () => { await eng.close(); await browser.close(); });

/** Every page: one lead (the first item), widest, with the biggest headline; photo biggest when it has one; fits; type at or above the minimum. */
async function expectUneven(name: string, r: PlanResult, arts: readonly never[] | readonly import("@epaper/core").Article[], minPxOf: (t: Template) => number) {
  const snap = await eng.snapshot("ed_UNEVEN1", r.pages.map((p) => ({ doc: p.doc, template: p.template })), arts as never);
  const summary: string[] = [];
  r.pages.forEach((p, i) => {
    const frames = snap.pages[i]!.frames;
    const items = p.doc.items.filter((it) => it.kind === "story");
    if (items.length < 2) return;
    const lead = items[0]!;
    const head = (id: string) => frames.find((f) => f.id === `${id}.head`)?.size_pt ?? 0;
    const maxOther = Math.max(...items.slice(1).map((it) => head(it.id)));
    expect(head(lead.id), `${name} p${p.doc.page.no}: lead headline is the biggest`).toBeGreaterThan(maxOther);
    const spans = items.map((it) => it.span ?? 0);
    expect(spans[0], `${name} p${p.doc.page.no}: lead is the widest`).toBe(Math.max(...spans));
    const cols = p.template.columns;
    expect(spans[0]!, `${name} p${p.doc.page.no}: lead spans most columns`).toBeGreaterThanOrEqual(Math.ceil(cols * 0.6));
    const area = (id: string) => { const f = frames.find((x) => x.id === `${id}.image`); return f ? f.w * f.h : 0; };
    if (area(lead.id) > 0) expect(area(lead.id), `${name} p${p.doc.page.no}: lead photo is the biggest`).toBeGreaterThanOrEqual(Math.max(...items.slice(1).map((it) => area(it.id))));
    // stepped down: no secondary has a bigger headline or a wider column than the lead (the lead may stand alone at full width)
    expect(Math.max(...spans.slice(1)), `${name} p${p.doc.page.no}: secondaries step down`).toBeLessThanOrEqual(spans[0]!);
    expect(p.fit.fill_pct, `${name} p${p.doc.page.no} fill`).toBeGreaterThanOrEqual(85);
    expect(p.fit.fill_pct, `${name} p${p.doc.page.no} fill`).toBeLessThanOrEqual(100);
    expect(p.fit.body_px, `${name} p${p.doc.page.no} type size`).toBeGreaterThanOrEqual(minPxOf(p.template));
    summary.push(`p${p.doc.page.no} ${p.fit.fill_pct}% ${p.fit.body_px}px holes ${p.fit.hole_pct}% spans ${spans.join("/")}`);
  });
  console.log(name + ": " + summary.join(" | "));
}

describe("uneven layout: one dominant lead per page, stepped-down secondaries", () => {
  it("English broadsheet, 15 stories on 4 pages", async () => {
    const arts = englishArticles();
    const r = await autoPlan(eng, arts, tplSet("broadsheet-en"), { pages: 4 });
    await expectUneven("broadsheet-en", r, arts, (t) => t.body.min_px);
    expect(r.unplaced).toEqual([]);
  }, 120000);
  it("tabloid, 15 stories on 5 pages", async () => {
    const arts = englishArticles();
    const r = await autoPlan(eng, arts, tplSet("tabloid-en"), { pages: 5 });
    await expectUneven("tabloid-en", r, arts, (t) => t.body.min_px);
  }, 120000);
  it("Punjabi (Gurmukhi) with the paper's own placement hints removed: 8.5 pt or more", async () => {
    const arts = (await punjabiArticles(browser)).map((a) => ({ ...a, layout_hint: undefined }));
    const r = await autoPlan(eng, arts, tplSet("broadsheet-pa"), { pages: 3 });
    await expectUneven("broadsheet-pa", r, arts, (t) => Math.max(t.body.min_px, 12));
    expect(r.unplaced).toEqual([]);
  }, 120000);
  it("a page with a human layout hint keeps that layout (the paper's hint wins over the lead rule)", async () => {
    const arts = await punjabiArticles(browser);
    const r = await autoPlan(eng, arts, tplSet("broadsheet-pa"), { pages: 3 });
    expect(r.pages[0]!.doc.items.map((i) => i.slot)).toEqual(expect.arrayContaining(["story_col_span-3-1", "story_col_span-4-2"]));
  }, 120000);
});

describe("the width planner", () => {
  const t = tplSet("broadsheet-en")[0]!;
  const a = (id: string, words: number, img = false) => art(id, { priority: 50, headline: "Headline " + id, body: [{ t: "p", text: Array.from({ length: words }, () => "word").join(" ") }], images: img ? [{ asset_id: "ast_" + id, role: "lead", src: "https://example.com/x.jpg" }] : [] });
  it("is deterministic, gives the lead the most columns and fills every row to 8 columns", () => {
    const list = [a("a", 300, true), a("b", 120), a("c", 150), a("d", 80), a("e", 90)];
    const p1 = planTiers(list, t), p2 = planTiers(list, t);
    expect(p1).toEqual(p2);
    expect(p1[0]!.tier).toBe(1);
    expect(p1[0]!.span).toBe(Math.max(...p1.map((x) => x.span)));
    const rows = new Map<number, number>();
    for (const x of p1) rows.set(x.row, (rows.get(x.row) ?? 0) + x.span);
    for (const w of rows.values()) expect(w).toBe(t.columns);
    expect(p1[0]!.hs).toBeGreaterThan(Math.max(...p1.slice(1).map((x) => x.hs)));
  });
  it("a 2-wide story is one text column; compact mode shrinks headlines and flattens photos", () => {
    expect(tierCols(2, t)).toBe(1);
    const list = [a("a", 300, true), a("b", 120, true)];
    const [n, c] = [planTiers(list, t, 0)[0]!, planTiers(list, t, 2)[0]!];
    expect(c.hs).toBeLessThan(n.hs);
    expect(c.ratio).toBeGreaterThan(n.ratio);
  });
  it("one story alone gets the whole width", () => {
    expect(planTiers([a("a", 100)], t)).toMatchObject([{ span: 8, tier: 1 }]);
  });
});
