import JSZip from "jszip";
import type { Frame, LayoutSnapshot } from "@epaper/core";
import { DOM_VERSION, IDPKG_NS, XML_DECL, clean, el, esc, mmToPt, nfc, safeId } from "./xml.js";
import { DEFAULT_STYLE_MAP, FINISH_STYLE, ROLE_DEFAULT_STYLE, type StyleMap } from "./style-map.js";

export const IDML_MIMETYPE = "application/vnd.adobe.indesign-idml-package";
export const NO_PSTYLE = "ParagraphStyle/$ID/[No paragraph style]";
export const NO_CSTYLE = "CharacterStyle/$ID/[No character style]";
export const NO_OBJSTYLE = "ObjectStyle/$ID/[None]";

export interface ImageInfo {
  w_px: number;
  h_px: number;
  /** Native resolution; the image's own size in points is px * 72 / ppi. Default 72. */
  ppi?: number;
}

export interface IdmlOptions {
  /** Document name (informational only). Default "edition". */
  name?: string;
  /** Our paragraph style names -> names written to the IDML. Default: our demo names unchanged. */
  styleMap?: StyleMap;
  /** Natural size of linked images by file name (e.g. "100.jpg"). Without it the size is derived from the crop. */
  images?: Record<string, ImageInfo>;
  /** Link URI prefix. Default "file:Links/" (Links/ folder beside the .idml). */
  linkBase?: string;
  /** Paragraph composer written on styles whose text is Indic script. Default "HL Composer Optyca" (World-Ready, per M6 spec); null = do not write one. */
  indicComposer?: string | null;
  /**
   * FontStyle written per paragraph style (after the style map), e.g. {"Story-head": "ExtraBold"}: the named instance of a
   * variable family InDesign should pick. Styles not listed get "Regular".
   */
  fontStyles?: Record<string, string>;
}

export interface IdmlResult {
  /** The .idml zip. */
  bytes: Uint8Array;
  /** Files the IDML links to (copy them to Links/ beside the .idml). */
  links: string[];
  /** Paragraph style names used in the file (after the style map). */
  styles: string[];
}

const INDIC = /[ऀ-෿]/;
const FIXED_DATE = new Date(Date.UTC(2000, 0, 1, 0, 0, 0));
const EXT_FORMAT: Record<string, string> = { jpg: "$ID/JPEG", jpeg: "$ID/JPEG", png: "$ID/PNG", tif: "$ID/TIFF", tiff: "$ID/TIFF", pdf: "$ID/PDF", psd: "$ID/Photoshop", eps: "$ID/EPS" };

const idPkgRoot = (tag: string, body: string | string[], extra: Record<string, string> = {}) =>
  XML_DECL + `<idPkg:${tag} xmlns:idPkg="${IDPKG_NS}" DOMVersion="${DOM_VERSION}"${Object.entries(extra).map(([k, v]) => ` ${k}="${esc(v)}"`).join("")}>${Array.isArray(body) ? body.join("") : body}</idPkg:${tag}>`;

const pstyleSelf = (name: string) => "ParagraphStyle/" + nfc(name).replace(/:/g, "%3a");

interface StyleDef { name: string; font?: string; size?: number; indic: boolean; dropcap?: number }

function pathXml(w: number, h: number): string {
  const pt = (x: number, y: number) => el("PathPointType", { Anchor: `${x} ${y}`, LeftDirection: `${x} ${y}`, RightDirection: `${x} ${y}` });
  return el("Properties", {}, el("PathGeometry", {}, el("GeometryPathType", { PathOpen: false }, el("PathPointArray", {}, [pt(0, 0), pt(0, h), pt(w, h), pt(w, 0)]))));
}

const marginPref = el("MarginPreference", { ColumnCount: 1, ColumnGutter: 12, Top: 0, Bottom: 0, Left: 0, Right: 0, ColumnDirection: "Horizontal" });

