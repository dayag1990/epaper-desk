// IDML export of the Tamil edition: snapshot of the planned 8 pages (with a real PNG on every lead story) -> delivery zip -> structural validation.
// InDesign is not available here: this proves the package is well-formed and carries the Tamil text and the names; it does NOT prove shaping or line breaks in InDesign.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import sharp from "sharp";
import type { Article, LayoutSnapshot } from "@epaper/core";
import { LayoutEngine, type PlanResult } from "../../packages/layout/dist/index.js";
import { packEditionIdml, validateIdml, type PackedAsset } from "../../packages/idml/dist/index.js";
import { ingestTamil, planTamil } from "./lib/tamil.js";

// jszip is a dependency of packages/idml, not of the repo root
const JSZip = createRequire(new URL("../../packages/idml/package.json", import.meta.url))("jszip") as typeof import("../../packages/idml/node_modules/jszip");

let eng: LayoutEngine, arts: Article[], plan: PlanResult, snap: LayoutSnapshot, assets: PackedAsset[];
let packed: Awaited<ReturnType<typeof packEditionIdml>>;
const fontStyles = { Masthead: "ExtraBold", Strip: "Bold", "Story-kicker": "Bold", "Story-head": "ExtraBold", "Story-sub-head": "Bold", "Story-body": "Regular" };

beforeAll(async () => {
  eng = await LayoutEngine.launch();
  const base = await ingestTamil();
  const first = await planTamil(eng, base);
  const png = await sharp({ create: { width: 1800, height: 1200, channels: 3, background: "#7a8a6a" } }).png().toBuffer();
  const uri = "data:image/png;base64," + png.toString("base64");
  const leads = new Set(first.pages.map((p) => p.articles[0]!));
  arts = base.map((a) => (leads.has(a.id) ? { ...a, images: [{ asset_id: `ast_lead${a.id.slice(-3)}` as never, role: "lead", src: uri }] } : a));
  assets = [...leads].map((id) => ({ asset_id: `ast_lead${id.slice(-3)}`, ext: "png", bytes: png, w_px: 1800, h_px: 1200 }));
  plan = await planTamil(eng, arts);
  snap = await eng.snapshot("ed_ta", plan.pages.map((p) => ({ doc: p.fit.doc, template: p.template })), arts);
  packed = await packEditionIdml(snap, assets, "thenpothigai_2026-11-24", { fontStyles, indicComposer: "HL Composer Optyca" });
}, 240_000);
afterAll(async () => { await eng?.close(); });

describe("Tamil IDML package", () => {
  it("passes the structural validator, every frame within 0.1 pt of the browser layout", async () => {
    const rep = await validateIdml(packed.idml.bytes, snap);
    expect(rep.problems).toEqual([]);
    expect(rep.ok).toBe(true);
    expect(rep.maxGeometryDeltaPt).toBeLessThan(0.1);
    console.log(`IDML: ${snap.pages.length} pages, ${snap.pages.reduce((n, p) => n + p.frames.length, 0)} frames, max geometry difference ${rep.maxGeometryDeltaPt.toFixed(4)} pt, ${rep.files.length} files`);
  });

  it("the zip holds the .idml and every photo in Links/, named by asset id", async () => {
    const z = await JSZip.loadAsync(packed.zip);
    const names = Object.keys(z.files).sort();
    expect(names).toContain("thenpothigai_2026-11-24.idml");
    expect(packed.linked).toHaveLength(8);
    for (const f of packed.linked) expect(names).toContain(`Links/${f}`);
    expect(packed.missing).toEqual([]);
    expect((await z.file("thenpothigai_2026-11-24.idml")!.async("uint8array")).length).toBe(packed.idml.bytes.length);
  });

  it("Stories carry the Tamil text of every headline and paragraph, in NFC", async () => {
    const z = await JSZip.loadAsync(packed.idml.bytes);
    let text = "";
    for (const n of Object.keys(z.files).filter((f) => f.startsWith("Stories/"))) text += (await z.file(n)!.async("string")) + "\n";
    const content = [...text.matchAll(/<Content>([^<]*)<\/Content>/g)].map((m) => m[1]!.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"'));
    expect(content.length).toBeGreaterThan(40 * 3);
    for (const c of content) expect(c.normalize("NFC")).toBe(c);
    const all = content.join("\n");
    let heads = 0, paras = 0;
    for (const p of plan.pages) for (const it of p.fit.doc.items) {
      expect(all).toContain(it.text!.head); heads++;
      for (const b of it.text!.body) { expect(all).toContain(b); paras++; }
    }
    expect(heads).toBe(40);
    expect(paras).toBeGreaterThanOrEqual(40 * 2);
    expect(all).toContain("தென்பொதிகை");
    expect(all).toContain("மாதிரி இதழ் · டெமோ");
    expect(all).toContain("நவம்பர் 24, 2026");
  });

  it("names the two families, our paragraph styles, the Indic composer, no hyphenation and the named font instances", async () => {
    const z = await JSZip.loadAsync(packed.idml.bytes);
    const fonts = await z.file("Resources/Fonts.xml")!.async("string");
    expect(fonts).toContain('Name="Noto Serif Tamil"');
    expect(fonts).toContain('Name="Anek Tamil"');
    const styles = await z.file("Resources/Styles.xml")!.async("string");
    for (const s of ["Story-head", "Story-sub-head", "Story-body"]) expect(styles).toContain(`Name="${s}"`);
    expect(packed.idml.styles).toEqual(expect.arrayContaining(["Story-head", "Story-sub-head", "Story-body"]));
    const head = styles.match(/<ParagraphStyle [^>]*Name="Story-head"[^>]*>.*?<\/ParagraphStyle>/s)![0];
    expect(head).toContain('FontStyle="ExtraBold"');
    expect(head).toContain("<AppliedFont type=\"string\">Anek Tamil</AppliedFont>");
    expect(head).toContain('<Composer type="string">HL Composer Optyca</Composer>');
    expect(head).toContain('Hyphenation="false"');
    const body = styles.match(/<ParagraphStyle [^>]*Name="Story-body"[^>]*>.*?<\/ParagraphStyle>/s)![0];
    expect(body).toContain("<AppliedFont type=\"string\">Noto Serif Tamil</AppliedFont>");
    expect(body).toContain('<Composer type="string">HL Composer Optyca</Composer>');
    expect(body).toContain('FontStyle="Regular"');
    // body frames keep their column count and gutter
    const spreads = (await Promise.all(Object.keys(z.files).filter((f) => f.startsWith("Spreads/")).map((f) => z.file(f)!.async("string")))).join("");
    expect(spreads).toMatch(/TextColumnCount="[2-4]"/);
  });

  it("same input, same bytes", async () => {
    const again = await packEditionIdml(snap, assets, "thenpothigai_2026-11-24", { fontStyles, indicComposer: "HL Composer Optyca" });
    expect(Buffer.compare(Buffer.from(again.zip), Buffer.from(packed.zip))).toBe(0);
  });

  it("a photo missing from the files store is reported, and its frame is still in the file", async () => {
    const r = await packEditionIdml(snap, assets.slice(1), "x", { fontStyles });
    expect(r.missing).toHaveLength(1);
    expect(r.linked).toHaveLength(7);
    expect((await validateIdml(r.idml.bytes, snap)).problems).toEqual([]);
  });
});
