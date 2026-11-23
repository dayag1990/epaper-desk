import { readFile } from "node:fs/promises";
import { DOMParser } from "@xmldom/xmldom";
import { z } from "zod";
import type { Connector, Mapping, RawItem } from "@epaper/core";
import type { Adapter, ArticleDraft, IngestContext } from "./types.js";
import { RejectError } from "./types.js";
import { clean, detectScript, stableAssetId } from "./util.js";

// Typefi ContentXML. parseCXML and toCXML are ported from epaper-desk-prototype.html.
// The logic is the same; only the DOM walking changed (xmldom has no .children) and
// output is a plain model instead of live page elements.

export interface CxmlImage { ctx: string; ref: string }
export interface CxmlPara { ptype: string; text: string }
export interface CxmlStory {
  type: string;
  kind: "story" | "ad" | "side" | "feature" | "edit";
  paras: CxmlPara[];
  img: CxmlImage | null;
  kicker?: { type: string; ptype: string; text: string } | null;
}
export interface CxmlSection { id: string; type: string; stories: CxmlStory[] }
export interface CxmlDoc { rootAttrs: string; sections: CxmlSection[] }

const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const role = (pt: string) => (/sub[-_ ]?head/i.test(pt) ? "sub" : /head/i.test(pt) ? "head" : "body");
const kindOf = (t: string): CxmlStory["kind"] =>
  /^advert/i.test(t) ? "ad" : /sidebar/i.test(t) ? "side" : /^feature/i.test(t) ? "feature" : /^editorial/i.test(t) ? "edit" : "story";

const kids = (el: any, name: string): any[] => {
  const out: any[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 && n.localName === name) out.push(n);
  return out;
};

export function parseCXML(text: string): CxmlDoc {
  const problems: string[] = [];
  let doc: any;
  try {
    doc = new DOMParser({
      onError: (level: string, msg: string) => {
        if (level !== "warning") problems.push(msg);
      },
    }).parseFromString(text, "application/xml");
  } catch (e) {
    problems.push((e as Error).message);
  }
  if (problems.length || !doc || !doc.documentElement) throw new RejectError("XML is not well-formed" + (problems[0] ? " (" + problems[0].split("\n")[0] + ")" : ""));
  const root: any = doc.documentElement;
  if (root.localName !== "content") throw new RejectError("Not a ContentXML file (root is <" + root.nodeName + ">)");
  const rootAttrs = Array.from(root.attributes as ArrayLike<any>).map((a: any) => ` ${a.name}="${esc(a.value)}"`).join("");
  const secs = kids(root, "section");
  if (!secs.length) throw new RejectError("No <section> found");
  const sections = secs.map((sec): CxmlSection => {
    const stories: CxmlStory[] = [];
    let pend: { type: string; ptype: string; text: string } | null = null;
    for (const ctx of kids(sec, "context")) {
      const type = ctx.getAttribute("type") || "";
      const ps = kids(ctx, "p"), direct = kids(ctx, "image");
      if (!ps.length) {
        stories.push({ type, kind: "ad", paras: [], img: direct[0] ? { ctx: "", ref: direct[0].getAttribute("ref") || "" } : null });
        continue;
      }
      let img: CxmlImage | null = direct[0] ? { ctx: "", ref: direct[0].getAttribute("ref") || "" } : null;
      const paras = ps.map((p: any): CxmlPara => {
        let t = "";
        for (let n = p.firstChild; n; n = n.nextSibling) {
          if (n.nodeType === 3 || n.nodeType === 4) t += n.nodeValue;
          else if (n.nodeType === 1) {
            if (n.localName === "context" || n.localName === "image") {
              const im = n.localName === "image" ? n : n.getElementsByTagNameNS("*", "image")[0];
              if (im && !img) img = { ctx: n.localName === "context" ? n.getAttribute("type") || "" : "", ref: im.getAttribute("ref") || "" };
            } else t += n.textContent;
          }
        }
        return { ptype: p.getAttribute("type") || "", text: clean(t) };
      });
      if (paras.length === 1 && /quote/i.test(type)) {
        pend = { type, ptype: paras[0].ptype, text: paras[0].text };
        continue;
      }
      stories.push({ type, kind: kindOf(type), paras, img, kicker: pend });
      pend = null;
    }
    if (pend) stories.push({ type: pend.type, kind: "story", paras: [{ ptype: pend.ptype, text: pend.text }], img: null });
    return { id: sec.getAttribute("id") || "", type: sec.getAttribute("type") || "", stories };
  });
  return { rootAttrs, sections };
}

