import { mkdtemp, readdir, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArticleSchema, LayoutSnapshotSchema, ZoneSchema, ZoneSetSchema } from "@epaper/core";
import { buildEdition, zoneFromSnapshot, similarity, type EditionResult } from "../src/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const pdf = join(root, "fixtures/edition-24p.pdf");
const articles = ArticleSchema.array().parse(JSON.parse(await readFile(join(root, "fixtures/english-15.json"), "utf8")).articles);

// Truth: scripts/make-standin-edition.ts places articles by a fixed formula (page n, template, start index).
const BOXES = [4, 3, 5, 4];
function expectedStories(n: number) {
  const start = (n - 1) * 4 + (n > 15 ? 1 : 0);
  const count = BOXES[(n * 7 + (n >> 1)) % BOXES.length];
  return Array.from({ length: count }, (_, k) => articles[(start + k) % articles.length]);
}

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(p)));
    else out.push(p);
  }
  return out.sort();
}

let out: string, first: EditionResult, ms = 0;
beforeAll(async () => {
  out = await mkdtemp(join(tmpdir(), "ep-"));
  const t = Date.now();
  first = await buildEdition(pdf, { outDir: out, articles });
  ms = Date.now() - t;
});
afterAll(() => rm(out, { recursive: true, force: true }));

describe("24-page edition", () => {
  it("builds all pages under 2 minutes", () => {
    console.log(`24-page build: ${ms} ms`);
    expect(first.pageCount).toBe(24);
    expect(ms).toBeLessThan(120_000);
  });

  it("writes images at 400/1600/3200, page pdf, text, zones", async () => {
    const dir = first.pages[2].dir;
    for (const f of ["w400.webp", "w1600.webp", "w3200.webp", "page.pdf", "text.json", "zones.json", "page.json"]) {
      expect((await stat(join(dir, f))).size).toBeGreaterThan(0);
    }
    expect(first.pages[2].zones.image.w).toBe(3200);
  });

  it("zones at least 85% of stories, matched to the right article", () => {
    let total = 0, ok = 0;
    const wrong: string[] = [];
    for (let n = 1; n <= 24; n++) {
      const zones = first.pages[n - 1].zones.zones;
      for (const a of expectedStories(n)) {
        total++;
        const z = zones.find((x) => x.article_id === a.id);
        if (z) ok++; else wrong.push(`p${n}:${a.headline}`);
      }
      // nothing zoned that is not on the page
      const want = new Set(expectedStories(n).map((a) => a.id));
      for (const z of zones) expect(want.has(z.article_id as never)).toBe(true);
    }
    const pct = (100 * ok) / total;
    console.log(`zoned+matched ${ok}/${total} = ${pct.toFixed(1)}%`, wrong);
    expect(pct).toBeGreaterThanOrEqual(85);
  });

  it("every zone validates against D5 with geometry in 0-1, and zones do not overlap each other", () => {
    for (const p of first.pages) {
      ZoneSetSchema.parse(JSON.parse(JSON.stringify(p.zones)));
      for (const z of p.zones.zones) {
        ZoneSchema.parse(z);
        for (const [x, y, w, h] of z.rects) {
          for (const v of [x, y, w, h]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
          expect(x + w).toBeLessThanOrEqual(1 + 1e-9);
          expect(y + h).toBeLessThanOrEqual(1 + 1e-9);
          expect(w * h).toBeGreaterThan(0.01);
        }
      }
      const rs = p.zones.zones.map((z) => z.rects[0]);
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i], b = rs[j];
        const ox = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
        const oy = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
        expect(ox > 0.005 && oy > 0.005, `page ${p.page} zones ${i}/${j} overlap`).toBe(false);
      }
    }
  });

  it("re-running writes no new files and changes none", async () => {
    const before = await listFiles(out);
    const statsBefore = await Promise.all(before.map(async (f) => (await stat(f)).mtimeMs));
    const t = Date.now();
    const again = await buildEdition(pdf, { outDir: out, articles });
    console.log(`re-run: ${Date.now() - t} ms`);
    expect(again.written).toEqual([]);
    expect(again.sha256).toBe(first.sha256);
    const after = await listFiles(out);
    expect(after).toEqual(before);
    expect(await Promise.all(after.map(async (f) => (await stat(f)).mtimeMs))).toEqual(statsBefore);
  });
});

describe("snapshot path", () => {
  const snapshot = LayoutSnapshotSchema.parse({
    edition_id: "ed_test", unit: "mm", origin: "page top-left",
    pages: [{
      no: 1, w: 330, h: 530, fill_pct: 90,
      frames: [
        { id: "it_1.head", item: "it_1", role: "head", x: 33, y: 53, w: 99, h: 26.5, text: articles[0].headline },
        { id: "it_1.img", item: "it_1", role: "image", x: 33, y: 79.5, w: 99, h: 106 },
        { id: "it_1.body", item: "it_1", role: "body", x: 33, y: 185.5, w: 99, h: 159, cols: 2 },
        { id: "it_2.head", item: "it_2", role: "head", x: 165, y: 265, w: 66, h: 53, text: "Totally unknown words here" },
        { id: "it_2.body", item: "it_2", role: "body", x: 165, y: 318, w: 66, h: 106 },
        { id: "it_3.ad", item: "it_3", role: "ad", x: 231, y: 424, w: 99, h: 106 },
        { id: "m.mast", item: "it_9", role: "masthead", x: 0, y: 0, w: 330, h: 40 },
      ],
    }],
  });

  it("maps mm frames to fractions exactly", () => {
    const zones = zoneFromSnapshot(snapshot.pages[0], articles);
    expect(zones).toHaveLength(3);
    const [a, b, ad] = zones;
    expect(a.source).toBe("snapshot");
    expect(a.article_id).toBe(articles[0].id);
    expect(a.url).toBe(articles[0].url);
    expect(a.rects[0]).toEqual([33 / 330, 53 / 530, 99 / 330, (344.5 - 53) / 530].map((v) => Math.round(v * 1e6) / 1e6));
    expect(b.article_id).toBeNull();
    expect(b.confidence).toBeLessThan(1);
    expect(ad.article_id).toBeNull();
    expect(ad.rects[0]).toEqual([0.7, 0.8, 0.3, 0.2]);
    for (const z of zones) ZoneSchema.parse(z);
  });

  it("buildEdition uses the snapshot for pages it has and text for the rest", async () => {
    const o = await mkdtemp(join(tmpdir(), "ep-snap-"));
    try {
      const r = await buildEdition(pdf, { outDir: o, articles, snapshot, widths: [200], concurrency: 4 });
      expect(r.pages[0].zonedBy).toBe("snapshot");
      expect(r.pages[1].zonedBy).toBe("text");
      expect(r.pages[0].zones.zones[0].rects[0][0]).toBeCloseTo(0.1, 5);
    } finally { await rm(o, { recursive: true, force: true }); }
  });
});

describe("matching", () => {
  it("scores near headlines high and unrelated low", () => {
    expect(similarity("Council votes to repair Old Mill Bridge", "Council votes to repair Old Mill Bridge rather than replace it")).toBeGreaterThan(0.6);
    expect(similarity("Weather today", "Council votes to repair Old Mill Bridge")).toBeLessThan(0.4);
  });
});
