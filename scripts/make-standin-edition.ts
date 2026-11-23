/**
 * Rebuilds fixtures/edition-24p.pdf: a 24-page, 330x530 mm broadsheet stand-in edition
 * ("The Riverton Herald") with a real text layer, made with Playwright Chromium from
 * fixtures/english-15.json. Articles repeat to fill 24 pages.
 *
 * Needs Chromium. On this server run it inside the pinned Playwright image:
 *   scripts/make-standin-edition.sh        (wraps docker, see that file)
 * or, with a local Chromium:  pnpm exec tsx scripts/make-standin-edition.ts
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(root, 'fixtures/english-15.json'), 'utf8'));
const arts: any[] = data.articles;
const PAGES = 24;
const PW = 330, PH = 530, MARGIN = 12, GAP = 6;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function imgData(a: any): string | null {
  const im = a.images[0];
  if (!im) return null;
  const f = join(root, 'fixtures/demo-site/img', im.src.split('/').pop());
  return existsSync(f) ? 'data:image/jpeg;base64,' + readFileSync(f).toString('base64') : null;
}

// templates: grid of 3 cols; each box = [col, colSpan, row, rowSpan]; rows = number of rows
type Box = [number, number, number, number];
const TEMPLATES: { rows: number; boxes: Box[] }[] = [
  { rows: 2, boxes: [[1, 2, 1, 1], [3, 1, 1, 2], [1, 1, 2, 1], [2, 1, 2, 1]] },           // 4 stories
  { rows: 1, boxes: [[1, 1, 1, 1], [2, 1, 1, 1], [3, 1, 1, 1]] },                          // 3 stories
  { rows: 2, boxes: [[1, 1, 1, 1], [2, 1, 1, 1], [3, 1, 1, 1], [1, 2, 2, 1], [3, 1, 2, 1]] }, // 5 stories
  { rows: 2, boxes: [[1, 1, 1, 2], [2, 2, 1, 1], [2, 1, 2, 1], [3, 1, 2, 1]] },           // 4 stories
];

function budgetText(a: any, words: number): string {
  let left = words, out: string[] = [];
  for (const b of a.body) {
    if (left <= 0) break;
    const n = b.text.split(/\s+/).length;
    let t = b.text;
    if (n > left && out.length) {
      const sentences: string[] = t.match(/[^.!?]+[.!?]+\s*/g) ?? [t];
      let acc = '', c = 0;
      for (const s of sentences) { const k = s.split(/\s+/).length; if (c + k > left && acc) break; acc += s; c += k; }
      t = acc.trim(); left = 0;
    } else left -= n;
    out.push(b.t === 'h' ? `<h3>${esc(t)}</h3>` : b.t === 'quote' ? `<blockquote>${esc(t)}</blockquote>` : `<p>${esc(t)}</p>`);
  }
  return out.join('');
}

