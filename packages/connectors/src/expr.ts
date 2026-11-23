import * as cheerio from "cheerio";
import type { BodyBlock, Mapping } from "@epaper/core";
import { absUrl, clean, htmlToBlocks, stripHtml, toIso } from "./util.js";
import { readableElement } from "./readable.js";

// The mapping expression language. It is data, so a site can be described without code.
//   $.title.rendered | strip_html          JSON path, then steps
//   css:h1.entry-title                     first match's text
//   css:meta[property='og:image']@content  attribute
//   css:div.entry-content p | blocks       body blocks
//   jsonld:datePublished                   from JSON-LD
//   meta:og:title                          og:/twitter:/name= meta
//   readable:                              the densest text block on the page
//   const:news                             a fixed value
//   a || b                                 first one that gives a value
// Steps: strip_html html_to_blocks blocks text trim lower first join split(',') prefix('x')
//        parse_date('UTC') map(name) abs_url

export interface EvalSource {
  json?: unknown;
  $?: cheerio.CheerioAPI;
  url?: string;
}
export interface EvalEnv {
  maps?: Record<string, Record<string, string>>;
}

type Els = { __els: cheerio.Cheerio<any>; $: cheerio.CheerioAPI };
const isEls = (v: unknown): v is Els => !!v && typeof v === "object" && "__els" in (v as object);

/** Split on a separator that is not inside quotes, brackets or parentheses. */
function splitTop(s: string, sep: "||" | "|"): string[] {
  const out: string[] = [];
  let depth = 0, q: string | null = null, cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      cur += c;
      if (c === q && s[i - 1] !== "\\") q = null;
      continue;
    }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === "[" || c === "(") depth++;
    if (c === "]" || c === ")") depth--;
    if (depth === 0 && s.startsWith(sep, i)) {
      if (sep === "|" && (s[i + 1] === "|" || s[i - 1] === "|")) { cur += c; continue; }
      out.push(cur);
      cur = "";
      i += sep.length - 1;
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

// ---- JSON path ($.a.b[0]['x-y']) ----
function jsonPath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  const re = /\.([A-Za-z_$@][\w$@-]*)|\[(\d+)\]|\['([^']*)'\]|\["([^"]*)"\]/gy;
  let rest = path.replace(/^\$/, "");
  re.lastIndex = 0;
  let pos = 0;
  while (pos < rest.length) {
    re.lastIndex = pos;
    const m = re.exec(rest);
    if (!m) return undefined;
    pos = re.lastIndex;
    if (cur == null) return undefined;
    if (m[1] !== undefined) cur = (cur as any)[m[1]];
    else if (m[2] !== undefined) cur = Array.isArray(cur) ? cur[+m[2]] : undefined;
    else cur = (cur as any)[m[3] ?? m[4]];
  }
  return cur;
}

// ---- JSON-LD ----
export function jsonLdNodes($: cheerio.CheerioAPI): any[] {
  const nodes: any[] = [];
  const add = (x: any) => {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) return x.forEach(add);
    nodes.push(x);
    if (x["@graph"]) add(x["@graph"]);
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      add(JSON.parse($(el).text()));
    } catch {
      /* broken JSON-LD is common; ignore it */
    }
  });
  return nodes;
}
const ARTICLE_TYPE = /(Article|BlogPosting|Report|NewsArticle)$/;
function articleNode(nodes: any[]): any | undefined {
  const t = (n: any) => [n["@type"]].flat().filter(Boolean).map(String);
  return nodes.find((n) => t(n).some((x) => ARTICLE_TYPE.test(x))) ?? undefined;
}
function jsonLd($: cheerio.CheerioAPI, path: string): unknown {
  const nodes = jsonLdNodes($);
  const node = articleNode(nodes);
  const get = (n: any) => path.split(".").reduce((a: any, k) => (a == null ? undefined : Array.isArray(a) ? a[0]?.[k] : a[k]), n);
  let v = node ? get(node) : undefined;
  if (v == null) for (const n of nodes) if ((v = get(n)) != null) break;
  return v;
}