function pageXml(self: string, name: string, masterRef: string, wPt: number, hPt: number): string {
  return el("Page", {
    Self: self, Name: name, AppliedMaster: masterRef, GeometricBounds: `0 0 ${hPt} ${wPt}`, ItemTransform: `1 0 0 1 ${-wPt / 2} ${-hPt / 2}`,
    OverrideList: "", TabOrder: "", GridStartingPoint: "TopOutside", UseMasterGrid: true,
  }, marginPref);
}

const CS_DATELINE = "CharacterStyle/Dateline";

/**
 * One story: one paragraph per text paragraph. `firstStyle` styles the first paragraph differently (drop cap), and `dateline`
 * is run into the start of the first paragraph in the Dateline character style (small caps, bold).
 */
function storyXml(self: string, paras: string[], style: string, o: { firstStyle?: string; dateline?: string } = {}): string {
  const body = (paras.length ? paras : [""]).map((t, i, a) => {
    const dl = i === 0 && o.dateline ? el("CharacterStyleRange", { AppliedCharacterStyle: CS_DATELINE }, `<Content>${esc(o.dateline)}</Content>`) : "";
    const text = i === 0 && o.dateline && t !== "" ? " " + t : t;
    return el("ParagraphStyleRange", { AppliedParagraphStyle: pstyleSelf(i === 0 && o.firstStyle ? o.firstStyle : style) },
      dl + el("CharacterStyleRange", { AppliedCharacterStyle: NO_CSTYLE }, [text === "" ? "" : `<Content>${esc(text)}</Content>`, i < a.length - 1 ? "<Br/>" : ""].join("")));
  });
  const story = el("Story", { Self: self, AppliedTOCStyle: "n", TrackChanges: false, StoryTitle: "$ID/", AppliedNamedGrid: "n" }, [
    el("StoryPreference", { OpticalMarginAlignment: false, OpticalMarginSize: 12, FrameType: "TextFrameType", StoryOrientation: "Horizontal", StoryDirection: "LeftToRightDirection" }),
    ...body,
  ]);
  return idPkgRoot("Story", story);
}

/** A straight line as a GraphicLine (open two-point path), horizontal when h = 0 and vertical when w = 0. */
function lineXml(common: Record<string, string | number>, w: number, h: number, weight: number, stroke: string, double: boolean): string {
  const pt = (x: number, y: number) => el("PathPointType", { Anchor: `${x} ${y}`, LeftDirection: `${x} ${y}`, RightDirection: `${x} ${y}` });
  return el("GraphicLine", { ...common, StrokeColor: stroke, StrokeWeight: weight, ...(double ? { StrokeType: "StrokeStyle/$ID/ThinThin" } : {}), FillColor: "Swatch/None" },
    el("Properties", {}, el("PathGeometry", {}, el("GeometryPathType", { PathOpen: true }, el("PathPointArray", {}, [pt(0, 0), pt(w, h)])))));
}
const OBJ_STYLES = { hair: "Rule-hair", heavy: "Rule-heavy", double: "Rule-double", brief: "Box-brief", panel: "Panel-tint", quote: "Quote-box" } as const;
const objSelf = (n: string) => `ObjectStyle/${n}`;
const RULE_PT = { hair: 0.5, heavy: 3, double: 3 } as const;

/** Visible window of the image (crop) fills the frame; sizes in points. */
function imageTransform(f: Frame, wPt: number, hPt: number, info: ImageInfo | undefined) {
  const [cx, cy, cw, ch] = f.crop ?? [0, 0, 1, 1];
  let iw: number, ih: number;
  if (info) {
    const k = 72 / (info.ppi ?? 72);
    iw = info.w_px * k; ih = info.h_px * k;
  } else {
    // natural aspect implied by the crop: visible region (cw*W by ch*H) has the frame's aspect
    iw = 1000; ih = (iw * cw * hPt) / (ch * wPt);
  }
  const s = wPt / (cw * iw);
  return { iw, ih, matrix: `${s} 0 0 ${s} ${-cx * iw * s} ${-cy * ih * s}` };
}

/**
 * LayoutSnapshot(s) -> IDML package. Pure and deterministic: same input, same bytes.
 * One single-page spread per snapshot page; one story + one text frame per text frame (a body frame is
 * one multi-column frame); photos are Rectangle + linked Image; text is exported in full (overset stays overset).
 */
