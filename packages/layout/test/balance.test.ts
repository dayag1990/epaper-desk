import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import type { Article } from "@epaper/core";
import { LayoutEngine, autoPlan, partitionQueue, type PlanResult } from "../src/index.js";
import { englishArticles, punjabiArticles, tpl, tplSet } from "./helpers.js";

let engine: LayoutEngine, browser: Browser;
beforeAll(async () => { engine = await LayoutEngine.launch(); browser = await chromium.launch(); }, 60000);
afterAll(async () => { await engine.close(); await browser.close(); });

const line = (name: string, r: PlanResult) =>
  `${name}: ${r.pages.map((p) => `p${p.doc.page.no} ${p.articles.length}st ${p.fit.fill_pct}% ${p.fit.state} ${p.fit.body_px}px`).join(" | ")} | ${r.elapsed_ms} ms, ${r.evaluations} evals, unplaced ${r.unplaced.length}`;
const ids = (r: PlanResult) => r.pages.flatMap((p) => p.articles).concat(r.unplaced).sort();
/** Deterministic shuffle (seeded LCG), so the test itself is repeatable. */
function shuffled<T>(xs: readonly T[], seed: number): T[] {
  const a = [...xs];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
}
function expectBand(name: string, r: PlanResult) {
  console.log(line(name, r));
  for (const p of r.pages) {
    expect(p.fit.overflow, `${name} page ${p.doc.page.no} overflows`).toBe(false);
    expect(p.fit.fill_pct, `${name} page ${p.doc.page.no} fill`).toBeGreaterThanOrEqual(85);
    expect(p.fit.fill_pct, `${name} page ${p.doc.page.no} fill`).toBeLessThanOrEqual(100);
  }
}

describe("balanced auto-plan: every page between 85 and 100 %", () => {
  const set = () => tplSet("broadsheet-en");
  for (const n of [3, 4, 5]) {
    it(`15 English articles -> ${n} pages`, async () => {
      const arts = englishArticles();
      const r = await autoPlan(engine, arts, set(), { pages: n });
      expect(r.pages.length).toBe(n);
      expectBand(`15->${n}`, r);
      expect(ids(r)).toEqual(arts.map((a) => a.id).sort());
      expect(r.unplaced).toEqual([]);
    }, 60000);
  }
  it("first 9 articles -> 2 pages", async () => {
    const arts = englishArticles().slice(0, 9);
    const r = await autoPlan(engine, arts, set(), { pages: 2 });
    expectBand("9->2", r);
    expect(ids(r)).toEqual(arts.map((a) => a.id).sort());
  }, 60000);
  it("Punjabi sample -> 2 pages (a section per page, as the spec says)", async () => {
    const arts = await punjabiArticles(browser);
    const r = await autoPlan(engine, arts, [tpl("prototype-pa", "front_a"), tpl("prototype-pa", "inner_a")]);
    expect(r.pages.length).toBe(2);
    expectBand("punjabi", r);
    expect(ids(r)).toEqual(arts.map((a) => a.id).sort());
  }, 60000);
  it("Punjabi sample on the broadsheet-pa set: body text never below 12 px (8.5 pt), every page 85-100 %, nothing lost", async () => {
    const arts = await punjabiArticles(browser);
    const r = await autoPlan(engine, arts, tplSet("broadsheet-pa"), { pages: 3 });
    expect(r.pages.length).toBe(3);
    expectBand("punjabi-pa", r);
    for (const p of r.pages) expect(p.fit.body_px).toBeGreaterThanOrEqual(12);
    expect(ids(r)).toEqual(arts.map((a) => a.id).sort());
  }, 60000);
});

describe("placement rules", () => {
  it("lead stories on page 1, opinion on the last page, sport and business each kept together", async () => {
    const arts = englishArticles();
    const r = await autoPlan(engine, arts, tplSet("broadsheet-en"), { pages: 4 });
    const page = new Map<string, number>();
    r.pages.forEach((p, i) => p.articles.forEach((id) => page.set(id, i)));
    const top = [...arts].sort((a, b) => b.priority - a.priority)[0]!;
    expect(page.get(top.id)).toBe(0);
    for (const a of arts.filter((x) => x.section === "opinion")) expect(page.get(a.id)).toBe(3);
    for (const sec of ["sport", "business"]) expect(new Set(arts.filter((x) => x.section === sec).map((x) => page.get(x.id))).size).toBeLessThanOrEqual(2);
  }, 60000);
  it("a human layout_hint (slot and span) survives re-planning", async () => {
    const arts = englishArticles().map((a, i) => (i === 3 ? { ...a, layout_hint: { slot: "story_col_span-4-1", span: 4 } } : a));
    const r = await autoPlan(engine, arts as Article[], tplSet("broadsheet-en"), { pages: 4 });
    const item = r.pages.flatMap((p) => p.doc.items).find((it) => it.article_id === arts[3]!.id)!;
    expect(item.slot).toBe("story_col_span-4-1");
    expect(ids(r)).toEqual(arts.map((a) => a.id).sort());
  }, 60000);
});

describe("determinism, bounds, nothing lost", () => {
  it("shuffled input gives the identical plan, and 4 pages plan in under 5 s", async () => {
    const arts = englishArticles();
    const set = tplSet("broadsheet-en");
    const a = await autoPlan(engine, arts, set, { pages: 4, date: "MONDAY" });
    console.log(`4-page plan time ${a.elapsed_ms} ms, ${a.evaluations} evaluations`);
    expect(a.elapsed_ms).toBeLessThan(5000);
    const want = JSON.stringify(a.pages.map((p) => p.doc));
    for (const seed of [1, 2, 3]) {
      const b = await autoPlan(engine, shuffled(arts, seed), set, { pages: 4, date: "MONDAY" });
      expect(JSON.stringify(b.pages.map((p) => p.doc))).toBe(want);
    }
  }, 120000);
  it("the search is bounded by repairBudget", async () => {
    const r = await autoPlan(engine, englishArticles(), tplSet("broadsheet-en"), { pages: 5, repairBudget: 3 });
    expect(r.evaluations!).toBeLessThanOrEqual(5 + 3 + 2);
    expect(ids(r)).toEqual(englishArticles().map((a) => a.id).sort());
  }, 60000);
  it("an article too long for any page goes to unplaced with a reason, never lost or doubled", async () => {
    const arts = englishArticles();
    const big = arts.find((a) => a.body.reduce((n, b) => n + b.text.split(/\s+/).length, 0) > 800)!;
    const huge: Article = { ...big, id: "art_01JD99EPAPERRIVERTON000000" as never, priority: 1, headline: "The endless report", body: Array.from({ length: 10 }, () => big.body).flat(), images: [] };
    const all = [...arts, huge];
    const r = await autoPlan(engine, all, tplSet("broadsheet-en"), { pages: 4 });
    console.log(line("15+huge->4", r), JSON.stringify(r.unplaced_reasons));
    expect(r.unplaced).toEqual([huge.id]);
    expect(r.unplaced_reasons![0]!.reason).toMatch(/too long/);
    expect(ids(r)).toEqual(all.map((a) => a.id).sort());
    expect(new Set(r.pages.flatMap((p) => p.articles)).size).toBe(arts.length);
  }, 60000);
  it("partitionQueue cuts evenly and keeps every story once", () => {
    const ends = partitionQueue([10, 10, 10, 10, 10, 10], ["a", "a", "a", "b", "b", "b"], 2, [1, 1]);
    expect(ends).toEqual([3, 6]);
    expect(partitionQueue([5, 5], ["a", "b"], 4, [1, 1, 1, 1]).at(-1)).toBe(2);
  });
});