function pageHtml(n: number): string {
  const tpl = TEMPLATES[(n * 7 + (n >> 1)) % TEMPLATES.length];
  const first = n === 1;
  const headerH = first ? 62 : 20, footerH = 10;
  const availH = PH - 2 * MARGIN - headerH - footerH - 4;
  const colW = (PW - 2 * MARGIN - 2 * GAP) / 3, rowH = (availH - (tpl.rows - 1) * GAP) / tpl.rows;
  const start = (n - 1) * 4 + (n > 15 ? 1 : 0);
  const section = arts[start % arts.length].section.toUpperCase();
  const boxes = tpl.boxes.map(([c, cs, r, rs], k) => {
    const a = arts[(start + k) % arts.length];
    const w = cs * colW + (cs - 1) * GAP, h = rs * rowH + (rs - 1) * GAP;
    const img = imgData(a);
    const imgH = img ? (cs > 1 ? 95 : 70) : 0;
    const wide = cs > 1 || k === 0;
    const headSize = wide ? 30 : 21;
    const overhead = (headSize * 0.5 * (wide ? 2 : 3) + 10 + (a.subhead ? 14 : 0) + imgH + 8) ;
    const words = Math.max(25, Math.floor(((h - overhead) * w) / 75 * 0.68));
    return `<article style="grid-column:${c}/span ${cs};grid-row:${r}/span ${rs}">
${a.kicker ? `<div class="kicker">${esc(a.kicker)}</div>` : ''}<h2 style="font-size:${headSize}pt">${esc(a.headline)}</h2>
<div class="sub">${esc(a.subhead)}</div><div class="by">${esc(a.byline)} &middot; ${esc(a.dateline)}</div>
${img ? `<figure><img src="${img}" style="height:${imgH}mm"><figcaption>${esc(a.images[0].caption)}</figcaption></figure>` : ''}
<div class="txt" style="column-count:${cs}">${budgetText(a, words)}</div></article>`;
  });
  const head = first
    ? `<div class="mast"><div class="mtop"><span>Stand-in edition</span><span>Monday 23 November 2026</span><span>Price £1.20</span></div><h1>The Riverton Herald</h1><div class="mtag">Riverton's newspaper since 1874 &middot; fictional demo edition</div></div>`
    : `<div class="run"><span class="rn">The Riverton Herald</span><span>${section}</span><span>Monday 23 November 2026</span></div>`;
  return `<section class="page">${head}<div class="grid" style="height:${availH}mm;grid-template-rows:repeat(${tpl.rows},${rowH}mm)">${boxes.join('')}</div>
<footer><span>The Riverton Herald</span><span>Page ${n}</span></footer></section>`;
}

const css = `@page{size:${PW}mm ${PH}mm;margin:0}*{box-sizing:border-box}body{margin:0;font-family:'Liberation Serif','Times New Roman',serif;color:#111}
.page{width:${PW}mm;height:${PH}mm;padding:${MARGIN}mm;position:relative;page-break-after:always;overflow:hidden;background:#fff}
.mast{height:62mm;border-bottom:1.2mm double #111;text-align:center}.mast h1{font-size:68pt;margin:2mm 0 0;font-weight:700;letter-spacing:1px}
.mtop{display:flex;justify-content:space-between;font:9pt sans-serif;border-bottom:.3mm solid #111;padding-bottom:1.5mm}.mtag{font:italic 11pt serif;margin-top:1mm}
.run{height:20mm;display:flex;justify-content:space-between;align-items:baseline;border-bottom:.8mm solid #111;font:9pt sans-serif;letter-spacing:1px}.run .rn{font:700 22pt serif;letter-spacing:0}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:${GAP}mm;margin-top:3mm}
.grid article{overflow:hidden;border-top:.5mm solid #111;padding-top:2mm;column-rule:none}
.kicker{font:700 8pt sans-serif;text-transform:uppercase;color:#a33;letter-spacing:1px}h2{margin:1mm 0 1mm;line-height:1.05}
.sub{font:italic 11pt serif;color:#333}.by{font:8pt sans-serif;color:#555;margin:1mm 0 2mm}
figure{margin:0 0 2mm}figure img{width:100%;object-fit:cover;display:block}figcaption{font:7.5pt sans-serif;color:#555}
.txt{font-size:11.5pt;line-height:1.3;column-gap:5mm;text-align:justify;hyphens:auto}.txt p{margin:0 0 1.6mm;text-indent:3mm}.txt p:first-child{text-indent:0}
h3{font:700 10pt serif;margin:2mm 0 1mm;break-after:avoid}blockquote{margin:1mm 0 2mm;font:italic 10.5pt serif;border-left:.8mm solid #555;padding-left:2mm}
footer{position:absolute;left:${MARGIN}mm;right:${MARGIN}mm;bottom:5mm;display:flex;justify-content:space-between;font:8pt sans-serif;border-top:.3mm solid #111;padding-top:1mm}`;

async function main() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>The Riverton Herald (stand-in edition)</title><style>${css}</style></head><body>${Array.from({ length: PAGES }, (_, i) => pageHtml(i + 1)).join('')}</body></html>`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  const pdf = await page.pdf({ width: `${PW}mm`, height: `${PH}mm`, printBackground: true, preferCSSPageSize: true });
  writeFileSync(join(root, 'fixtures/edition-24p.pdf'), pdf);
  await browser.close();
  console.log('wrote fixtures/edition-24p.pdf', pdf.length, 'bytes');
}
main();