export async function exportIdml(input: LayoutSnapshot | readonly LayoutSnapshot[], opts: IdmlOptions = {}): Promise<IdmlResult> {
  const snaps = Array.isArray(input) ? (input as readonly LayoutSnapshot[]) : [input as LayoutSnapshot];
  const pages = snaps.flatMap((s) => s.pages);
  if (!pages.length) throw new Error("The layout has no pages, so there is nothing to export.");
  const map = opts.styleMap ?? DEFAULT_STYLE_MAP;
  const linkBase = opts.linkBase ?? "file:Links/";
  const composer = opts.indicComposer === undefined ? "HL Composer Optyca" : opts.indicComposer;
  const styleName = (n: string) => map.paragraph[n] ?? n;

  const styles = new Map<string, StyleDef>();
  const used = new Set<string>(); // object styles used
  const colors = new Map<string, string>(); // #rrggbb -> swatch self
  let usesDateline = false;
  const swatch = (hex: string): string => {
    const h = /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : "#1a1a1a";
    if (!colors.has(h)) colors.set(h, `Color/RGB_${h.slice(1)}`);
    return colors.get(h)!;
  };
  const fonts = new Set<string>();
  const links: string[] = [];
  const files: [string, string][] = [];
  const storyIds: string[] = [];
  const spreadFiles: string[] = [];
  const storyFiles: string[] = [];

  pages.forEach((pg, pi) => {
    const wPt = mmToPt(pg.w), hPt = mmToPt(pg.h);
    const n = pi + 1;
    const out: string[] = [pageXml(`Page_p${n}`, String(pg.no), "MasterSpread_A", wPt, hPt)];
    const behind: string[] = []; // boxes and tints sit under the text
    const front: string[] = []; // a cut-out photo sits above the text frame it wraps (text wrap only acts on frames below the object)
    for (const f of pg.frames) {
      const fid = `p${n}_${safeId(f.id)}`;
      const w = mmToPt(f.w), h = mmToPt(f.h);
      const tx = -wPt / 2 + mmToPt(f.x), ty = -hPt / 2 + mmToPt(f.y);
      const common = { Self: `Frame_${fid}`, Name: f.id, ItemTransform: `1 0 0 1 ${tx} ${ty}`, AppliedObjectStyle: NO_OBJSTYLE };
      if (f.role === "rule") {
        const stroke = swatch(f.color ?? "#1a1a1a");
        used.add(OBJ_STYLES[f.rule ?? "hair"]);
        const g = { Self: `Frame_${fid}`, Name: f.id, ItemTransform: `1 0 0 1 ${tx} ${ty}`, AppliedObjectStyle: objSelf(OBJ_STYLES[f.rule ?? "hair"]) };
        out.push(lineXml(g, w, h, RULE_PT[f.rule ?? "hair"], stroke, f.rule === "double"));
        continue;
      }
      if (f.role === "box") {
        const kind = f.block === "panel" ? "panel" : "brief";
        used.add(OBJ_STYLES[kind]);
        behind.push(el("Rectangle", { ...common, AppliedObjectStyle: objSelf(OBJ_STYLES[kind]), ContentType: "Unassigned", FillColor: f.tint ? swatch(f.tint) : "Swatch/None", StrokeColor: f.block === "brief" ? swatch(f.color ?? "#1a1a1a") : "Swatch/None", StrokeWeight: f.block === "brief" ? 1.5 : 0 }, [pathXml(w, h)]));
        continue;
      }
      if (f.role === "image" || f.role === "ad") {
        let inner = "";
        if (f.file) {
          const t = imageTransform(f, w, h, opts.images?.[f.file]);
          const ext = f.file.split(".").pop()!.toLowerCase();
          links.push(f.file);
          inner = el("Image", { Self: `Image_${fid}`, ItemTransform: t.matrix }, [
            el("Properties", {}, el("GraphicBounds", { Left: 0, Top: 0, Right: t.iw, Bottom: t.ih })),
            el("Link", { Self: `Link_${fid}`, LinkResourceURI: linkBase + encodeURI(f.file), ...(EXT_FORMAT[ext] ? { LinkResourceFormat: EXT_FORMAT[ext] } : {}), StoredState: "Normal" }),
          ]);
        }
        // Cut-out photo: text wraps around the object's bounds with a small offset. (The page shows the real outline from the PNG's alpha;
        // InDesign needs the alpha channel or a clipping path in the linked file for an outline wrap, which an IDML cannot carry, so
        // the wrap here is the bounding box: best effort, a designer can switch it to "Object shape: Detect edges" in one click.)
        const wrap = f.wrap === "alpha"
          ? el("TextWrapPreference", { Inverse: false, ApplyToMasterPageOnly: false, TextWrapSide: "BothSides", TextWrapMode: "BoundingBoxTextWrap" }, [
              el("Properties", {}, el("TextWrapOffset", { Top: 3, Left: 3, Bottom: 3, Right: 6 })),
            ])
          : "";
        const rect = el("Rectangle", { ...common, ContentType: "GraphicType", FillColor: "Swatch/None", StrokeColor: "Swatch/None", StrokeWeight: 0 }, [pathXml(w, h), wrap, inner]);
        (f.wrap === "alpha" ? front : out).push(rect);
        continue;
      }
      // text roles
      let sname = styleName(f.style ?? ROLE_DEFAULT_STYLE[f.role as keyof typeof ROLE_DEFAULT_STYLE] ?? "Story-body");
      if (f.block === "quote" && f.role === "head") sname = styleName(FINISH_STYLE.pullquote);
      const paras = f.role === "body" ? (f.paras ?? []) : f.text ? [f.text] : [];
      const firstStyle = f.role === "body" && f.dropcap_lines ? styleName(FINISH_STYLE.dropcapBody) : undefined;
      if (f.role === "body" && f.dateline) usesDateline = true;
      const cleanParas = paras.map(clean);
      const prev = styles.get(sname);
      const indic = (prev?.indic ?? false) || cleanParas.some((p) => INDIC.test(p));
      styles.set(sname, { name: sname, font: prev?.font ?? f.font, size: prev?.size ?? f.size_pt, indic });
      if (f.font) fonts.add(nfc(f.font));
      const sid = `Story_${fid}`;
      storyIds.push(sid);
      storyFiles.push(`Stories/${sid}.xml`);
      if (firstStyle) {
        const base = styles.get(sname);
        styles.set(firstStyle, { name: firstStyle, font: base?.font ?? f.font, size: base?.size ?? f.size_pt, indic, dropcap: f.dropcap_lines });
      }
      files.push([`Stories/${sid}.xml`, storyXml(sid, cleanParas, sname, { firstStyle, dateline: f.role === "body" && f.dateline ? clean(f.dateline) : undefined })]);
      const prefAttrs = f.role === "body" ? { TextColumnCount: f.cols ?? 1, TextColumnGutter: mmToPt(f.gutter ?? 0) } : { TextColumnCount: 1 };
      out.push(el("TextFrame", { ...common, ParentStory: sid, PreviousTextFrame: "n", NextTextFrame: "n", ContentType: "TextType", FillColor: "Swatch/None", StrokeColor: "Swatch/None", StrokeWeight: 0 }, [
        pathXml(w, h),
        el("TextFramePreference", prefAttrs),
      ]));
    }
    out.splice(1, 0, ...behind);
    out.push(...front);
    const sp = el("Spread", { Self: `Spread_p${n}`, PageCount: 1, BindingLocation: 0, AllowPageShuffle: true, ShowMasterItems: true, ItemTransform: "1 0 0 1 0 0" }, out);
    spreadFiles.push(`Spreads/Spread_p${n}.xml`);
    files.push([`Spreads/Spread_p${n}.xml`, idPkgRoot("Spread", sp)]);
  });

  const p0 = pages[0]!;
  const w0 = mmToPt(p0.w), h0 = mmToPt(p0.h);
  const masterFile = "MasterSpreads/MasterSpread_A.xml";
  files.push([masterFile, idPkgRoot("MasterSpread", el("MasterSpread", { Self: "MasterSpread_A", Name: "A-Master", NamePrefix: "A", BaseName: "Master", ShowMasterItems: true, PageCount: 1, OverriddenPageItemProps: "", ItemTransform: "1 0 0 1 0 0" }, pageXml("MasterPage_A", "A", "n", w0, h0)))]);

  const styleDefs = [...styles.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const pstyles = styleDefs.map((s) =>
    el("ParagraphStyle", { Self: pstyleSelf(s.name), Name: nfc(s.name), Imported: false, KeyboardShortcut: "0 0", ...(s.size ? { PointSize: s.size } : {}), ...(s.dropcap ? { DropCapLines: s.dropcap, DropCapCharacters: 1 } : {}), FontStyle: opts.fontStyles?.[s.name] ?? "Regular", ...(s.indic ? { Hyphenation: false } : {}) }, el("Properties", {}, [
      el("BasedOn", { type: "string" }, "$ID/[No paragraph style]"),
      ...(s.font ? [el("AppliedFont", { type: "string" }, esc(s.font))] : []),
      ...(s.indic && composer ? [el("Composer", { type: "string" }, esc(composer))] : []),
    ])),
  );
  const noP = el("ParagraphStyle", { Self: NO_PSTYLE, Name: "$ID/[No paragraph style]", Imported: false, NextStyle: NO_PSTYLE, KeyboardShortcut: "0 0" });
  files.push(["Resources/Styles.xml", idPkgRoot("Styles", [
    el("RootCharacterStyleGroup", { Self: "RootCharacterStyleGroup" }, [
      el("CharacterStyle", { Self: NO_CSTYLE, Imported: false, KeyboardShortcut: "0 0", Name: "$ID/[No character style]" }),
      ...(usesDateline ? [el("CharacterStyle", { Self: CS_DATELINE, Imported: false, KeyboardShortcut: "0 0", Name: "Dateline", Capitalization: "SmallCaps", FontStyle: "Bold" })] : []),
    ]),
    el("RootParagraphStyleGroup", { Self: "RootParagraphStyleGroup" }, [noP, ...pstyles]),
    el("RootObjectStyleGroup", { Self: "RootObjectStyleGroup" }, [
      el("ObjectStyle", { Self: NO_OBJSTYLE, Name: "$ID/[None]", Imported: false, KeyboardShortcut: "0 0" }),
      ...[...used].sort().map((n) => el("ObjectStyle", { Self: objSelf(n), Name: n, Imported: false, KeyboardShortcut: "0 0", ...(n.startsWith("Rule") ? { StrokeWeight: n === "Rule-hair" ? 0.5 : 3 } : n === "Box-brief" ? { StrokeWeight: 1.5 } : {}) })),
    ]),
  ])]);
  files.push(["Resources/Fonts.xml", idPkgRoot("Fonts", [...fonts].sort().map((f) => el("FontFamily", { Self: `FontFamily/${f}`, Name: f })))]);
  files.push(["Resources/Graphic.xml", idPkgRoot("Graphic", [
    ...[...colors].sort().map(([hex, self]) => {
      const n = parseInt(hex.slice(1), 16);
      return el("Color", { Self: self, Model: "Process", Space: "RGB", ColorValue: `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`, ColorOverride: "Normal", BaseColor: "n", AlternateSpace: "NoAlternateColor", AlternateColorValue: "", Name: `R=${(n >> 16) & 255} G=${(n >> 8) & 255} B=${n & 255}`, ColorEditable: true, ColorRemovable: true, Visible: true, SwatchCreatorID: 7937, SwatchColorGroupReference: "n" });
    }),
    el("Color", { Self: "Color/Black", Model: "Process", Space: "CMYK", ColorValue: "0 0 0 100", ColorOverride: "Specialblack", BaseColor: "n", AlternateSpace: "NoAlternateColor", AlternateColorValue: "", Name: "Black", ColorEditable: false, ColorRemovable: false, Visible: true, SwatchCreatorID: 7937, SwatchColorGroupReference: "n" }),
    el("Swatch", { Self: "Swatch/None", Name: "None", ColorEditable: false, ColorRemovable: false, Visible: true, SwatchCreatorID: 7937 }),
  ])]);
  files.push(["Resources/Preferences.xml", idPkgRoot("Preferences", [
    el("DocumentPreference", { PageHeight: h0, PageWidth: w0, PagesPerDocument: pages.length, FacingPages: false, DocumentBleedTopOffset: 0, DocumentBleedBottomOffset: 0, DocumentBleedInsideOrLeftOffset: 0, DocumentBleedOutsideOrRightOffset: 0, PageBinding: "LeftToRight" }),
    el("ViewPreference", { HorizontalMeasurementUnits: "Millimeters", VerticalMeasurementUnits: "Millimeters", TypographicMeasurementUnits: "Points" }),
    marginPref,
  ])]);
  files.push(["XML/Tags.xml", idPkgRoot("Tags", el("XMLTag", { Self: "XMLTag/Root", Name: "Root" }, el("Properties", {}, el("TagColor", { type: "enumeration" }, "LightBlue"))))]);
  files.push(["XML/BackingStory.xml", idPkgRoot("BackingStory", el("XmlStory", { Self: "BackingStory_1", AppliedTOCStyle: "n", TrackChanges: false, StoryTitle: "$ID/", AppliedNamedGrid: "n" }, el("XMLElement", { Self: "XMLElement_Root", MarkupTag: "XMLTag/Root" })))]);

  const ref = (tag: string, src: string) => `<idPkg:${tag} src="${esc(src)}"/>`;
  const designmap = XML_DECL + `<?aid style="50" type="document" readerVersion="6.0" featureSet="257" product="${DOM_VERSION.split(".")[0]}.0(1)" ?>\n` +
    `<Document xmlns:idPkg="${IDPKG_NS}" DOMVersion="${DOM_VERSION}" Self="d" StoryList="${storyIds.join(" ")}" Name="${esc(opts.name ?? "edition")}.idml" ZeroPoint="0 0" ActiveLayer="Layer_1" CMYKProfile="U.S. Web Coated (SWOP) v2" RGBProfile="sRGB IEC61966-2.1" SolidColorIntent="UseColorSettings" AfterBlendingIntent="UseColorSettings" DefaultImageIntent="UseColorSettings" RGBPolicy="PreserveEmbeddedProfiles" CMYKPolicy="CombineValues" AccurateLABSpots="false">` +
    [
      ref("Graphic", "Resources/Graphic.xml"), ref("Fonts", "Resources/Fonts.xml"), ref("Styles", "Resources/Styles.xml"), ref("Preferences", "Resources/Preferences.xml"),
      ref("Tags", "XML/Tags.xml"),
      el("Layer", { Self: "Layer_1", Name: "Layer 1", Visible: true, Locked: false, IgnoreWrap: false, ShowGuides: true, LockGuides: false, UI: "LightBlue", Expendable: true, Printable: true }),
      ref("MasterSpread", masterFile),
      ...spreadFiles.map((s) => ref("Spread", s)),
      ref("BackingStory", "XML/BackingStory.xml"),
      ...storyFiles.map((s) => ref("Story", s)),
    ].join("") + `</Document>`;

  const container = XML_DECL + `<container version="2.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="designmap.xml" media-type="text/xml"/></rootfiles></container>`;

  const zip = new JSZip();
  const add = (name: string, data: string, store = false) =>
    zip.file(name, data, { date: FIXED_DATE, createFolders: false, unixPermissions: 0o644, compression: store ? "STORE" : "DEFLATE", compressionOptions: { level: 9 } });
  add("mimetype", IDML_MIMETYPE, true);
  add("META-INF/container.xml", container);
  add("designmap.xml", designmap);
  for (const [name, data] of files.sort((a, b) => (a[0] < b[0] ? -1 : 1))) add(name, data);
  const bytes = await zip.generateAsync({ type: "uint8array", platform: "UNIX", streamFiles: false });
  return { bytes, links: [...new Set(links)], styles: styleDefs.map((s) => s.name) };
}