function metaValue($: cheerio.CheerioAPI, name: string): string | undefined {
  const sels = [`meta[property="${name}"]`, `meta[name="${name}"]`, `meta[itemprop="${name}"]`];
  for (const s of sels) {
    const v = $(s).first().attr("content");
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

function splitAttr(sel: string): { sel: string; attr?: string } {
  // the last @ outside brackets
  let depth = 0;
  for (let i = sel.length - 1; i >= 0; i--) {
    const c = sel[i];
    if (c === "]") depth++;
    else if (c === "[") depth--;
    else if (c === "@" && depth === 0) return { sel: sel.slice(0, i), attr: sel.slice(i + 1) };
  }
  return { sel };
}

function head(h: string, src: EvalSource): unknown {
  if (h.startsWith("$")) return src.json === undefined ? undefined : jsonPath(src.json, h);
  if (h.startsWith("const:")) return h.slice(6);
  if (!src.$) return undefined;
  const $ = src.$;
  if (h.startsWith("css:")) {
    const { sel, attr } = splitAttr(h.slice(4).trim());
    let els: cheerio.Cheerio<any>;
    try {
      els = $(sel);
    } catch {
      return undefined;
    }
    if (!els.length) return undefined;
    if (attr) {
      const v = els.first().attr(attr);
      return v == null || v === "" ? undefined : v;
    }
    return { __els: els, $ } as Els;
  }
  if (h.startsWith("jsonld:")) return jsonLd($, h.slice(7).trim());
  if (h.startsWith("meta:")) return metaValue($, h.slice(5).trim());
  if (h.startsWith("readable:")) {
    const el = readableElement($);
    return el ? ({ __els: $(el), $ } as Els) : undefined;
  }
  throw new Error(`I do not understand "${h}" in a mapping. Start it with $, css:, jsonld:, meta:, readable: or const:.`);
}

const BOILER = "script,style,nav,aside,form,figure,figcaption,iframe,noscript,[class*=share],[class*=social],[class*=related],[class*=comment],[class*=newsletter],[class*=advert],[class*=promo],[class*=subscribe],[id*=comment],[id*=related]";

export function elsToBlocks(e: Els): BodyBlock[] {
  const parts: string[] = [];
  e.__els.each((_, el) => {
    const copy = e.$(el).clone();
    copy.find(BOILER).remove();
    parts.push(e.$.html(copy) ?? "");
  });
  return htmlToBlocks(parts.join("\n"));
}

function asText(v: unknown): string {
  if (v == null) return "";
  if (isEls(v)) return clean(v.__els.first().text());
  if (typeof v === "string") return clean(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return asText(v[0]);
  if (typeof v === "object") {
    const o = v as any;
    return asText(o.name ?? o.url ?? o["@id"] ?? o.text ?? "");
  }
  return "";
}

function arg(step: string): string | undefined {
  const m = /^[a-z_]+\((.*)\)$/s.exec(step);
  if (!m) return undefined;
  return m[1].trim().replace(/^(['"])(.*)\1$/s, "$2");
}

function step(v: unknown, st: string, src: EvalSource, env: EvalEnv): unknown {
  const name = st.replace(/\(.*$/s, "").trim();
  switch (name) {
    case "strip_html": return typeof v === "string" ? stripHtml(v) : isEls(v) ? clean(v.__els.text()) : v;
    case "html_to_blocks":
    case "blocks":
      if (isEls(v)) return elsToBlocks(v);
      if (typeof v === "string") return htmlToBlocks(v);
      return v;
    case "text": return isEls(v) ? clean(v.__els.text()) : asText(v);
    case "trim": return asText(v);
    case "lower": return asText(v).toLowerCase();
    case "first": return Array.isArray(v) ? v[0] : v;
    case "join": return Array.isArray(v) ? v.map(asText).join(arg(st) ?? " ") : v;
    case "split": return asText(v).split(arg(st) ?? ",").map((x) => x.trim()).filter(Boolean);
    case "prefix": return v == null || v === "" ? v : (arg(st) ?? "") + asText(v);
    case "parse_date": return toIso(asText(v), (arg(st) ?? "UTC").toUpperCase() === "UTC");
    case "abs_url": return absUrl(asText(v), src.url ?? "http://invalid.invalid/");
    case "map": {
      const table = env.maps?.[arg(st) ?? ""];
      const key = asText(v);
      return table ? (table[key] ?? key) : v;
    }
    default:
      throw new Error(`I do not know the step "${st}" in a mapping.`);
  }
}

const empty = (v: unknown) =>
  v == null || v === "" || (Array.isArray(v) && v.length === 0) || (isEls(v) && v.__els.length === 0);

export function evalExpr(expr: string, src: EvalSource, env: EvalEnv = {}): unknown {
  for (const alt of splitTop(expr, "||")) {
    const [h, ...steps] = splitTop(alt, "|");
    let v = head(h, src);
    for (const st of steps) {
      if (empty(v)) break;
      v = step(v, st, src, env);
    }
    if (isEls(v) && !steps.length) v = v; // keep as elements; coerced per field later
    if (!empty(v)) {
      // a blocks result with no text is not a value
      if (Array.isArray(v) && v.length && typeof v[0] === "object" && v[0] && "t" in (v[0] as object) && v.every((b: any) => !String(b?.text ?? "").trim())) continue;
      if (typeof v === "string" && !v.trim()) continue;
      return v;
    }
  }
  return undefined;
}

// ---- applying a whole mapping to one source ----

export interface Partial1 {
  [k: string]: unknown;
  images?: { src?: string; caption?: string; credit?: string; role?: string }[];
}

const SCALARS = ["external_id", "url", "lang", "script", "section", "kicker", "headline", "subhead", "byline", "dateline"];

export function applyMapping(mapping: Mapping, src: EvalSource, env: EvalEnv = {}): Partial1 {
  const out: Partial1 = {};
  const images: NonNullable<Partial1["images"]> = [];
  for (const [field, expr] of Object.entries(mapping)) {
    const v = evalExpr(expr, src, env);
    if (v === undefined) continue;
    const im = /^images\[(\d+)\]\.(\w+)$/.exec(field);
    if (im) {
      const i = +im[1];
      images[i] ??= {};
      let t = asText(v);
      if (im[2] === "src") t = absUrl(t, src.url ?? "http://invalid.invalid/") ?? "";
      if (t) (images[i] as any)[im[2]] = t;
      continue;
    }
    if (field === "body") {
      out.body = isEls(v) ? elsToBlocks(v) : Array.isArray(v) ? v : typeof v === "string" ? htmlToBlocks(v) : [];
    } else if (field === "tags") {
      out.tags = Array.isArray(v) ? v.map(asText).filter(Boolean) : asText(v).split(",").map((x) => x.trim()).filter(Boolean);
    } else if (field === "priority") {
      const n = Number(asText(v));
      if (Number.isFinite(n)) out.priority = Math.round(n);
    } else if (field === "published_at" || field === "updated_at") {
      const t = typeof v === "string" && /^\d{4}-\d\d-\d\dT.*(Z|[+-]\d\d:\d\d)$/.test(v) ? v : toIso(asText(v));
      if (t) out[field] = t;
    } else if (SCALARS.includes(field)) {
      const t = asText(v);
      if (t) out[field] = t;
    } else {
      out[field] = v;
    }
  }
  const imgs = images.filter((x) => x && x.src);
  if (imgs.length) out.images = imgs.map((x, i) => ({ role: i === 0 ? "lead" : "inline", ...x }));
  return out;
}
