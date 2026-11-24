import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Article } from "@epaper/core";
import { LayoutEngine, autoPlan, captionHtml, mastNameSize, renderPage, splitCaption } from "../src/index.js";
import { englishArticles, tpl } from "./helpers.js";

describe("splitCaption: the credit is the small run of the caption line", () => {
  it("splits a Tamil caption at the படம்: label", () => {
    expect(splitCaption("கோப்புப் படம் · படம்: Beckamrajeev, CC BY-SA 3.0, Wikimedia Commons")).toEqual({
      text: "கோப்புப் படம்",
      credit: "படம்: Beckamrajeev, CC BY-SA 3.0, Wikimedia Commons",
    });
  });
  it("splits an English caption at Photo:, with or without a separator", () => {
    expect(splitCaption("Old Mill Bridge · Photo: Jane Doe, CC BY 4.0, Wikimedia Commons")).toEqual({ text: "Old Mill Bridge", credit: "Photo: Jane Doe, CC BY 4.0, Wikimedia Commons" });
    expect(splitCaption("Old Mill Bridge. Photo: Jane Doe, CC BY 4.0")).toEqual({ text: "Old Mill Bridge.", credit: "Photo: Jane Doe, CC BY 4.0" });
  });
  it("a caption with no credit label stays whole, and a word like 'photo' is not a label", () => {
    expect(splitCaption("கோப்புப் படம்")).toEqual({ text: "கோப்புப் படம்", credit: "" });
    expect(splitCaption("File photo of the bridge")).toEqual({ text: "File photo of the bridge", credit: "" });
    expect(splitCaption("")).toEqual({ text: "", credit: "" });
    expect(splitCaption(null, null)).toEqual({ text: "", credit: "" });
  });
  it("a credit that is only a credit has no caption text", () => {
    expect(splitCaption("Photo: Jane Doe, CC BY 4.0")).toEqual({ text: "", credit: "Photo: Jane Doe, CC BY 4.0" });
  });
  it("a separate credit is used as it is, and printed once when the caption repeats it", () => {
    expect(splitCaption("Rovers celebrate", "Photo: A. Smith")).toEqual({ text: "Rovers celebrate", credit: "Photo: A. Smith" });
    expect(splitCaption("Rovers celebrate · Photo: A. Smith", "Photo: A. Smith")).toEqual({ text: "Rovers celebrate", credit: "Photo: A. Smith" });
  });
});

const withCaption = (a: Article, caption: string | null, credit: string | null = null): Article => ({ ...a, images: a.images.map((i) => ({ ...i, caption, credit })) });

