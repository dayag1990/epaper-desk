import { run } from "./util.js";
import type { TextLine, TextPage } from "./types.js";

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

/** pdftotext may split one visual line across blocks: rejoin pieces on the same baseline that touch. */
function mergeAdjacent(lines: TextLine[]): TextLine[] {
  const sorted = [...lines].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const out: TextLine[] = [];
  for (const l of sorted) {
    const hl = l.y1 - l.y0;
    const left = out.find((o) => {
      const ho = o.y1 - o.y0;
      return Math.abs(o.y0 - l.y0) < 2 && Math.abs(ho - hl) <= 0.2 * Math.max(ho, hl) && l.x0 >= o.x1 - 1 && l.x0 - o.x1 <= 0.7 * Math.min(ho, hl);
    });
    if (left) { left.text += " " + l.text; left.x1 = Math.max(left.x1, l.x1); left.y1 = Math.max(left.y1, l.y1); }
    else out.push({ ...l });
  }
  return out;
}

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
      const words = [...lm[5].matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/word>/g)]
        .map((w) => ({ x0: +w[1], y0: +w[2], x1: +w[3], y1: +w[4], t: decode(w[5]) }));
      // pdftotext joins text across a column gap into one line: cut where the gap is far wider than a word space.
      let cur: typeof words = [];
      const flush = () => {
        const text = cur.map((w) => w.t).join(" ").trim();
        if (text) lines.push({ x0: cur[0].x0, y0: Math.min(...cur.map((w) => w.y0)), x1: cur[cur.length - 1].x1, y1: Math.max(...cur.map((w) => w.y1)), text });
        cur = [];
      };
      for (const w of words) {
        const prev = cur[cur.length - 1];
        if (prev) {
          const hp = prev.y1 - prev.y0, hw = w.y1 - w.y0;
          // cut at a gap much wider than a word space, or where the type size changes (a neighbouring headline)
          const big = Math.min(hp, hw) >= 16; // headline-size type; justified body text has wide gaps that are not columns
          if (w.x0 - prev.x1 > (big ? 0.7 : 4) * Math.min(hp, hw) || Math.abs(hp - hw) > 0.2 * Math.max(hp, hw)) flush();
        }
        cur.push(w);
      }
      flush();
    }
    pages.push({ page: no++, w: +pm[1], h: +pm[2], lines: mergeAdjacent(lines) });
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
