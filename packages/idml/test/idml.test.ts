import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LayoutSnapshot } from "@epaper/core";
import { LayoutEngine } from "@epaper/layout";
import { DEFAULT_STYLE_MAP, exportIdml, parseStyleMap, validateIdml } from "../src/index.js";
import { englishSnapshot, punjabiSnapshot } from "./inputs.js";

let engine: LayoutEngine;
let en: LayoutSnapshot, pa: LayoutSnapshot;
beforeAll(async () => {
  engine = await LayoutEngine.launch();
  en = await englishSnapshot(engine);
  pa = await punjabiSnapshot(engine);
}, 180000);
afterAll(async () => { await engine.close(); });

describe.each([["english-15 (4 pages)", () => en], ["Punjabi BlinkCMS sample", () => pa]] as const)("%s", (_n, get) => {
  it("exports a package that passes every structural check (geometry within 0.1 pt, headlines present)", async () => {
    const snap = get();
    const { bytes } = await exportIdml(snap);
    const rep = await validateIdml(bytes, snap);
    expect(rep.problems).toEqual([]);
    expect(rep.ok).toBe(true);
    expect(rep.maxGeometryDeltaPt).toBeLessThan(0.1);
    expect(rep.files.filter((f) => f.startsWith("Spreads/")).length).toBe(snap.pages.length);
    expect(snap.pages.flatMap((p) => p.frames).some((f) => f.role === "head")).toBe(true);
  });

  it("is deterministic: same input gives the same bytes", async () => {
    const a = await exportIdml(get()), b = await exportIdml(get());
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
  });
});

describe("package details", () => {
  it("has the IDML layout and mimetype first, stored", async () => {
    const { bytes } = await exportIdml(en);
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files);
    expect(names[0]).toBe("mimetype");
    for (const p of ["META-INF/container.xml", "designmap.xml", "Resources/Fonts.xml", "Resources/Styles.xml", "Resources/Graphic.xml", "Resources/Preferences.xml", "MasterSpreads/MasterSpread_A.xml", "XML/Tags.xml", "XML/BackingStory.xml"]) expect(names).toContain(p);
    expect(names.some((n) => n.startsWith("Stories/"))).toBe(true);
  });

  it("keeps Punjabi (Gurmukhi) text intact as NFC, escaped", async () => {
    const { bytes } = await exportIdml(pa);
    const zip = await JSZip.loadAsync(bytes);
    let all = "";
    for (const n of Object.keys(zip.files)) if (n.startsWith("Stories/")) all += await zip.files[n]!.async("string");
    const heads = pa.pages.flatMap((p) => p.frames).filter((f) => f.role === "head" && f.text);
    expect(heads.length).toBeGreaterThan(3);
    for (const h of heads) expect(all).toContain(h.text!.normalize("NFC").replace(/&/g, "&amp;"));
    expect(/[਀-੿]/.test(all)).toBe(true);
  });

  it("escapes markup and drops illegal control characters", async () => {
    const snap = structuredClone(en);
    const head = snap.pages[0]!.frames.find((f) => f.role === "head")!;
    head.text = `A & B <tag> "q" \u0001 é`;
    const { bytes } = await exportIdml(snap);
    const rep = await validateIdml(bytes);
    expect(rep.problems).toEqual([]);
    const zip = await JSZip.loadAsync(bytes);
    let all = "";
    for (const n of Object.keys(zip.files)) if (n.startsWith("Stories/")) all += await zip.files[n]!.async("string");
    expect(all).toContain("A &amp; B &lt;tag&gt; &quot;q&quot;  é");
  });

  it("links photos by file name with crop applied, and one multi-column body frame", async () => {
    const { bytes, links } = await exportIdml(en);
    expect(links.length).toBeGreaterThan(0);
    const zip = await JSZip.loadAsync(bytes);
    const sp = await zip.files["Spreads/Spread_p1.xml"]!.async("string");
    expect(sp).toContain(`LinkResourceURI="file:Links/${links[0]}"`);
    expect(sp).toContain("<Image ");
    expect(sp).toMatch(/TextColumnCount="\d+" TextColumnGutter=/);
  });

  it("uses the style map to rename paragraph styles, and defaults to our demo names", async () => {
    const def = await exportIdml(en);
    expect(def.styles).toEqual(expect.arrayContaining(["Story-head", "Story-body"]));
    expect(Object.keys(DEFAULT_STYLE_MAP.paragraph)).toContain("Story-sub-head");
    const mapped = await exportIdml(en, { styleMap: parseStyleMap({ paragraph: { "Story-head": "Headline", "Story-body": "Body Text" } }) });
    expect(mapped.styles).toEqual(expect.arrayContaining(["Headline", "Body Text"]));
    expect(mapped.styles).not.toContain("Story-head");
    expect((await validateIdml(mapped.bytes, en)).problems).toEqual([]);
    expect(() => parseStyleMap({})).toThrow();
  });

  it("the validator catches broken packages", async () => {
    const { bytes } = await exportIdml(en);
    const zip = await JSZip.loadAsync(bytes);
    const f = Object.keys(zip.files).find((n) => n.startsWith("Stories/"))!;
    zip.file(f, "<broken");
    const broken = await zip.generateAsync({ type: "uint8array" });
    const rep = await validateIdml(broken, en);
    expect(rep.ok).toBe(false);
    expect(rep.problems.join("\n")).toMatch(/not well-formed/);
    const moved = structuredClone(en);
    moved.pages[0]!.frames[0]!.x += 1;
    expect((await validateIdml(bytes, moved)).ok).toBe(false);
    expect((await validateIdml(new Uint8Array([1, 2, 3]))).ok).toBe(false);
  });
});

describe("photo caption", () => {
  it("is a text frame of its own (style Story-caption), its text keeps the credit, and the package still validates", async () => {
    const CAP = "File photo · Photo: Jane Doe, CC BY 4.0, Wikimedia Commons";
    const caps = en.pages.flatMap((p) => p.frames).filter((f) => f.role === "caption");
    expect(caps.length).toBeGreaterThan(0); // the English fixture photos carry captions, so the layout made caption frames
    const first = caps[0]!;
    const withCap: LayoutSnapshot = { ...en, pages: en.pages.map((p) => ({ ...p, frames: p.frames.map((f) => (f === first ? { ...f, text: CAP } : f)) })) };
    const { bytes, styles } = await exportIdml(withCap);
    const zip = await JSZip.loadAsync(bytes);
    const stories = await Promise.all(Object.keys(zip.files).filter((n) => n.startsWith("Stories/")).map((n) => zip.files[n]!.async("string")));
    const hit = stories.filter((x) => x.includes("Jane Doe, CC BY 4.0, Wikimedia Commons"));
    expect(hit).toHaveLength(1);
    expect(hit[0]).toContain("ParagraphStyle/Story-caption");
    expect(styles).toContain("Story-caption");
    const rep = await validateIdml(bytes, withCap);
    expect(rep.problems).toEqual([]);
    expect(rep.ok).toBe(true);
  });
});
