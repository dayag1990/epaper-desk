import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { LayoutSnapshotSchema, PageDocSchema, type Article } from "@epaper/core";
import { LayoutEngine, autoPlan, fitBodySize, lowResCheck, renderPage, requiredPixels, effectiveDpi } from "../src/index.js";
import { englishArticles, punjabiArticles, tpl, tplSet } from "./helpers.js";

let engine: LayoutEngine, browser: Browser;
beforeAll(async () => { engine = await LayoutEngine.launch(); browser = await chromium.launch(); }, 60000);
afterAll(async () => { await engine.close(); await browser.close(); });

describe("fit loop", () => {
  it("converges: size never leaves [min,start], steps down only while overflowing", () => {
    const calls: number[] = [];
    const r = fitBodySize((px) => { calls.push(px); return px * 0.09; }, { start: 13, min: 9.5, step: 0.25 });
    expect(r.px).toBeLessThanOrEqual(11.1);
    expect(r.px).toBeGreaterThanOrEqual(9.5);
    expect(r.overflow).toBe(false);
    expect(calls.length).toBeLessThanOrEqual(16);
    const never = fitBodySize(() => 2, { start: 13, min: 9.5, step: 0.25 });
    expect(never.px).toBe(9.5);
    expect(never.overflow).toBe(true);
  });
  it("converges on a real page and reports overflow honestly when copy is too long", async () => {
    const arts = englishArticles();
    const t = tpl("broadsheet-en", "inner_a");
    const plan = await autoPlan(engine, arts.slice(0, 3), [t], { pages: 1, bySection: false });
    expect(plan.pages[0]!.fit.steps).toBeLessThan(20);
    const lots = await autoPlan(engine, arts, [t], { pages: 1, bySection: false });
    expect(lots.pages[0]!.fit.overflow).toBe(true);
    expect(lots.pages[0]!.fit.overflow_pct).toBeGreaterThan(0);
    expect(lots.pages[0]!.fit.body_px).toBe(t.body.min_px);
  }, 60000);
});

describe("auto-plan", () => {
  it("15 English articles -> 4 pages in under 60 s, nothing dropped, same plan on every run", async () => {
    const arts = englishArticles();
    const set = tplSet("broadsheet-en");
    const t0 = Date.now();
    const a = await autoPlan(engine, arts, set, { pages: 4, date: "MONDAY, 23 NOVEMBER 2026" });
    const ms = Date.now() - t0;
    console.log("autoplan 4 pages ms", ms, a.pages.map((p) => `${p.doc.page.template}:${p.articles.length} ${p.fit.fill_pct}% ${p.fit.state} ${p.doc.page.body_pt}pt`).join(" | "));
    expect(a.pages.length).toBe(4);
    expect(ms).toBeLessThan(60000);
    expect(a.unplaced).toEqual([]);
    expect(a.pages.flatMap((p) => p.articles).sort()).toEqual(arts.map((x) => x.id).sort());
    for (const p of a.pages) { PageDocSchema.parse(p.doc); expect(p.articles.length).toBeGreaterThan(0); }
    const b = await autoPlan(engine, arts, set, { pages: 4, date: "MONDAY, 23 NOVEMBER 2026" });
    expect(JSON.stringify(b.pages.map((p) => p.doc))).toBe(JSON.stringify(a.pages.map((p) => p.doc)));
    // input order must not matter
    const c = await autoPlan(engine, [...arts].reverse(), set, { pages: 4, date: "MONDAY, 23 NOVEMBER 2026" });
    expect(JSON.stringify(c.pages.map((p) => p.doc))).toBe(JSON.stringify(a.pages.map((p) => p.doc)));
  }, 120000);

  it("tabloid set plans too", async () => {
    const a = await autoPlan(engine, englishArticles(), tplSet("tabloid-en"), { pages: 4 });
    expect(a.pages.length).toBe(4);
    expect(a.pages[0]!.doc.page.w_mm).toBe(280);
  }, 120000);
});

describe("snapshot (D4)", () => {
  it("validates against the zod schema, in mm, with sane geometry", async () => {
    const arts = englishArticles();
    const a = await autoPlan(engine, arts, tplSet("broadsheet-en"), { pages: 4 });
    const snap = await engine.snapshot("ed_TEST1", a.pages.map((p) => ({ doc: p.doc, template: p.template })), arts);
    expect(LayoutSnapshotSchema.safeParse(snap).success).toBe(true);
    expect(snap.pages.length).toBe(4);
    const p1 = snap.pages[0]!;
    expect(p1.w).toBe(381);
    expect(p1.h).toBe(578);
    const roles = new Set(p1.frames.map((f) => f.role));
    for (const r of ["masthead", "strip", "head", "body"]) expect(roles.has(r as never)).toBe(true);
    for (const f of p1.frames) { expect(f.x).toBeGreaterThanOrEqual(0); expect(f.x + f.w).toBeLessThanOrEqual(381.5); }
    const body = p1.frames.find((f) => f.role === "body")!;
    expect(body.size_pt).toBeGreaterThan(5);
    expect(body.size_pt).toBeLessThan(14);
    expect(body.cols).toBeGreaterThan(0);
    expect(body.paras!.length).toBeGreaterThan(0);
  }, 120000);
});

