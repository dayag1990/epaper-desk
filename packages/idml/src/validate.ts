import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import type { LayoutSnapshot } from "@epaper/core";
import { IDML_MIMETYPE } from "./export.js";
import { mmToPt, nfc } from "./xml.js";

export interface ValidationReport {
  ok: boolean;
  problems: string[];
  files: string[];
  /** Max |IDML - snapshot| over all frame edges, in points (when a snapshot was given). */
  maxGeometryDeltaPt: number;
}

type N = ReturnType<DOMParser["parseFromString"]>;
type E = N["documentElement"];

function parseXml(name: string, text: string, problems: string[]): N | null {
  const bad: string[] = [];
  const parser = new DOMParser({ errorHandler: { warning: (m: string) => bad.push(m), error: (m: string) => bad.push(m), fatalError: (m: string) => bad.push(m) } });
  const doc = parser.parseFromString(text, "text/xml");
  if (bad.length || !doc.documentElement) {
    problems.push(`${name}: not well-formed XML (${bad[0] ?? "no root"})`);
    return null;
  }
  return doc;
}

const all = (root: N | E, tag: string): E[] => Array.from((root as any).getElementsByTagName(tag));
const attr = (e: E, a: string): string => (e as any).getAttribute(a) ?? "";
const nums = (s: string) => s.trim().split(/\s+/).map(Number);

/**
 * Structural check of an IDML package. InDesign itself is NOT available here, so this proves the zip layout,
 * well-formed XML, resolvable references and geometry; it does not prove InDesign opens the file.
 */
