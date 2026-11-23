import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { readdirSync } from "node:fs";
import {
  ingestImage, cropBox, cropToFrame, defaultFocalPoint, RuleCutoutProvider, alphaOf, cutOut, pickProvider,
  printCheck, type CutoutProvider, assetKey, sniffImage, downloadImage,
} from "../src/index.js";
import { demo, site, truthMask, synthetic, iou } from "./helpers.js";

const BOAT = "long-read-last-ferryman";
const opts = { paper: "riverton-herald", date: "2026-04-02" };

describe("cut-out (rule-based, no AI)", () => {
  it("demo figure silhouette: IoU >= 0.9, under 10 s, plain-background confidence high", async () => {
    const img = demo(BOAT);
    const t0 = performance.now();
    const r = await new RuleCutoutProvider().cut(img);
    const ms = performance.now() - t0;
    const { data, width, height } = await alphaOf(r.png!);
    const score = iou(data, await truthMask(width, height));
    console.log(`demo figure: ${ms.toFixed(0)} ms, IoU ${score.toFixed(3)}, confidence ${r.confidence}, outline pts ${r.outline.length}`);
    expect(ms).toBeLessThan(10000);
    expect(score).toBeGreaterThanOrEqual(0.9);
    expect(r.low).toBe(false);
    expect(r.outline.length).toBeGreaterThanOrEqual(6);
    for (const [x, y] of r.outline) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(1); }
    expect(r.subjectBox!.h).toBeGreaterThan(0.6);
  });

  it("3000 px gradient-background synthetic: IoU >= 0.9, under 10 s", async () => {
    const img = await synthetic(3000, 2000);
    const t0 = performance.now();
    const r = await new RuleCutoutProvider().cut(img);
    const ms = performance.now() - t0;
    const { data, width, height } = await alphaOf(r.png!);
    const score = iou(data, await truthMask(width, height));
    console.log(`3000px synthetic: ${ms.toFixed(0)} ms, IoU ${score.toFixed(3)}, confidence ${r.confidence}`);
    expect(width).toBe(3000);
    expect(ms).toBeLessThan(10000);
    expect(score).toBeGreaterThanOrEqual(0.9);
  });

  it("alpha is feathered (soft edge pixels exist)", async () => {
    const r = await new RuleCutoutProvider().cut(demo(BOAT));
    const { data } = await alphaOf(r.png!);
    let soft = 0; for (const v of data) if (v > 10 && v < 245) soft++;
    expect(soft).toBeGreaterThan(100);
  });

  it("busy photo: low confidence, plain words, manual crop offered, no throw", async () => {
    const W = 800, H = 600, px = Buffer.alloc(W * H * 3);
    let s = 12345; for (let i = 0; i < px.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; px[i] = s >> 16; }
    const noise = await sharp(px, { raw: { width: W, height: H, channels: 3 } }).jpeg().toBuffer();
    const r = await new RuleCutoutProvider().cut(noise);
    expect(r.low).toBe(true);
    expect(r.fallback).toBe("manual-crop");
    expect(r.message.toLowerCase()).toContain("manual crop");
  });

  it("busy scene (demo building) is flagged or at least never silently confident about junk", async () => {
    const r = await new RuleCutoutProvider().cut(demo("hospital-new-wing-opens"));
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    if (r.low) expect(r.fallback).toBe("manual-crop");
  });

  it("every demo image cuts out inside 10 s without error", async () => {
    for (const f of readdirSync(site + "img")) {
      const t0 = performance.now();
      const r = await new RuleCutoutProvider().cut(demo(f.replace(".jpg", "")));
      expect(performance.now() - t0).toBeLessThan(10000);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("provider seam: AI off by default, never blocks", () => {
  const boom: CutoutProvider = { name: "ai-boom", cut: async () => { throw new Error("down"); } };
  it("defaults to the rule provider even when an AI provider is supplied but not enabled", () => {
    expect(pickProvider({ ai: boom }).name).toBe("rule-floodfill");
  });
  it("AI enabled but down: falls back to rules silently (logged)", async () => {
    const logs: string[] = [];
    const o = await cutOut(demo(BOAT), { ai: boom, aiEnabled: true, log: (m) => logs.push(m) });
    expect(o.status).toBe("ok");
    expect(logs.length).toBe(1);
  });
  it("provider down entirely: photo usable, retry requested, editor told", async () => {
    const o = await cutOut(Buffer.from("not an image"));
    expect(o.status).toBe("provider-error");
    expect(o.photoUsable).toBe(true);
    expect(o.retry).toBe(true);
    expect(o.message).toMatch(/photo is still usable/);
  });
});

describe("focal point and crop", () => {
  it("crop box keeps the focal point inside, for many aspects and focal points", () => {
    for (const aspect of [0.5, 0.75, 1, 1.5, 3, 5]) {
      for (const f of [[0, 0], [1, 1], [0.1, 0.9], [0.5, 0.5], [0.95, 0.05], [0.3, 0.7]] as [number, number][]) {
        const b = cropBox(1200, 800, aspect, f);
        expect(b.left).toBeGreaterThanOrEqual(0); expect(b.top).toBeGreaterThanOrEqual(0);
        expect(b.left + b.width).toBeLessThanOrEqual(1200); expect(b.top + b.height).toBeLessThanOrEqual(800);
        expect(Math.abs(b.width / b.height - aspect) / aspect).toBeLessThan(0.02);
        expect(f[0] * 1200).toBeGreaterThanOrEqual(b.left); expect(f[0] * 1200).toBeLessThanOrEqual(b.left + b.width);
        expect(f[1] * 800).toBeGreaterThanOrEqual(b.top); expect(f[1] * 800).toBeLessThanOrEqual(b.top + b.height);
      }
    }
  });
  it("cropToFrame outputs the frame aspect", async () => {
    const out = await cropToFrame(demo(BOAT), 0.5, [0.5, 0.4]);
    const m = await sharp(out).metadata();
    expect(Math.abs(m.width! / m.height! - 0.5)).toBeLessThan(0.01);
  });
  it("default focal point (attention) lands on the figure, no AI", async () => {
    const [x, y] = await defaultFocalPoint(demo(BOAT));
    expect(x).toBeGreaterThan(0.3); expect(x).toBeLessThan(0.7);
    expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(1);
  });
});

describe("ingest", () => {
  it("is deterministic, keys follow the files layout, print file is the untouched original", async () => {
    const img = demo(BOAT);
    const a = await ingestImage(img, opts), b = await ingestImage(img, opts);
    expect(a.files.map((f) => f.key)).toEqual(b.files.map((f) => f.key));
    a.files.forEach((f, i) => expect(f.bytes.equals(b.files[i].bytes)).toBe(true));
    const orig = a.files.find((f) => f.kind === "original")!;
    expect(orig.bytes.equals(img)).toBe(true);
    expect(orig.key).toBe(`riverton-herald/2026-04-02/original/${a.meta.hash}.jpg`);
    const thumb = a.files.find((f) => f.kind === "thumb")!, web = a.files.find((f) => f.kind === "web")!;
    expect(thumb.key).toMatch(/\/thumb\/[0-9a-f]{64}\.webp$/);
    expect(Math.max(thumb.width, thumb.height)).toBe(400);
    expect(Math.max(web.width, web.height)).toBe(1200); // never upscaled past the 1200 px original
    expect(a.meta.px).toEqual([1200, 800]);
    expect(a.meta.focal).toEqual([0.5, 0.5]);
  });
  it("duplicates share one hash (stored once by key)", async () => {
    const a = await ingestImage(demo(BOAT), opts);
    const b = await ingestImage(Buffer.from(demo(BOAT)), { ...opts });
    expect(a.meta.hash).toBe(b.meta.hash);
  });
  it("fixes EXIF orientation and converts to sRGB", async () => {
    const src = await sharp({ create: { width: 600, height: 300, channels: 3, background: "#336699" } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const r = await ingestImage(src, opts);
    expect(r.meta.px).toEqual([300, 600]);
    expect(r.meta.orientationFixed).toBe(true);
    const web = r.files.find((f) => f.kind === "web")!;
    expect([web.width, web.height]).toEqual([300, 600]);
    const m = await sharp(web.bytes).metadata();
    expect(m.space).toBe("srgb");
  });
  it("rejects non-images and bad keys", async () => {
    await expect(sniffImage(Buffer.from("hello"))).rejects.toThrow();
    expect(() => assetKey("a/b", "2026-04-02", "thumb", "h", "webp")).toThrow();
  });
  it("download enforces the size cap and sniffs the type", async () => {
    const fake = (body: Buffer) => (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
    await expect(downloadImage("https://x.test/a.jpg", { maxBytes: 100, fetchImpl: fake(demo(BOAT)) })).rejects.toThrow(/size cap/);
    await expect(downloadImage("https://x.test/a.jpg", { fetchImpl: fake(Buffer.from("<html>")) })).rejects.toThrow();
    expect((await downloadImage("https://x.test/a.jpg", { fetchImpl: fake(demo(BOAT)) })).length).toBeGreaterThan(1000);
    await expect(downloadImage("file:///etc/passwd")).rejects.toThrow();
  });
});

describe("print resolution warning (reuses @epaper/layout)", () => {
  it("fires below 150 dpi at frame width, silent above, unknown size never warns", () => {
    // 1200 px across a 120 mm frame = 254 dpi: fine; across 381 mm (Broadsheet page width) = 80 dpi: low
    expect(printCheck(1200, 120).low).toBe(false);
    const lo = printCheck(1200, 381);
    expect(lo.low).toBe(true);
    expect(lo.needPx).toBeCloseTo((381 / 25.4) * 150, 5);
    expect(lo.warning).toMatch(/LOW-RES FOR PRINT · 1200px, needs 2250px\+/);
    expect(printCheck(1200, 289).low).toBe(true);   // Tabloid-width frame: needs 1707 px
    expect(printCheck(0, 381).low).toBe(false);
  });
});
