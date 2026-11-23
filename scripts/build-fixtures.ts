/**
 * Builds the stand-in English fixtures: fixtures/english-15.json (D1 Articles in a
 * {standin:true} wrapper), fixtures/demo-site/ (static site, RSS, sitemap, images).
 * All images are generated locally with sharp. Run: pnpm exec tsx scripts/build-fixtures.ts
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
// @ts-ignore plain JS data module
import { articles as src } from './fixtures-src/articles.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'fixtures/demo-site');
const BASE = 'http://127.0.0.1:8190';
const W = 1200, H = 800;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---- generated images (original: gradients and flat shapes only) ----
function svg(kind: string): string {
  const defs = (a: string, b: string) => `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/>`;
  const wrap = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${inner}</svg>`;
  switch (kind) {
    case 'bridge': return wrap(defs('#9ec5e6', '#e8eef2') + `<rect y="560" width="${W}" height="240" fill="#3b6f8f"/><path d="M0 470 Q300 330 600 470 T1200 470 V520 H0Z" fill="#6b5b4d"/><rect x="560" y="470" width="80" height="150" fill="#4e4136"/><rect y="500" width="${W}" height="24" fill="#3d332b"/>`);
    case 'water': return wrap(defs('#bcd7e8', '#f0f4f6') + `<rect y="520" width="${W}" height="280" fill="#2f6b8c"/>` + [0, 1, 2, 3, 4, 5, 6, 7].map(i => `<rect x="${60 + i * 140}" y="380" width="120" height="150" fill="#8a949b" stroke="#566067" stroke-width="4"/>`).join(''));
    case 'books': return wrap(defs('#f3e3c6', '#d8b98a') + [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => `<rect x="${90 + i * 105}" y="${300 + (i % 3) * 30}" width="82" height="${380 - (i % 3) * 30}" fill="hsl(${20 + i * 33},45%,38%)"/>`).join('') + `<rect x="60" y="680" width="1080" height="30" fill="#5a3d26"/>`);
    case 'pitch': return wrap(defs('#a5d0f0', '#d7ecfa') + `<rect y="430" width="${W}" height="370" fill="#3a8a43"/><circle cx="600" cy="620" r="120" fill="none" stroke="#fff" stroke-width="6"/><line x1="600" y1="430" x2="600" y2="800" stroke="#fff" stroke-width="6"/><circle cx="600" cy="620" r="22" fill="#fff"/>`);
    case 'shopfront': return wrap(defs('#d9d4cb', '#b9b2a6') + `<rect x="200" y="260" width="800" height="440" fill="#4a6b5a"/><rect x="260" y="400" width="300" height="300" fill="#e9e2c8"/><rect x="640" y="400" width="300" height="300" fill="#e9e2c8"/><rect x="200" y="260" width="800" height="90" fill="#2e4439"/><path d="M200 350 h800 l-30 50 h-740z" fill="#c4533d"/>`);
    case 'barrels': return wrap(defs('#d8c9a8', '#a8916a') + [0, 1, 2].map(i => `<g transform="translate(${160 + i * 330},300)"><rect width="260" height="380" rx="90" fill="#8c6a43"/><rect y="90" width="260" height="22" fill="#4b3a26"/><rect y="270" width="260" height="22" fill="#4b3a26"/></g>`).join(''));
    case 'lab': return wrap(defs('#e8f0f4', '#c5d6de') + `<rect x="200" y="620" width="800" height="40" fill="#6b7b84"/><path d="M420 280 h90 v180 l90 160 h-270 l90 -160z" fill="#7fc8a9" stroke="#2f5d4b" stroke-width="6"/><circle cx="800" cy="500" r="110" fill="#f2d16b" stroke="#a78727" stroke-width="6"/>`);
    case 'building': return wrap(defs('#a9cdea', '#e7f0f5') + `<rect x="180" y="250" width="840" height="470" fill="#c9c2b6"/>` + [0, 1, 2, 3, 4, 5].flatMap(r => [0, 1, 2].map(c => `<rect x="${250 + r * 125}" y="${300 + c * 130}" width="80" height="80" fill="#5e8aa6"/>`)).join('') + `<rect x="520" y="620" width="160" height="100" fill="#3e5666"/><rect y="720" width="${W}" height="80" fill="#6f8f6a"/>`);
    case 'boat': // plain background + standing figure silhouette: cut-out test
      return wrap(`<rect width="${W}" height="${H}" fill="#eceae4"/><g fill="#1f2a33"><circle cx="600" cy="230" r="62"/><path d="M520 310 h160 q40 0 50 50 l30 200 h-60 l-20 -120 v300 h-80 v-180 h-20 v180 h-80 v-300 l-20 120 h-60 l30 -200 q10 -50 50 -50z"/></g>`);
    case 'rail': return wrap(defs('#b7c9d8', '#e5ebef') + `<rect y="560" width="${W}" height="240" fill="#6e6a62"/>` + [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(i => `<rect x="${i * 105}" y="610" width="60" height="22" fill="#4b3d30"/>`).join('') + `<rect y="590" width="${W}" height="10" fill="#c8c8c8"/><rect y="650" width="${W}" height="10" fill="#c8c8c8"/><rect x="850" y="250" width="26" height="310" fill="#444"/><circle cx="863" cy="285" r="22" fill="#c43a3a"/>`);
    default: return wrap(defs('#ccc', '#eee'));
  }
}

// ---- helpers ----
const ulid = (i: number) => (`01JD${String(i).padStart(2, '0')}EPAPERRIVERTON0000000000`).slice(0, 26);
const sha = (s: string) => 'sha256:' + createHash('sha256').update(s).digest('hex');
const text = (a: any) => a.body.map((b: any) => b.text).join('\n');
const wc = (a: any) => text(a).split(/\s+/).length;
const imgUrl = (a: any) => `${BASE}/img/${a.slug}.jpg`;
const pageUrl = (a: any) => `${BASE}/news/${a.slug}.html`;

async function main() {
  rmSync(site, { recursive: true, force: true });
  mkdirSync(join(site, 'img'), { recursive: true });
  mkdirSync(join(site, 'news'), { recursive: true });

  const out = [];
  let i = 0;
  for (const a of src as any[]) {
    i++;
    const rec: any = {
      id: `art_${ulid(i)}`, paper_id: 'pap_riverton_herald', source_id: 'src_riverton_demo_site',
      external_id: `demo:${a.slug}`, url: pageUrl(a), lang: 'en', script: 'Latn',
      section: a.section, tags: a.tags, priority: a.priority, kicker: a.kicker ?? null,
      headline: a.headline, subhead: a.subhead, byline: a.byline, dateline: a.dateline,
      body: a.body, images: [] as any[],
      published_at: a.published, updated_at: a.published,
      content_hash: sha(a.headline + '\n' + text(a)), rev: 1,
    };
    if (a.image) {
      const f = join(site, 'img', `${a.slug}.jpg`);
      await sharp(Buffer.from(svg(a.image.kind))).jpeg({ quality: 70, mozjpeg: true }).toFile(f);
      rec.images.push({ asset_id: `ast_${ulid(i)}`, role: 'lead', src: imgUrl(a), caption: a.image.caption, credit: a.image.credit });
    }
    out.push(rec);
  }
  writeFileSync(join(root, 'fixtures/english-15.json'),
    JSON.stringify({ standin: true, note: 'Original stand-in articles for the fictional town of Riverton; not the owner\'s demo site.', articles: out }, null, 2) + '\n');

  // ---- site ----
  const css = `body{font:17px/1.55 Georgia,serif;max-width:46rem;margin:0 auto;padding:1rem;color:#222}header{border-bottom:3px double #222;margin-bottom:1rem}header a{color:#222;text-decoration:none;font-size:2rem;font-weight:bold}nav a{margin-right:1rem;font:14px sans-serif}h1{line-height:1.2}.sub{color:#555;font-style:italic}.meta{font:13px sans-serif;color:#666}figure{margin:1rem 0}figure img{max-width:100%;height:auto}figcaption{font:13px sans-serif;color:#666}blockquote{border-left:4px solid #999;margin:1rem 0;padding-left:1rem;font-style:italic}li{margin:.8rem 0}`;
  const head = (title: string, extra = '') => `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><link rel="stylesheet" href="${extra}style.css"><link rel="alternate" type="application/rss+xml" title="The Riverton Herald" href="${BASE}/rss.xml">`;
  writeFileSync(join(site, 'style.css'), css);
  const sections = [...new Set((src as any[]).map(a => a.section))];
  for (const a of src as any[]) {
    const body = a.body.map((b: any) => b.t === 'h' ? `<h2>${esc(b.text)}</h2>` : b.t === 'quote' ? `<blockquote>${esc(b.text)}</blockquote>` : `<p>${esc(b.text)}</p>`).join('\n');
    const fig = a.image ? `<figure><img src="../img/${a.slug}.jpg" alt="${esc(a.image.caption)}" width="${W}" height="${H}"><figcaption>${esc(a.image.caption)} (${esc(a.image.credit)})</figcaption></figure>` : '';
    const og = `<meta property="og:type" content="article"><meta property="og:title" content="${esc(a.headline)}"><meta property="og:description" content="${esc(a.subhead)}"><meta property="og:url" content="${pageUrl(a)}"><meta property="og:site_name" content="The Riverton Herald">${a.image ? `<meta property="og:image" content="${imgUrl(a)}">` : ''}<meta property="article:published_time" content="${a.published}"><meta property="article:section" content="${a.section}"><meta name="author" content="${esc(a.byline.replace(/^By /, ''))}"><meta name="description" content="${esc(a.subhead)}">`;
    writeFileSync(join(site, 'news', `${a.slug}.html`), `${head(a.headline + ' | The Riverton Herald', '../')}${og}</head><body>
<header><a href="../index.html">The Riverton Herald</a><nav>${sections.map(s => `<a href="../index.html#${s}">${s}</a>`).join('')}</nav></header>
<article>
<p class="meta">${esc(a.kicker ?? a.section)} &middot; ${a.section}</p>
<h1>${esc(a.headline)}</h1>
<p class="sub">${esc(a.subhead)}</p>
<p class="meta"><span class="byline">${esc(a.byline)}</span> &middot; ${esc(a.dateline)} &middot; <time datetime="${a.published}">${a.published.slice(0, 10)}</time></p>
${fig}
<div class="body">
${body}
</div>
</article>
</body></html>
`);
  }
  const idx = sections.map(s => `<section id="${s}"><h2>${s[0].toUpperCase() + s.slice(1)}</h2><ul>${(src as any[]).filter(a => a.section === s).map(a => `<li><a href="news/${a.slug}.html">${esc(a.headline)}</a><br><span class="sub">${esc(a.subhead)}</span><br><span class="meta">${esc(a.byline)} &middot; <time datetime="${a.published}">${a.published.slice(0, 10)}</time></span></li>`).join('')}</ul></section>`).join('\n');
  writeFileSync(join(site, 'index.html'), `${head('The Riverton Herald')}<meta property="og:title" content="The Riverton Herald"><meta property="og:type" content="website"><meta property="og:url" content="${BASE}/"></head><body><header><a href="index.html">The Riverton Herald</a></header><p class="meta">Stand-in demo site. All content is fictional.</p>\n${idx}\n</body></html>\n`);

  const sorted = [...(src as any[])].sort((x, y) => y.published.localeCompare(x.published));
  writeFileSync(join(site, 'rss.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/"><channel>
<title>The Riverton Herald</title><link>${BASE}/</link><description>Stand-in demo feed (fictional)</description><language>en</language>
${sorted.map(a => `<item><title>${esc(a.headline)}</title><link>${pageUrl(a)}</link><guid isPermaLink="true">${pageUrl(a)}</guid><pubDate>${new Date(a.published).toUTCString()}</pubDate><dc:creator>${esc(a.byline.replace(/^By /, ''))}</dc:creator><category>${a.section}</category><description>${esc(a.subhead)}</description><content:encoded><![CDATA[${a.body.map((b: any) => `<p>${b.text}</p>`).join('')}]]></content:encoded>${a.image ? `<media:content url="${imgUrl(a)}" medium="image" type="image/jpeg"/>` : ''}</item>`).join('\n')}
</channel></rss>
`);
  writeFileSync(join(site, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${BASE}/</loc></url>
${sorted.map(a => `<url><loc>${pageUrl(a)}</loc><lastmod>${a.published}</lastmod></url>`).join('\n')}
</urlset>
`);
  writeFileSync(join(site, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${BASE}/sitemap.xml\n`);
  console.log(out.length, 'articles; words:', (src as any[]).map(wc).join(','));
}
main();