export async function validateIdml(bytes: Uint8Array, snapshot?: LayoutSnapshot | readonly LayoutSnapshot[]): Promise<ValidationReport> {
  const problems: string[] = [];
  let maxDelta = 0;
  const zip = await JSZip.loadAsync(bytes).catch((e: Error) => { problems.push(`not a zip: ${e.message}`); return null; });
  if (!zip) return { ok: false, problems, files: [], maxGeometryDeltaPt: 0 };
  const names = Object.keys(zip.files);

  // mimetype: first entry, stored (method 0), exact content, no extra field
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nameLen = dv.getUint16(26, true), extraLen = dv.getUint16(28, true);
  const first = new TextDecoder().decode(bytes.subarray(30, 30 + nameLen));
  if (dv.getUint32(0, true) !== 0x04034b50 || first !== "mimetype") problems.push("mimetype is not the first zip entry");
  if (dv.getUint16(8, true) !== 0) problems.push("mimetype is compressed; it must be stored");
  if (extraLen !== 0) problems.push("mimetype has an extra field");
  const mt = new TextDecoder().decode(bytes.subarray(30 + nameLen + extraLen, 30 + nameLen + extraLen + IDML_MIMETYPE.length));
  if (mt !== IDML_MIMETYPE) problems.push("mimetype content is wrong");

  const docs = new Map<string, N>();
  for (const name of names) {
    if (name === "mimetype" || zip.files[name]!.dir) continue;
    const text = await zip.files[name]!.async("string");
    const d = parseXml(name, text, problems);
    if (d) docs.set(name, d);
  }
  for (const req of ["META-INF/container.xml", "designmap.xml", "Resources/Fonts.xml", "Resources/Styles.xml", "Resources/Graphic.xml", "Resources/Preferences.xml", "XML/Tags.xml", "XML/BackingStory.xml"])
    if (!docs.has(req)) problems.push(`${req} is missing`);
  const cont = docs.get("META-INF/container.xml");
  if (cont && !all(cont, "rootfile").some((r) => attr(r, "full-path") === "designmap.xml")) problems.push("container.xml does not point to designmap.xml");

  const dm = docs.get("designmap.xml");
  const referenced = new Set<string>();
  const storySelfs = new Map<string, string>(); // story Self -> file
  const styleSelfs = new Set<string>();
  if (dm) {
    for (const e of Array.from((dm.documentElement as any).childNodes as E[])) {
      const src = e.nodeType === 1 ? attr(e, "src") : "";
      if (!src) continue;
      referenced.add(src);
      if (!docs.has(src)) problems.push(`designmap points to ${src}, which is not in the zip`);
    }
    for (const n of names) if (/^(Spreads|MasterSpreads|Stories)\/.+\.xml$/.test(n) && !referenced.has(n)) problems.push(`${n} is in the zip but not in designmap`);
    for (const [name, d] of docs) if (name.startsWith("Stories/")) for (const s of all(d, "Story")) storySelfs.set(attr(s, "Self"), name);
    const list = attr(dm.documentElement as E, "StoryList").split(/\s+/).filter(Boolean);
    for (const s of list) if (!storySelfs.has(s)) problems.push(`StoryList names ${s}, which has no story file`);
    for (const s of storySelfs.keys()) if (!list.includes(s)) problems.push(`story ${s} is missing from StoryList`);
  }
  const styles = docs.get("Resources/Styles.xml");
  if (styles) for (const t of ["ParagraphStyle", "CharacterStyle", "ObjectStyle"]) for (const s of all(styles, t)) styleSelfs.add(attr(s, "Self"));
  const swatches = new Set<string>();
  const gr = docs.get("Resources/Graphic.xml");
  if (gr) for (const t of ["Color", "Swatch"]) for (const s of all(gr, t)) swatches.add(attr(s, "Self"));

  // stories: styles resolve; collect text
  let storyText = "";
  for (const [name, d] of docs) {
    if (!name.startsWith("Stories/")) continue;
    for (const r of all(d, "ParagraphStyleRange")) if (!styleSelfs.has(attr(r, "AppliedParagraphStyle"))) problems.push(`${name}: unknown paragraph style ${attr(r, "AppliedParagraphStyle")}`);
    for (const r of all(d, "CharacterStyleRange")) if (!styleSelfs.has(attr(r, "AppliedCharacterStyle"))) problems.push(`${name}: unknown character style ${attr(r, "AppliedCharacterStyle")}`);
    for (const c of all(d, "Content")) storyText += (c as any).textContent + "\n";
  }

  // spreads: frames
  const spreadNames = [...docs.keys()].filter((n) => n.startsWith("Spreads/")).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const snapPages = snapshot ? (Array.isArray(snapshot) ? (snapshot as readonly LayoutSnapshot[]) : [snapshot as LayoutSnapshot]).flatMap((s) => s.pages) : null;
  if (snapPages && snapPages.length !== spreadNames.length) problems.push(`snapshot has ${snapPages.length} pages, IDML has ${spreadNames.length} spreads`);
  const seen = new Set<string>();
  spreadNames.forEach((sn, i) => {
    const d = docs.get(sn)!;
    const spread = all(d, "Spread")[0]!;
    const page = all(spread, "Page")[0];
    if (!page) { problems.push(`${sn}: no page`); return; }
    const pb = nums(attr(page, "GeometricBounds")); // top left bottom right
    const pt = nums(attr(page, "ItemTransform"));
    const originX = pt[4]! + pb[1]!, originY = pt[5]! + pb[0]!;
    const snapPage = snapPages?.[i];
    if (snapPage) {
      const dw = Math.abs(pb[3]! - pb[1]! - mmToPt(snapPage.w)), dh = Math.abs(pb[2]! - pb[0]! - mmToPt(snapPage.h));
      maxDelta = Math.max(maxDelta, dw, dh);
      if (dw > 0.1 || dh > 0.1) problems.push(`${sn}: page size differs from the snapshot`);
    }
    const frames = [...all(spread, "TextFrame"), ...all(spread, "Rectangle"), ...all(spread, "GraphicLine")];
    for (const f of frames) {
      const self = attr(f, "Self");
      if (seen.has(self)) problems.push(`${sn}: duplicate id ${self}`);
      seen.add(self);
      if (attr(f, "AppliedObjectStyle") && !styleSelfs.has(attr(f, "AppliedObjectStyle"))) problems.push(`${self}: unknown object style`);
      for (const a of ["FillColor", "StrokeColor"]) if (attr(f, a) && !swatches.has(attr(f, a))) problems.push(`${self}: unknown swatch ${attr(f, a)}`);
      if (f.tagName === "TextFrame") {
        const ps = attr(f, "ParentStory");
        if (!storySelfs.has(ps)) problems.push(`${self}: story ${ps} does not exist`);
        for (const l of ["PreviousTextFrame", "NextTextFrame"]) { const v = attr(f, l); if (v && v !== "n" && !frames.some((o) => attr(o, "Self") === v)) problems.push(`${self}: ${l} ${v} does not exist`); }
      }
      const tf = nums(attr(f, "ItemTransform") || "1 0 0 1 0 0");
      const pts = all(f, "PathPointType").map((p) => nums(attr(p, "Anchor")));
      if (!pts.length) { problems.push(`${self}: no path`); continue; }
      const xs = pts.map((p) => tf[0]! * p[0]! + tf[2]! * p[1]! + tf[4]! - originX), ys = pts.map((p) => tf[1]! * p[0]! + tf[3]! * p[1]! + tf[5]! - originY);
      const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      const want = snapPage?.frames.find((s) => s.id === attr(f, "Name"));
      if (snapPage && !want) problems.push(`${self}: not in the snapshot`);
      if (want) {
        const dl = [box.x - mmToPt(want.x), box.y - mmToPt(want.y), box.w - mmToPt(want.w), box.h - mmToPt(want.h)].map(Math.abs);
        maxDelta = Math.max(maxDelta, ...dl);
        if (Math.max(...dl) > 0.1) problems.push(`${self}: geometry differs from the snapshot by ${Math.max(...dl).toFixed(3)} pt`);
      }
    }
    if (snapPage) {
      for (const s of snapPage.frames) if (!frames.some((f) => attr(f, "Name") === s.id)) problems.push(`page ${snapPage.no}: snapshot frame ${s.id} is missing from the IDML`);
      for (const s of snapPage.frames) {
        if (s.role === "head" && s.text && !nfc(storyText).includes(nfc(s.text))) problems.push(`headline of ${s.id} is not in any story`);
      }
    }
    for (const im of all(spread, "Link")) if (!attr(im, "LinkResourceURI")) problems.push("a Link has no LinkResourceURI");
  });
  return { ok: problems.length === 0, problems, files: names, maxGeometryDeltaPt: maxDelta };
}
