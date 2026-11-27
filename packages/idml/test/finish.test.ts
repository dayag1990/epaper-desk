import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LayoutSnapshot } from "@epaper/core";
import { LayoutEngine } from "@epaper/layout";
import { exportIdml, validateIdml } from "../src/index.js";
import { showcase } from "../../layout/test/finish-fixture.js";

let engine: LayoutEngine, snap: LayoutSnapshot;
beforeAll(async () => {
  engine = await LayoutEngine.launch();
  const { doc, template, articles } = showcase();
  snap = await engine.snapshot("ed_FINISH1", [{ doc, template }], articles);
}, 120000);
afterAll(async () => { await engine.close(); });

const read = async (bytes: Uint8Array, name: string) => (await (await JSZip.loadAsync(bytes)).file(name)!.async("string"));

describe("IDML of the newspaper finish", () => {
  it("passes every structural check, rules and boxes included (geometry within 0.1 pt)", async () => {
    const { bytes } = await exportIdml(snap);
    const rep = await validateIdml(bytes, snap);
    expect(rep.problems).toEqual([]);
    expect(rep.maxGeometryDeltaPt).toBeLessThan(0.1);
  });
  it("has the finish styles: byline, jump, pull quote and drop cap paragraph styles; dateline character style; rule, box and tint object styles", async () => {
    const { bytes, styles } = await exportIdml(snap);
    expect(styles).toEqual(expect.arrayContaining(["Story-byline", "Story-jump", "Story-pullquote", "Story-body-dropcap"]));
    const st = await read(bytes, "Resources/Styles.xml");
    expect(st).toMatch(/<ParagraphStyle [^>]*Name="Story-body-dropcap"[^>]*DropCapLines="3"[^>]*DropCapCharacters="1"/);
    expect(st).toMatch(/<CharacterStyle [^>]*Name="Dateline"[^>]*Capitalization="SmallCaps"/);
    for (const n of ["Rule-hair", "Rule-heavy", "Rule-double", "Box-brief", "Panel-tint"]) expect(st).toContain(`Name="${n}"`);
  });
  it("applies them: drop cap on the lead's first paragraph, dateline run in, rules as lines, boxes behind the text, tint colour as a swatch", async () => {
    const { bytes } = await exportIdml(snap);
    const lead = await read(bytes, "Stories/Story_p1_it_lead_2ebody.xml");
    expect(lead).toMatch(/ParagraphStyle\/Story-body-dropcap/);
    const photo = await read(bytes, "Stories/Story_p1_it_photo_2ebody.xml");
    expect(photo).toContain("Riverton, 26 Nov —");
    expect(photo).toContain("CharacterStyle/Dateline");
    const sp = await read(bytes, "Spreads/Spread_p1.xml");
    expect((sp.match(/<GraphicLine /g) ?? []).length).toBeGreaterThan(6);
    expect(sp).toContain("StrokeStyle/$ID/ThinThin");
    expect(sp).toMatch(/AppliedObjectStyle="ObjectStyle\/Panel-tint"/);
    // z-order: the panel's tint rectangle comes before (under) the first text frame; the wrapped photo comes after (over) every text frame
    expect(sp.indexOf("Panel-tint")).toBeLessThan(sp.indexOf("<TextFrame"));
    expect(sp.lastIndexOf("BoundingBoxTextWrap")).toBeGreaterThan(sp.lastIndexOf("<TextFrame"));
    const gr = await read(bytes, "Resources/Graphic.xml");
    expect(gr).toMatch(/Space="RGB" ColorValue="\d+ \d+ \d+"/);
  });
  it("is deterministic", async () => {
    const a = await exportIdml(snap), b = await exportIdml(snap);
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
  });
});
