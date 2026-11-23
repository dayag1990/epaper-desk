import { run } from "./util.js";
import type { TextLine, TextPage } from "./types.js";

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

/** Parse `pdftotext -bbox-layout` output (lines with their words). Pure. */
export function parseBboxLayout(xml: string, firstPage = 1): TextPage[] {
  const pages: TextPage[] = [];
  const pageRe = /<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g;
  let pm: RegExpExecArray | null;
  let no = firstPage;
  while ((pm = pageRe.exec(xml))) {
    const lines: TextLine[] = [];
    const lineRe = /<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/line>/g;
    let lm: RegExpExecArray | null;
    while ((lm = lineRe.exec(pm[3]))) {
      const words = [...lm[5].matchAll(/<word [^>]*>([\s\S]*?)<\/word>/g)].map((w) => decode(w[1]));
      const text = words.join(" ").trim();
      if (text) lines.push({ x0: +lm[1], y0: +lm[2], x1: +lm[3], y1: +lm[4], text });
    }
    pages.push({ page: no++, w: +pm[1], h: +pm[2], lines });
  }
  return pages;
}

export async function extractTextLayer(pdfPath: string, page: number): Promise<TextPage> {
  const xml = (await run("pdftotext", ["-f", String(page), "-l", String(page), "-bbox-layout", pdfPath, "-"])) as string;
  const p = parseBboxLayout(xml, page)[0];
  if (!p) throw new Error(`pdftotext returned no page ${page}`);
  return p;
}

/** Legacy-font PDFs give private-use or replacement glyphs, or nothing. */
export function isReadable(p: TextPage): boolean {
  const text = p.lines.map((l) => l.text).join(" ");
  const letters = (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
  if (letters < 20) return false;
  const bad = (text.match(/[-�]/g) ?? []).length;
  return bad / Math.max(1, text.length) < 0.05;
}
