// PDF text reading and line matching for the Tamil proof (pdftotext / pdffonts from poppler-utils). No project imports except types.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DomLine } from "../../../packages/layout/dist/index.js";

export interface PdfWord { page: number; text: string; x0: number; y0: number; x1: number; y1: number }
const ent = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, "&");
/** pdftotext -bbox-layout: every word with its box in pt, page top-left origin. */
export function pdfWords(pdf: Uint8Array): PdfWord[] {
  const dir = mkdtempSync(join(tmpdir(), "tapdf-"));
  try {
    writeFileSync(join(dir, "a.pdf"), pdf);
    const xml = execFileSync("pdftotext", ["-bbox-layout", join(dir, "a.pdf"), "-"], { encoding: "utf8", maxBuffer: 1 << 28 });
    const out: PdfWord[] = [];
    let page = 0;
    for (const m of xml.matchAll(/<page [^>]*>|<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)) {
      if (m[0].startsWith("<page")) { page++; continue; }
      out.push({ page, text: ent(m[5]!), x0: +m[1]!, y0: +m[2]!, x1: +m[3]!, y1: +m[4]! });
    }
    return out;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
export function pdfFonts(pdf: Uint8Array): { name: string; type: string; emb: boolean }[] {
  const dir = mkdtempSync(join(tmpdir(), "tapdf-"));
  try {
    writeFileSync(join(dir, "a.pdf"), pdf);
    const txt = execFileSync("pdffonts", [join(dir, "a.pdf")], { encoding: "utf8" });
    return txt.split("\n").slice(2).filter(Boolean).map((l) => { const c = l.trim().split(/\s+/); const i = c.findIndex((x) => x === "yes" || x === "no"); return { name: c[0]!, type: c.slice(1, i - 1).join(" "), emb: c[i] === "yes" }; });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export const squash = (s: string) => s.normalize("NFC").replace(/\s+/g, "");
/** A line must never start with a combining mark (vowel sign, pulli/virama, anusvara...) or a joiner. */
export const badStart = (line: string) => /^[\p{M}‌‍]/u.test(line);

export interface Matched { line: DomLine; pdf: string; words: number }
/** Put every PDF word of one page into the DOM line it sits on (same canvas, scaled to pt by `k`). */
export function matchPage(lines: readonly DomLine[], ws: readonly PdfWord[], k: number): { matched: Matched[]; stray: PdfWord[] } {
  const m = lines.map((line) => ({ line, got: [] as PdfWord[] }));
  const stray: PdfWord[] = [];
  for (const w of ws) {
    const cx = (w.x0 + w.x1) / 2, cy = (w.y0 + w.y1) / 2;
    let best = -1, bd = Infinity;
    m.forEach((c, i) => {
      if (cx < c.line.x0 * k - 4 || cx > c.line.x1 * k + 4) return;
      const d = Math.abs(cy - ((c.line.y0 + c.line.y1) / 2) * k);
      if (d < bd) { bd = d; best = i; }
    });
    if (best < 0 || bd > 0.9 * ((m[best]!.line.y1 - m[best]!.line.y0) * k)) stray.push(w); else m[best]!.got.push(w);
  }
  return { matched: m.map((c) => ({ line: c.line, pdf: c.got.sort((a, b) => a.x0 - b.x0).map((w) => w.text).join(" "), words: c.got.length })), stray };
}