/** Write the model back out as ContentXML. Re-parsing the result gives the same model. */
export function toCXML(doc: CxmlDoc): string {
  let o = `<?xml version="1.0" encoding="UTF-8"?>\n<tps:content${doc.rootAttrs}>\n`;
  for (const sec of doc.sections) {
    o += `  <tps:section${sec.id ? ` id="${esc(sec.id)}"` : ""} type="${esc(sec.type)}">\n`;
    for (const s of sec.stories) {
      const ref = s.img?.ref ?? "";
      const imgTag = ref ? `<tps:image ref="${esc(ref)}"/>` : "";
      const nested = imgTag ? (s.img!.ctx ? `<tps:context type="${esc(s.img!.ctx)}">${imgTag}</tps:context>` : imgTag) : "";
      if (s.kind === "ad") {
        o += `    <tps:context type="${esc(s.type)}">${imgTag}</tps:context>\n`;
        continue;
      }
      if (s.kicker && s.kicker.text)
        o += `    <tps:context type="${esc(s.kicker.type)}"><tps:p type="${esc(s.kicker.ptype)}">${esc(s.kicker.text)}</tps:p></tps:context>\n`;
      // the picture rides inside the last head/sub paragraph, as the prototype does
      let carrier = -1;
      s.paras.forEach((p, i) => { if (role(p.ptype) !== "body") carrier = i; });
      o += `    <tps:context type="${esc(s.type)}">\n`;
      if (carrier < 0 && nested) o += `      ${nested}\n`;
      s.paras.forEach((p, i) => {
        o += `      <tps:p type="${esc(p.ptype)}">${esc(p.text)}${i === carrier ? nested : ""}</tps:p>\n`;
      });
      o += `    </tps:context>\n`;
    }
    o += `  </tps:section>\n`;
  }
  return o + `</tps:content>\n`;
}

// ---- the connector ----

export const CxmlConfigSchema = z
  .object({
    /** path of a .cxml file on disk */
    path: z.string().optional(),
    /** or the XML text itself */
    xml: z.string().optional(),
    /** prefix for image refs, to make image src URLs */
    image_base: z.string().default("cxml://images/"),
    /** prefix for story URLs (the tap target) */
    url_base: z.string().default("cxml://stories/"),
  })
  .refine((c) => !!c.path || !!c.xml, { message: "give either a file path or the XML text" });
export type CxmlConfig = z.infer<typeof CxmlConfigSchema>;

export interface CxmlRef { section: number; story: number; externalId: string }
export interface CxmlRaw { sectionId: string; sectionType: string; story: CxmlStory; index: number; externalId: string; imageBase: string; urlBase: string }

async function loadDoc(cfg: CxmlConfig): Promise<CxmlDoc> {
  const text = cfg.xml ?? (await readFile(cfg.path!, "utf8"));
  return parseCXML(text.replace(/^﻿/, ""));
}

const cache = new WeakMap<object, Promise<CxmlDoc>>();
const docFor = (cfg: CxmlConfig) => {
  let p = cache.get(cfg);
  if (!p) cache.set(cfg, (p = loadDoc(cfg)));
  return p;
};

export function cxmlExternalId(sec: CxmlSection, secIdx: number, storyIdx: number): string {
  // some sections carry no id (the sample's second page): fall back to its type, then its position
  return `cxml:${sec.id || sec.type || "s" + secIdx}:${storyIdx + 1}`;
}