describe("caption line in the page", () => {
  let engine: LayoutEngine;
  beforeAll(async () => { engine = await LayoutEngine.launch(); }, 60000);
  afterAll(async () => { await engine.close(); });

  const t = tpl("broadsheet-en", "inner_a");
  const lead = englishArticles().find((a) => a.images.length)!;
  const SRC = "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#888"/></svg>').toString("base64");
  const art = (c: string | null, cr: string | null = null) => { const a = withCaption(lead, c, cr); return { ...a, images: a.images.map((i) => ({ ...i, src: SRC })) }; };

  it("prints the caption and the credit in one .cap element, the credit in its own smaller span, under the photo", async () => {
    const a = art("Old Mill Bridge · Photo: Jane Doe, CC BY 4.0, Wikimedia Commons");
    const plan = await autoPlan(engine, [a], [t], { pages: 1, bySection: false });
    const doc = plan.pages[0]!.doc;
    const html = renderPage(doc, t, [a]).html;
    expect(html).toContain('<div class="cap"');
    expect(html).toContain('<span class="credit">· Photo: Jane Doe, CC BY 4.0, Wikimedia Commons</span>');
    expect(html.indexOf('class="fig has-cap"')).toBeLessThan(html.indexOf('class="cap"'));
    expect(html.indexOf('class="cap"')).toBeLessThan(html.indexOf('class="body"'));
    expect(html.match(/class="cap"/g)).toHaveLength(1);
  });

  it("is in the snapshot as a caption frame inside its story, with the credit text, and the credit is smaller than the caption", async () => {
    const a = art("Old Mill Bridge · Photo: Jane Doe, CC BY 4.0, Wikimedia Commons");
    const plan = await autoPlan(engine, [a], [t], { pages: 1, bySection: false });
    const snap = await engine.snapshot("ed_x" as never, [{ doc: plan.pages[0]!.doc, template: t }], [a]);
    const caps = snap.pages[0]!.frames.filter((f) => f.role === "caption");
    expect(caps).toHaveLength(1);
    expect(caps[0]!.text).toContain("Photo: Jane Doe, CC BY 4.0, Wikimedia Commons");
    expect(caps[0]!.text).toContain("Old Mill Bridge");
    const img = snap.pages[0]!.frames.find((f) => f.role === "image")!;
    expect(caps[0]!.y).toBeGreaterThanOrEqual(img.y + img.h - 0.01); // under the photo
    expect(caps[0]!.item).toBe(img.item);
    const sizes = await engine.captionSizes();
    expect(sizes.credit).toBeGreaterThan(0);
    expect(sizes.credit).toBeLessThan(sizes.caption);
  }, 60000);

  it("prints nothing for a photo with no caption, and no empty .cap element", () => {
    const a = art(null);
    const doc = { page: { no: 1, size: "broadsheet", w_mm: 381, h_mm: 578, template: t.id, body_pt: 9 }, items: [{ id: "it_1", kind: "story" as const, article_id: a.id, span: 4, cols: 2, text: { head: "H", body: ["b"] }, image: { asset_id: a.images[0]!.asset_id, ratio: 2.3, cutout: false, focal: [0.5, 0.4] as [number, number] } }], status: "draft", rev: 1 };
    expect(renderPage(doc as never, t, [a]).html).not.toContain('class="cap"');
    expect(captionHtml(doc.items[0] as never, [a])).toBe("");
  });

  it("escapes the caption and never adds one to an advert", () => {
    const a = art('A <b>"bold"</b> claim');
    const item = { id: "it_1", kind: "story" as const, article_id: a.id, image: { asset_id: a.images[0]!.asset_id, ratio: 2, cutout: false, focal: [0.5, 0.5] as [number, number] } };
    expect(captionHtml(item as never, [a])).toContain("A &lt;b&gt;&quot;bold&quot;&lt;/b&gt; claim");
    expect(captionHtml({ ...item, kind: "ad" } as never, [a])).toBe("");
  });

  it("a page with captions fits as before: no overflow, every photo has its caption line, body text stays above the template minimum", async () => {
    const CAP = "Old Mill Bridge · Photo: Jane Doe, CC BY 4.0, Wikimedia Commons";
    const arts = englishArticles().slice(0, 3).map((a) => ({ ...a, images: a.images.map((i) => ({ ...i, src: SRC, caption: CAP })) }));
    const plan = await autoPlan(engine, arts, [t], { pages: 1, bySection: false });
    const p = plan.pages[0]!;
    expect(p.fit.overflow).toBe(false);
    expect(p.fit.fill).toBeLessThanOrEqual(1);
    expect(p.fit.body_px).toBeGreaterThanOrEqual(t.body.min_px);
    const html = renderPage(p.doc, t, arts).html;
    expect(html.match(/class="cap"/g)?.length ?? 0).toBe(p.doc.items.filter((i) => i.image).length);
  }, 60000);
});

describe("masthead: the paper's own name wins over the template's", () => {
  let engine: LayoutEngine;
  beforeAll(async () => { engine = await LayoutEngine.launch(); }, 60000);
  afterAll(async () => { await engine.close(); });
  const t = tpl("broadsheet-en", "front_a");
  const arts = englishArticles().slice(0, 3);

  it("autoPlan prints the masthead it is given on page 1 and keeps the template's name as the fallback", async () => {
    expect(t.furniture.masthead).toBe("The Demo Gazette");
    const own = await autoPlan(engine, arts, [t], { pages: 1, bySection: false, masthead: "The Riverton Herald" });
    expect(own.pages[0]!.doc.furniture!.masthead).toBe("The Riverton Herald");
    expect(renderPage(own.pages[0]!.doc, t, arts).html).toContain("The Riverton Herald");
    expect(renderPage(own.pages[0]!.doc, t, arts).html).not.toContain("The Demo Gazette");
    const none = await autoPlan(engine, arts, [t], { pages: 1, bySection: false });
    expect(none.pages[0]!.doc.furniture!.masthead).toBe("The Demo Gazette");
    const blank = await autoPlan(engine, arts, [t], { pages: 1, bySection: false, masthead: "   " });
    expect(blank.pages[0]!.doc.furniture!.masthead).toBe("The Demo Gazette");
  }, 60000);

  it("a long paper name stays on one line in the red band (it shrinks instead of wrapping), a short one keeps the template size", async () => {
    const own = await autoPlan(engine, arts, [t], { pages: 1, bySection: false, masthead: "The Riverton Herald" });
    await engine.load(own.pages[0]!.doc, t, arts);
    const m = await engine.mastheadBox();
    expect(m.lines).toBe(1);
    expect(m.fontPx).toBeLessThanOrEqual(t.masthead_px.name);
    const long = await autoPlan(engine, arts, [t], { pages: 1, bySection: false, masthead: "The Very Long Named Riverton Valley Herald And Gazette" });
    await engine.load(long.pages[0]!.doc, t, arts);
    expect((await engine.mastheadBox()).lines).toBe(1);
    expect(mastNameSize("தென்பொதிகை", t)).toBe(t.masthead_px.name);
    expect(mastNameSize("The Demo Gazette", t)).toBe(t.masthead_px.name);
    expect(mastNameSize("The Riverton Herald", t)).toBeLessThan(t.masthead_px.name);
  }, 60000);
});