describe("low-res warning (M2 rule)", () => {
  it("fires below 150 dpi at frame width (pure)", () => {
    expect(requiredPixels(25.4)).toBe(150);
    expect(lowResCheck(149, 25.4).low).toBe(true);
    expect(lowResCheck(150, 25.4).low).toBe(false);
    expect(lowResCheck(0, 100).low).toBe(false);
    expect(effectiveDpi(300, 50.8)).toBeCloseTo(150, 5);
  });
  it("fires in the rendered page for a small image and not for a big one", async () => {
    const svg = (w: number) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${Math.round(w * 0.6)}'><rect width='100%' height='100%' fill='gray'/></svg>`)}`;
    const base = englishArticles()[0]!;
    const mk = (w: number): Article => ({ ...base, images: [{ asset_id: "ast_LOW1" as never, role: "lead", src: svg(w) }] });
    const t = tpl("broadsheet-en", "inner_a");
    const doc = PageDocSchema.parse({
      page: { no: 2, size: "broadsheet", w_mm: 381, h_mm: 578, template: "inner_a", body_pt: 8.8 },
      items: [{ id: "it_a1", kind: "story", slot: "story_col_span-8-1", span: 8, cols: 4, text: { head: "H", body: ["x"] }, image: { asset_id: "ast_LOW1", ratio: 2.3, cutout: false, focal: [0.5, 0.5] } }],
      status: "draft", rev: 1,
    });
    const low = await engine.measure(doc, t, [mk(100)]);
    expect(low.low_res.length).toBe(1);
    expect(low.low_res[0]!.need_px).toBeGreaterThan(1000);
    const ok = await engine.measure(doc, t, [mk(4000)]);
    expect(ok.low_res.length).toBe(0);
  }, 60000);
});

describe("editor vs headless", () => {
  it("same PageDoc, two separate browser contexts: pixel difference under 0.5 %", async () => {
    const arts = englishArticles();
    const a = await autoPlan(engine, arts, tplSet("broadsheet-en"), { pages: 4 });
    const p = a.pages[1]!;
    const shotA = await engine.screenshot(p.doc, p.template, arts);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pg = await ctx.newPage();
    const r = renderPage(p.doc, p.template, arts);
    await pg.setContent(`<!doctype html><meta charset=utf-8><style>${r.css}</style>${r.html}`);
    const shotB = (await pg.locator(".page").screenshot()) as Buffer;
    const diff = await pg.evaluate(async ([x, y]) => {
      const load = (b64: string) => new Promise<ImageData>((res) => { const i = new Image(); i.onload = () => { const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const g = c.getContext("2d")!; g.drawImage(i, 0, 0); res(g.getImageData(0, 0, i.width, i.height)); }; i.src = "data:image/png;base64," + b64; });
      const A = await load(x!), B = await load(y!);
      if (A.width !== B.width || A.height !== B.height) return 1;
      let n = 0;
      for (let k = 0; k < A.data.length; k += 4) if (Math.abs(A.data[k]! - B.data[k]!) + Math.abs(A.data[k + 1]! - B.data[k + 1]!) + Math.abs(A.data[k + 2]! - B.data[k + 2]!) > 24) n++;
      return n / (A.width * A.height);
    }, [shotA.toString("base64"), shotB.toString("base64")] as const);
    await ctx.close();
    expect(diff).toBeLessThan(0.005);
  }, 60000);
});

describe("Punjabi sample", () => {
  it("plans to 2 pages (one per section) and reports fit per page honestly", async () => {
    const arts = await punjabiArticles(browser);
    const plan = await autoPlan(engine, arts, [tpl("prototype-pa", "front_a"), tpl("prototype-pa", "inner_a")]);
    console.log("punjabi sample", plan.pages.map((p) => `p${p.doc.page.no} ${p.fit.fill_pct}% ${p.fit.state} ${p.fit.body_px}px`).join(" | "));
    expect(plan.pages.length).toBe(2);
    expect(plan.unplaced).toEqual([]);
  }, 60000);
});
