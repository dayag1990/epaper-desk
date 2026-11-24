#!/usr/bin/env node
// Generate the stand-in Tamil demo news site (fictional paper "Thenpothigai Daily") from
// fixtures/demo-site-ta/articles.ta.json into fixtures/demo-site-ta/site/.
// No network. Deterministic output. Absolute links use the placeholder http://127.0.0.1:8190,
// exactly like fixtures/demo-site, so the same wizard and the demo-site container rewrite work.
// Images are only referenced (/img/<image_file>); the photo step creates them and fills image_file.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "http://127.0.0.1:8190";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "demo-site-ta");
const src = join(root, "articles.ta.json");
const out = join(root, "site");

const data = JSON.parse(readFileSync(src, "utf8"));
const SECTION_SLUGS = ["front-page", "tamil-nadu", "chennai", "india", "world", "business", "sport", "cinema"];
const MASTHEAD = data.masthead ?? "தென்பொதிகை";
const MASTHEAD_EN = data.masthead_en ?? "Thenpothigai Daily";
const STRAP = data.strapline ?? "மாதிரி இதழ் · டெமோ";
const NOTE = "இது முழுக்கக் கற்பனையான மாதிரி இதழ். செய்திகள், நபர்கள், நிறுவனங்கள் அனைத்தும் கற்பனை.";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const nfc = (s) => (typeof s === "string" ? s.normalize("NFC") : s);
const cdata = (s) => `<![CDATA[${s.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
const rfc822 = (iso) => new Date(iso).toUTCString();
const ymd = (iso) => iso.slice(0, 10);

const sections = data.sections.map((s, i) => ({ ...s, slug: SECTION_SLUGS[i] ?? `page-${s.page}` }));
const secByName = new Map(sections.map((s) => [s.name_ta, s]));
const articles = data.articles.map((a) => {
  const o = {};
  for (const [k, v] of Object.entries(a)) o[k] = Array.isArray(v) ? v.map(nfc) : nfc(v);
  return o;
});
const bySection = (s) => articles.filter((a) => a.section === s.name_ta).sort((x, y) => x.priority - y.priority || x.id.localeCompare(y.id));
const url = (a) => `${BASE}/news/${a.id}.html`;
const imgUrl = (a) => `${BASE}/img/${a.image_file}`;

/** Article body as HTML paragraphs: dateline opens the first one, the pull quote follows the second. */
function bodyHtml(a) {
  const parts = a.body.map((p, i) => (i === 0 ? `<p><strong>${esc(a.dateline)}</strong> ${esc(p)}</p>` : `<p>${esc(p)}</p>`));
  if (a.pull_quote) parts.splice(Math.min(2, parts.length), 0, `<blockquote class="pull">${esc(a.pull_quote)}</blockquote>`);
  return parts.join("\n");
}

const css = `body{font:18px/1.7 "Noto Serif Tamil","Noto Sans Tamil","Latha","Nirmala UI",serif;max-width:48rem;margin:0 auto;padding:1rem;color:#222}
header{border-bottom:3px double #222;margin-bottom:1rem}header a.mast{color:#222;text-decoration:none;font-size:2.4rem;font-weight:bold}
.strap{font:13px sans-serif;color:#a00;letter-spacing:.02em}nav a{margin-right:1rem;font-size:15px}
h1{line-height:1.35}h2{margin-top:1.8rem;border-bottom:1px solid #ccc}.sub{color:#555;font-style:italic}.meta{font:13px sans-serif;color:#666}
figure{margin:1rem 0}figure img{max-width:100%;height:auto}figcaption{font:13px sans-serif;color:#666}
blockquote{border-left:4px solid #999;margin:1rem 0;padding-left:1rem;font-style:italic}blockquote.pull{font-size:1.25em}
li{margin:.8rem 0}footer{margin-top:2rem;font:13px sans-serif;color:#666;border-top:1px solid #ccc;padding-top:.6rem}
`;

const head = (title, rel, extra = "") =>
  `<!doctype html>\n<html lang="ta"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><link rel="stylesheet" href="${rel}style.css"><link rel="alternate" type="application/rss+xml" title="${esc(MASTHEAD)}" href="${BASE}/rss.xml">${extra}</head><body>\n`;
const nav = (rel) =>
  `<header><a class="mast" href="${rel}index.html">${esc(MASTHEAD)}</a> <span class="strap">${esc(STRAP)}</span><nav>${sections
    .map((s) => `<a href="${rel}sections/${s.slug}.html">${esc(s.name_ta)}</a>`)
    .join("")}</nav></header>\n`;
const foot = `<footer>${esc(NOTE)} (${esc(MASTHEAD_EN)}, ${esc(data.issue_date)})</footer>\n</body></html>\n`;

function listItem(a, rel) {
  return `<li><a href="${rel}news/${a.id}.html">${esc(a.headline)}</a><br><span class="sub">${esc(a.standfirst)}</span><br><span class="meta">${esc(a.byline)} &middot; ${esc(a.dateline.replace(/:$/, ""))} &middot; <time datetime="${a.published_at}">${ymd(a.published_at)}</time></span></li>`;
}

function articlePage(a) {
  const sec = secByName.get(a.section);
  const img = a.image_file ? imgUrl(a) : null;
  const ld = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: a.headline,
    description: a.standfirst,
    inLanguage: "ta",
    datePublished: a.published_at,
    dateModified: a.published_at,
    articleSection: a.section,
    author: { "@type": "Person", name: a.byline },
    publisher: { "@type": "Organization", name: MASTHEAD },
    mainEntityOfPage: url(a),
    ...(img ? { image: [img] } : {}),
  };
  const meta =
    `<meta property="og:type" content="article"><meta property="og:title" content="${esc(a.headline)}"><meta property="og:description" content="${esc(a.standfirst)}">` +
    `<meta property="og:url" content="${url(a)}"><meta property="og:site_name" content="${esc(MASTHEAD)}"><meta property="og:locale" content="ta_IN">` +
    (img ? `<meta property="og:image" content="${img}">` : "") +
    `<meta property="article:published_time" content="${a.published_at}"><meta property="article:section" content="${esc(a.section)}"><meta name="author" content="${esc(a.byline)}"><meta name="description" content="${esc(a.standfirst)}">` +
    `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`;
  const fig = img
    ? `<figure><img src="/img/${esc(a.image_file)}" alt="${esc(a.caption ?? a.headline)}" width="1200" height="800">${a.caption ? `<figcaption>${esc(a.caption)}</figcaption>` : ""}</figure>\n`
    : "";
  return (
    head(`${a.headline} | ${MASTHEAD}`, "../", meta) +
    nav("../") +
    `<article>\n<p class="meta"><a href="../sections/${sec.slug}.html">${esc(a.section)}</a></p>\n<h1>${esc(a.headline)}</h1>\n<p class="sub">${esc(a.standfirst)}</p>\n` +
    `<p class="meta"><span class="byline">${esc(a.byline)}</span> &middot; ${esc(a.dateline.replace(/:$/, ""))} &middot; <time datetime="${a.published_at}">${ymd(a.published_at)}</time></p>\n` +
    fig +
    `<div class="body">\n${bodyHtml(a)}\n</div>\n</article>\n` +
    foot
  );
}

function indexPage() {
  let h = head(`${MASTHEAD} | ${MASTHEAD_EN}`, "", `<meta property="og:title" content="${esc(MASTHEAD)}"><meta property="og:type" content="website"><meta property="og:url" content="${BASE}/">`);
  h += nav("") + `<p class="meta">${esc(STRAP)} &middot; ${esc(data.issue_date)} &middot; ${esc(NOTE)}</p>\n`;
  for (const s of sections) h += `<section id="${s.slug}"><h2><a href="sections/${s.slug}.html">${esc(s.name_ta)}</a> <span class="meta">பக்கம் ${s.page}</span></h2><ul>${bySection(s).map((a) => listItem(a, "")).join("")}</ul></section>\n`;
  return h + foot;
}

function sectionPage(s) {
  return head(`${s.name_ta} | ${MASTHEAD}`, "../") + nav("../") + `<section><h2>${esc(s.name_ta)} <span class="meta">${esc(s.name_en)} &middot; பக்கம் ${s.page}</span></h2><ul>${bySection(s).map((a) => listItem(a, "../")).join("")}</ul></section>\n` + foot;
}

function rss() {
  const items = [...articles]
    .sort((x, y) => x.page - y.page || x.priority - y.priority || x.id.localeCompare(y.id))
    .map((a) => {
      const html = bodyHtml(a);
      return (
        `<item><title>${esc(a.headline)}</title><link>${url(a)}</link><guid isPermaLink="true">${url(a)}</guid><pubDate>${rfc822(a.published_at)}</pubDate>` +
        `<dc:creator>${esc(a.byline)}</dc:creator><category>${esc(a.section)}</category><description>${esc(a.standfirst)}</description>` +
        `<content:encoded>${cdata(html)}</content:encoded>` +
        // the caption line (with the photo credit when the licence asks for one) travels in the feed as <media:description>
        (a.image_file ? `<media:content url="${imgUrl(a)}" medium="image" type="image/jpeg">${a.caption ? `<media:description>${esc(a.caption)}</media:description>` : ""}</media:content>` : "") +
        `</item>`
      );
    });
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/"><channel>\n` +
    `<title>${esc(MASTHEAD)}</title><link>${BASE}/</link><description>${esc(`${STRAP} - கற்பனை மாதிரி இதழ்`)}</description><language>ta</language>\n` +
    items.join("\n") +
    `\n</channel></rss>\n`
  );
}

function sitemap() {
  const u = [`<url><loc>${BASE}/</loc></url>`, ...sections.map((s) => `<url><loc>${BASE}/sections/${s.slug}.html</loc></url>`), ...articles.map((a) => `<url><loc>${url(a)}</loc><lastmod>${a.published_at}</lastmod></url>`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${u.join("\n")}\n</urlset>\n`;
}

mkdirSync(join(out, "news"), { recursive: true });
mkdirSync(join(out, "sections"), { recursive: true });
const w = (p, c) => writeFileSync(join(out, p), c);
w("style.css", css);
w("index.html", indexPage());
for (const s of sections) w(`sections/${s.slug}.html`, sectionPage(s));
for (const a of articles) w(`news/${a.id}.html`, articlePage(a));
w("rss.xml", rss());
w("sitemap.xml", sitemap());
w("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${BASE}/sitemap.xml\n`);
console.log(`wrote ${articles.length} articles, ${sections.length} sections to ${out}`);
