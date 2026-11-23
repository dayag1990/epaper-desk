import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { LayoutEngine, renderPage, renderDocument, packSpans, defaultRatio } from "../src/index.js";
import { protoToDocs, ROOT, tpl } from "./helpers.js";

let browser: Browser, engine: LayoutEngine;
beforeAll(async () => { browser = await chromium.launch(); engine = await LayoutEngine.launch(); }, 60000);
afterAll(async () => { await browser.close(); await engine.close(); });

describe("row packer", () => {
  it("stretches the last story of a row so no hole is left", () => {
    expect(packSpans([3, 2, 3])).toEqual([3, 2, 3]);
    expect(packSpans([3, 2, 4])).toEqual([3, 5, 4].slice(0, 1).concat([5, 8]));
    expect(packSpans([3, 3])).toEqual([3, 5]);
    expect(packSpans([5, 2, 2, 8])).toEqual([5, 3, 8, 8]);
    expect(packSpans(packSpans([3, 2, 4, 2]))).toEqual(packSpans([3, 2, 4, 2]));
  });
  it("image ratio defaults follow the packed span like the prototype", () => {
    expect([defaultRatio("story", 2), defaultRatio("story", 4), defaultRatio("story", 6), defaultRatio("ad", 8)]).toEqual([1.78, 2.3, 3.2, 9]);
  });
});

describe("prototype SAMPLE re-renders with the same structure and fit", () => {
  it("matches the prototype page by page", async () => {
    const pg = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    await pg.route(/^https?:/, (r) => r.abort());
    await pg.goto("file://" + join(ROOT, "epaper-desk-prototype.html"));
    await pg.waitForTimeout(300);
    const proto = await pg.evaluate(() => {
      const model = (window as any).__api.parseCXML((globalThis as any).eval("SAMPLE"));
      (globalThis as any).eval("mode(false); fit(); zoom=1; applyGlobals(); autoFit()");
      const pages = [...document.querySelectorAll<HTMLElement>(".page")].map((p) => ({
        fs: +p.dataset.fs!,
        fill: (globalThis as any).eval("fillOf")(p),
        mast: !!p.querySelector(".mast"),
        stories: [...p.querySelectorAll<HTMLElement>(".story")].map((s) => ({
          kind: s.dataset.kind, span: +s.dataset.span!, cols: +s.dataset.cols!, hs: +s.dataset.hs!, ar: +s.dataset.ar!,
          head: s.querySelector(".head")?.textContent ?? "", paras: s.querySelectorAll(".body p").length,
        })),
      }));
      return { model, pages };
    });
    await pg.close();
    expect(proto.pages.length).toBe(2);
    const docs = protoToDocs(proto.model, (i) => (i === 0 ? "front_a" : "inner_a"));
    const t = (n: number) => tpl("prototype-pa", n === 1 ? "front_a" : "inner_a");

    for (const [i, d] of docs.entries()) {
      const r = renderPage(d, t(d.page.no));
      const mine = r.spans.map((span, n) => ({ kind: d.items[n]!.kind, span, head: d.items[n]!.text?.head ?? "" }));
      const theirs = proto.pages[i]!.stories.map((s) => ({ kind: s.kind, span: s.span, head: s.head }));
      expect(mine).toEqual(theirs);
      expect(r.html.includes('class="mast"')).toBe(proto.pages[i]!.mast);
      // cols / ar / hs in the rendered HTML
      const m = [...r.html.matchAll(/data-cols="(\d+)" data-hs="([\d.]+)" data-ar="([\d.]+)"/g)];
      expect(m.map((x) => [+x[1]!, +x[2]!])).toEqual(proto.pages[i]!.stories.map((s) => [s.cols, s.hs]));
      // finish like autoplan does: ratios derive from packed span
      const withRatio = { ...d, items: d.items.map((it, n) => (it.image ? { ...it, image: { ...it.image, ratio: defaultRatio(it.kind, r.spans[n]!) } } : it)) };
      const ars = [...renderPage(withRatio, t(d.page.no)).html.matchAll(/data-ar="([\d.]+)"/g)].map((x) => +x[1]!);
      expect(ars.filter((_, n) => d.items[n]!.image || d.items[n]!.kind === "ad")).toEqual(proto.pages[i]!.stories.map((s) => s.ar).filter((_, n) => d.items[n]!.image || d.items[n]!.kind === "ad"));
      const fitted = await engine.fit(withRatio, t(d.page.no));
      console.log("page", d.page.no, "proto fs/fill", proto.pages[i]!.fs, proto.pages[i]!.fill.toFixed(3), "mine", fitted.body_px, fitted.fill.toFixed(3), fitted.state);
      const fillMine = fitted.fill;
      expect(Math.abs(fitted.body_px - proto.pages[i]!.fs)).toBeLessThanOrEqual(0.25);
      expect(Math.abs(fillMine - proto.pages[i]!.fill)).toBeLessThan(0.02);
    }
    expect(renderDocument([renderPage(docs[0]!, t(1))]).startsWith("<!doctype html>")).toBe(true);
  }, 60000);
});