export const cxmlConnector: Adapter<CxmlConfig> & Connector<CxmlConfig> = {
  kind: "cxml",
  configSchema: CxmlConfigSchema as unknown as z.ZodType<CxmlConfig>,
  async *discover(cfg) {
    const doc = await loadDoc(cfg);
    cache.set(cfg, Promise.resolve(doc));
    for (const [si, sec] of doc.sections.entries())
      for (const [i] of sec.stories.entries()) yield { section: si, story: i, externalId: cxmlExternalId(sec, si, i) } satisfies CxmlRef;
  },
  async fetch(cfg, ref): Promise<RawItem> {
    const r = ref as CxmlRef;
    const doc = await docFor(cfg);
    const sec = doc.sections[r.section];
    const story = sec?.stories[r.story];
    if (!story) throw new RejectError("That story is no longer in the file.");
    const data: CxmlRaw = { sectionId: sec.id, sectionType: sec.type, story, index: r.story, externalId: r.externalId, imageBase: cfg.image_base, urlBase: cfg.url_base };
    return { ref, format: "xml", data, fetchedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") };
  },
  defaultMapping: undefined,
  normalize(raw: RawItem, _mapping: Mapping | undefined, ctx: IngestContext): ArticleDraft | null {
    const d = raw.data as CxmlRaw;
    const s = d.story;
    if (s.kind === "ad") return null; // adverts are not articles; they go to the ad lane
    return cxmlToDraft(d, { image_base: d.imageBase, url_base: d.urlBase }, ctx, raw.fetchedAt);
  },
};

export function cxmlToDraft(
  d: CxmlRaw,
  cfg: { image_base: string; url_base: string },
  ctx: IngestContext,
  fetchedAt: string,
): ArticleDraft {
  const s = d.story;
  const heads = s.paras.filter((p) => role(p.ptype) === "head");
  const subs = s.paras.filter((p) => role(p.ptype) === "sub");
  const bodies = s.paras.filter((p) => role(p.ptype) === "body" && p.text);
  // an editorial has no head of its own: its label (the quote context) stands in as the headline
  const headline = heads.map((p) => p.text).join(" ") || (s.kind === "edit" ? s.kicker?.text ?? "" : "");
  if (!headline) throw new RejectError("This story has no headline.");
  const all = s.paras.map((p) => p.text).join(" ");
  const { lang, script } = detectScript(all);
  const span = /span[-_](\d+)/i.exec(s.type);
  const order = /span[-_]\d+[-_](\d+)/i.exec(s.type);
  const spanN = span ? Math.min(8, Math.max(1, +span[1])) : { ad: 8, side: 2, feature: 6, edit: 8, story: 3 }[s.kind];
  const secName = (d.sectionType || d.sectionId || "main").toLowerCase();
  const images = s.img?.ref
    ? [{ asset_id: stableAssetId(d.externalId + "|" + s.img.ref), role: "lead", src: cfg.image_base + s.img.ref, caption: null, credit: null }]
    : [];
  return {
    external_id: d.externalId,
    url: cfg.url_base + encodeURIComponent(d.externalId),
    lang,
    script,
    section: secName,
    tags: [],
    priority: 50,
    kicker: s.kicker?.text || null,
    headline,
    subhead: subs.length ? subs.map((p) => p.text).join(" ") : null,
    byline: null,
    dateline: null,
    body: bodies.map((p) => ({ t: /quote/i.test(p.ptype) ? ("quote" as const) : ("p" as const), text: p.text })),
    images,
    layout_hint: { page: d.sectionType || d.sectionId || "Main", slot: s.type, span: spanN, order: order ? +order[1] : d.index + 1 },
    published_at: fetchedAt,
    updated_at: fetchedAt,
  };
}

/** Counts for the done_when check: pages, stories, adverts, image refs. */
export function summariseCxml(doc: CxmlDoc) {
  let stories = 0, adverts = 0, imageRefs = 0;
  for (const sec of doc.sections)
    for (const s of sec.stories) {
      if (s.kind === "ad") adverts++;
      else stories++;
      if (s.img?.ref) imageRefs++;
    }
  return { pages: doc.sections.length, stories, adverts, imageRefs };
}
