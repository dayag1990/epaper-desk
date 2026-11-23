import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import type { BodyBlock } from "@epaper/core";

/** All text we keep is Unicode NFC, so Punjabi compares and hashes the same everywhere. */
export const nfc = (s: string): string => s.normalize("NFC");
export const clean = (t: string): string => nfc(t.replace(/\s+/g, " ").trim());

export function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export function decodeEntities(s: string): string {
  return cheerio.load(`<body>${s}</body>`, null, false).root().text();
}

export function stripHtml(html: string): string {
  const $ = cheerio.load(`<div id="__r">${html}</div>`, null, false);
  $("script,style").remove();
  return clean($("#__r").text());
}

/** Turn a piece of HTML into p / h / quote blocks. */
export function htmlToBlocks(html: string): BodyBlock[] {
  const $ = cheerio.load(`<div id="__r">${html}</div>`, null, false);
  $("script,style,figure,figcaption,aside,nav,form,iframe,noscript").remove();
  const out: BodyBlock[] = [];
  const root = $("#__r");
  const push = (t: BodyBlock["t"], text: string) => {
    const c = clean(text);
    if (c) out.push({ t, text: c });
  };
  const walk = (el: cheerio.Cheerio<any>) => {
    el.contents().each((_, n: any) => {
      if (n.type === "text") {
        const c = clean($(n).text());
        if (c) push("p", c);
        return;
      }
      if (n.type !== "tag") return;
      const tag = String(n.name).toLowerCase();
      if (tag === "p") push("p", $(n).text());
      else if (/^h[1-6]$/.test(tag)) push("h", $(n).text());
      else if (tag === "blockquote") push("quote", $(n).text());
      else if (tag === "li") push("p", $(n).text());
      else if (tag === "br" || tag === "img" || tag === "hr") return;
      else if (["div", "section", "article", "main", "ul", "ol", "span", "a", "em", "strong", "b", "i"].includes(tag)) {
        // a block container with direct text and no block children is one paragraph
        const hasBlock = $(n).find("p,h1,h2,h3,h4,h5,h6,blockquote,li,div").length > 0;
        if (hasBlock || ["ul", "ol"].includes(tag)) walk($(n));
        else push("p", $(n).text());
      } else push("p", $(n).text());
    });
  };
  walk(root);
  return out;
}

export function absUrl(href: string | undefined | null, base: string): string | undefined {
  if (!href) return undefined;
  try {
    const u = new URL(href.trim(), base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    u.hash = "";
    return u.toString();
  } catch {
    return undefined;
  }
}

/** Parse a date in any common feed or HTML form to ISO with an offset. Undefined if it is not a date. */
export function toIso(input: unknown, assumeUtc = true): string | undefined {
  if (input == null) return undefined;
  const s = String(input).trim();
  if (!s) return undefined;
  let str = s;
  // "2026-04-02T10:15:00" with no zone: treat as UTC (or as given)
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(str)) str = str.replace(" ", "T") + (assumeUtc ? "Z" : "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) str += "T00:00:00Z";
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return undefined;
  // keep the original offset when there is one
  const m = /([+-]\d{2}:?\d{2})$/.exec(str);
  if (m && /^\d{4}-/.test(str)) {
    const off = m[1].includes(":") ? m[1] : m[1].slice(0, 3) + ":" + m[1].slice(3);
    const local = str.slice(0, str.length - m[1].length).replace(/\.\d+$/, "");
    const test = new Date(local + off);
    if (!Number.isNaN(test.getTime())) return local + off;
  }
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Pick the script name from the text itself (ISO 15924). */
export function detectScript(text: string): { lang: string; script: string } {
  const counts: Record<string, number> = {};
  const ranges: [string, RegExp][] = [
    ["Guru", /[਀-੿]/g],
    ["Deva", /[ऀ-ॿ]/g],
    ["Arab", /[؀-ۿ]/g],
    ["Latn", /[A-Za-z]/g],
  ];
  for (const [name, re] of ranges) counts[name] = (text.match(re) ?? []).length;
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const script = best && best[1] > 0 ? best[0] : "Latn";
  const lang = { Guru: "pa", Deva: "hi", Arab: "ur", Latn: "en" }[script] ?? "en";
  return { lang, script };
}

export function stableAssetId(src: string): `ast_${string}` {
  return `ast_${sha256(src).slice(0, 20).toUpperCase()}`;
}
