import type { Article, PageDoc } from "@epaper/core";

/**
 * ContentXML export, ported from the prototype's toCXML().
 * The prototype serialises its live DOM; here the same output is produced from the
 * parse model (the shape the prototype's parseCXML() returns), so export -> parse round-trips.
 */
export type CxmlKind = "story" | "side" | "feature" | "edit" | "ad";
export interface CxmlPara { ptype: string; text: string }
export interface CxmlImage { ctx: string; ref: string }
export interface CxmlKicker { type: string; ptype: string; text: string }
export interface CxmlStory {
  type: string; // context type, e.g. story_col_span-3-1
  kind: CxmlKind;
  /** Current column span; replaces the span-N in `type` (slot names carry the current spans). */
  span?: number;
  paras: CxmlPara[]; // first Story-head paragraph, then sub-head, then body paragraphs (any order is kept by role below)
  img: CxmlImage | null;
  kicker?: CxmlKicker | null;
}
export interface CxmlSection { id: string; type: string; stories: CxmlStory[] }
export interface CxmlModel {
  /** Attributes of the <tps:content> root, already serialised (` name="value"` pairs), as the prototype's rootAttrs. */
  rootAttrs?: string;
  sections: CxmlSection[];
}

export const DEFAULT_ROOT_ATTRS =
  ` schemaVersion="3.3" whiteSpaceMode="preserve" xmlns:tps="http://www.typefi.com/ContentXML" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.typefi.com/ContentXML http://www.typefi.com/TPS/content/3_3/ContentXML.xsd"`;

export function esc(s: unknown): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const clean = (t: string): string => t.replace(/\s+/g, " ").trim();
const paraRole = (pt: string): "head" | "sub" | "body" => (/sub[-_ ]?head/i.test(pt) ? "sub" : /head/i.test(pt) ? "head" : "body");

export function toCXML(model: CxmlModel): string {
  let o = `<?xml version="1.0" encoding="UTF-8"?>\n<tps:content${model.rootAttrs ?? DEFAULT_ROOT_ATTRS}>\n`;
  for (const sec of model.sections) {
    o += `  <tps:section${sec.id ? ` id="${esc(sec.id)}"` : ""} type="${esc(sec.type)}">\n`;
    for (const s of sec.stories) {
      let type = s.type;
      if (s.span != null && /^story_col_span-\d+-/.test(type)) type = type.replace(/span-\d+/, "span-" + s.span);
      const ref = s.img ? s.img.ref : "";
      const imgTag = ref ? `<tps:image ref="${esc(ref)}"/>` : "";
      if (s.kind === "ad") {
        o += `    <tps:context type="${esc(type)}">${imgTag}</tps:context>\n`;
        continue;
      }
      if (s.kicker && clean(s.kicker.text)) {
        o += `    <tps:context type="${esc(s.kicker.type)}"><tps:p type="${esc(s.kicker.ptype)}">${esc(clean(s.kicker.text))}</tps:p></tps:context>\n`;
      }
      const hd = s.paras.find((p) => paraRole(p.ptype) === "head" && clean(p.text));
      const sb = s.paras.find((p) => paraRole(p.ptype) === "sub" && clean(p.text));
      const body = s.paras.filter((p) => paraRole(p.ptype) === "body");
      const nested = imgTag ? (s.img!.ctx ? `<tps:context type="${esc(s.img!.ctx)}">${imgTag}</tps:context>` : imgTag) : "";
      o += `    <tps:context type="${esc(type)}">\n`;
      if (!hd && !sb && nested) o += `      ${nested}\n`;
      if (hd) o += `      <tps:p type="${esc(hd.ptype)}">${esc(clean(hd.text))}${sb ? "" : nested}</tps:p>\n`;
      if (sb) o += `      <tps:p type="${esc(sb.ptype)}">${esc(clean(sb.text))}${nested}</tps:p>\n`;
      for (const p of body) if (clean(p.text)) o += `      <tps:p type="${esc(p.ptype)}">${esc(clean(p.text))}</tps:p>\n`;
      o += `    </tps:context>\n`;
    }
    o += `  </tps:section>\n`;
  }
  return o + `</tps:content>\n`;
}

/** PageDocs (what the editor saves, D3) -> parse model, one section per page. */
export function pageDocsToModel(docs: readonly PageDoc[], articles: readonly Article[] = [], rootAttrs = DEFAULT_ROOT_ATTRS): CxmlModel {
  const fileOf = (assetId: string): string => {
    for (const a of articles) for (const im of a.images) if (im.asset_id === assetId) return im.src.split(/[?#]/)[0]!.split("/").pop() || assetId;
    return assetId;
  };
  return {
    rootAttrs,
    sections: docs.map((d) => ({
      id: String(d.page.no).padStart(3, "0"),
      type: "Main",
      stories: d.items.map((it): CxmlStory => {
        const img = it.image ? { ctx: it.kind === "ad" ? "" : "story-image", ref: fileOf(it.image.asset_id) } : null;
        if (it.kind === "ad") return { type: it.slot ?? "adverts-1", kind: "ad", paras: [], img };
        const st = it.styles ?? { head: "Story-head", sub: "Story-sub-head", body: "Story-body" };
        const tx = it.text ?? { head: "", body: [] };
        const paras: CxmlPara[] = [];
        if (tx.head) paras.push({ ptype: st.head, text: tx.head });
        if (tx.sub) paras.push({ ptype: st.sub, text: tx.sub });
        for (const b of tx.body) paras.push({ ptype: st.body, text: b });
        return {
          type: it.slot ?? "story",
          kind: it.kind,
          span: it.span,
          paras,
          img,
          // The D3 kicker has no context type of its own; "_quote" is what parseCXML recognises as a kicker.
          kicker: tx.kicker ? { type: "story_quote", ptype: "Story-quote", text: tx.kicker } : null,
        };
      }),
    })),
  };
}
