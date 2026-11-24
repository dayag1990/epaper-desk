// Tamil demo paper "Thenpothigai Daily": content rules, generated site and RSS ingest through the real connectors adapter.
// Run: npx vitest run -c vitest.stack.config.ts tests/ta-content
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const ROOT = here("../../");
const FIX = here("../../fixtures/demo-site-ta/");
const SITE = FIX + "site/";

interface Art {
  id: string; section: string; page: number; priority: number; headline: string; standfirst: string; byline: string; dateline: string;
  published_at: string; body: string[]; pull_quote: string | null; caption: string | null; image_hint: string | null; image_file: string | null;
}
interface Doc { standin: boolean; paper: string; issue_date: string; sections: { name_ta: string; name_en: string; page: number }[]; articles: Art[] }

// fast-xml-parser is a dependency of packages/connectors (same parser the adapter uses), not of the repo root.
const { XMLParser, XMLValidator } = createRequire(ROOT + "packages/connectors/package.json")("fast-xml-parser");

const doc: Doc = JSON.parse(readFileSync(FIX + "articles.ta.json", "utf8"));
const arts = doc.articles;

const SECTIONS = ["முதல் பக்கம்", "தமிழ்நாடு", "சென்னை", "இந்தியா", "உலகம்", "வணிகம்", "விளையாட்டு", "சினிமா"];
const LATIN_ALLOW = new Set(["IT", "GST", "ODI", "T20", "AI", "GDP", "UPI", "ATM", "LED", "DNA", "PDF"]);
const REAL_PAPERS = ["தினத்தந்தி", "தினமலர்", "தினமணி", "இந்து தமிழ்", "தினகரன்", "மாலை மலர்", "தினபூமி", "தீக்கதிர்", "முரசொலி", "தினச்செய்தி", "மாலைமுரசு", "தமிழ் முரசு", "நக்கீரன்", "ஆனந்த விகடன்", "குமுதம்", "தி இந்து", "டைம்ஸ் ஆஃப் இந்தியா", "ராய்ட்டர்ஸ்", "பிடிஐ", "ஏஎன்ஐ", "பிபிசி", "சிஎன்என்"];
// Real parties, public bodies, teams and leagues that the demo must not mention (fiction rule 2 and 4).
const REAL_ENTITIES = ["திமுக", "அதிமுக", "பாஜக", "காங்கிரஸ்", "பாமக", "தேமுதிக", "நாம் தமிழர்", "ஐபிஎல்", "பிசிசிஐ", "சிஎஸ்கே", "சூப்பர் கிங்ஸ்", "மும்பை இந்தியன்ஸ்", "இஸ்ரோ", "ரிசர்வ் வங்கி", "செபி", "சென்னை மெட்ரோ", "இந்திய ரயில்வே", "தெற்கு ரயில்வே", "உச்ச நீதிமன்றம்", "உயர் நீதிமன்றம்", "முதலமைச்சர்", "பிரதமர்", "அமைச்சர்", "சட்டமன்றம்", "நாடாளுமன்றம்", "தேர்தல்", "ஹிந்து", "முஸ்லிம்", "கிறிஸ்தவ", "மசூதி", "தேவாலயம்", "கொடைக்கானல் நீதி", "ஃபிஃபா", "ஐசிசி"];

const words = (a: Art) => a.body.join(" ").split(/\s+/).filter(Boolean).length;
// The first draft had short / medium / long pieces; the stories were then trimmed to fit eight pages (scripts/trim-articles-ta.mjs): now short (the 32 ordinary stories) and lead (one per section, with the pull quote).
const band = (n: number) => (n >= 60 && n <= 130 ? "short" : n >= 140 && n <= 300 ? "lead" : "none");
const letters = (s: string) => [...s].filter((c) => /\p{L}/u.test(c));
const tamilShare = (s: string) => { const l = letters(s); return l.length ? l.filter((c) => /\p{Script=Tamil}/u.test(c)).length / l.length : 0; };
const allText = (a: Art) => [a.headline, a.standfirst, a.byline, a.dateline, ...a.body, a.pull_quote ?? "", a.caption ?? ""].join("\n");

beforeAll(() => {
  execFileSync(process.execPath, [ROOT + "scripts/make-demo-site-ta.mjs"], { cwd: ROOT, stdio: "pipe" });
}, 60_000);

describe("fixture shape", () => {
  it("is a stand-in paper with 8 sections in order and 40 articles", () => {
    expect(doc.standin).toBe(true);
    expect(doc.paper).toBe("thenpothigai");
    expect(doc.issue_date).toBe("2026-11-24");
    expect(doc.sections.map((s) => s.name_ta)).toEqual(SECTIONS);
    expect(doc.sections.map((s) => s.page)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(doc.sections.every((s) => /^[A-Za-z ]+$/.test(s.name_en))).toBe(true);
    expect(arts).toHaveLength(40);
    expect(arts.map((a) => a.id)).toEqual(Array.from({ length: 40 }, (_, i) => `ta-${String(i + 1).padStart(3, "0")}`));
  });

  it("has 5 articles per section, on the section's page, with distinct headlines", () => {
    for (const [i, name] of SECTIONS.entries()) {
      const mine = arts.filter((a) => a.section === name);
      expect(mine, name).toHaveLength(5);
      expect(mine.every((a) => a.page === i + 1)).toBe(true);
    }
    expect(new Set(arts.map((a) => a.headline)).size).toBe(40);
    expect(new Set(arts.map((a) => a.id)).size).toBe(40);
  });

  it("has all fields, priorities 1-5, ISO +05:30 dates on the issue day, strapline in the generated site", () => {
    for (const a of arts) {
      for (const k of ["headline", "standfirst", "byline", "dateline"] as const) expect(a[k].trim().length, `${a.id} ${k}`).toBeGreaterThan(3);
      expect(a.dateline.endsWith(":"), a.id).toBe(true);
      expect(Number.isInteger(a.priority) && a.priority >= 1 && a.priority <= 5, a.id).toBe(true);
      expect(a.published_at, a.id).toMatch(/^2026-11-24T\d\d:\d\d:\d\d\+05:30$/);
      expect(a.image_file === null || typeof a.image_file === "string").toBe(true);
      expect(a.standfirst.replace(/(செ|கி)\.மீ\./g, "$1மீ").replace(/(^|\s)\p{L}\p{M}*\./gu, "$1").match(/[.!?](\s|$)/g)?.length, `${a.id} standfirst is one sentence`).toBe(1);
    }
    const front = arts.filter((a) => a.page === 1).map((a) => a.priority).sort();
    expect(front).toEqual([1, 2, 3, 4, 5]);
  });

  it("has no stray or doubled whitespace in any text", () => {
    for (const a of arts) for (const t of [a.headline, a.standfirst, a.byline, a.dateline, a.pull_quote, a.caption, ...a.body]) if (t !== null) expect(t, a.id).toBe(t.replace(/\s+/g, " ").trim());
  });

  it("is NFC-normalised everywhere", () => {
    const raw = readFileSync(FIX + "articles.ta.json", "utf8");
    expect(raw.normalize("NFC")).toBe(raw);
  });
});

describe("lengths", () => {
  it("every article is in a band; 32 short, 8 lead (one lead per section)", () => {
    const counts = { short: 0, lead: 0, none: 0 };
    for (const a of arts) { const b = band(words(a)); counts[b]++; expect(b, `${a.id} has ${words(a)} words`).not.toBe("none"); }
    expect(counts).toEqual({ short: 32, lead: 8, none: 0 });
    for (const name of SECTIONS) expect(arts.filter((a) => a.section === name && band(words(a)) === "lead"), name).toHaveLength(1);
    expect(arts.filter((a) => a.page === 1 && band(words(a)) === "lead")).toHaveLength(1);
  });

  it("lead pieces have 2-6 paragraphs and a pull quote; others have none", () => {
    for (const a of arts) {
      if (band(words(a)) === "lead") {
        expect(a.body.length, a.id).toBeGreaterThanOrEqual(2);
        expect(a.body.length, a.id).toBeLessThanOrEqual(6);
        expect(a.pull_quote && a.pull_quote.length > 20, a.id).toBeTruthy();
      } else expect(a.pull_quote, a.id).toBeNull();
    }
  });

  it("most have a caption and an image hint (always together); the credit is printed for CC BY / CC BY-SA photos only", () => {
    const withCap = arts.filter((a) => a.caption);
    expect(withCap.length).toBeGreaterThanOrEqual(24);
    expect(withCap.length).toBeLessThanOrEqual(31);
    for (const a of arts) {
      expect(!!a.caption, a.id).toBe(!!a.image_hint);
      if (a.image_hint) {
        expect(a.image_hint, a.id).toMatch(/^[a-z]+( [a-z]+){1,3}$/);
        expect(a.caption, a.id).toMatch(/^கோப்புப் படம்( · படம்: .+, CC BY(-SA)? \d\.\d, Wikimedia Commons)?$/);
      }
    }
  });
});

describe("language and rules", () => {
  it("headlines and bodies are at least 85 % Tamil letters (we hold them to 95 %)", () => {
    for (const a of arts) {
      expect(tamilShare(a.headline), `${a.id} headline`).toBeGreaterThanOrEqual(0.85);
      expect(tamilShare(a.body.join(" ")), `${a.id} body`).toBeGreaterThanOrEqual(0.85);
      expect(tamilShare(a.body.join(" ")), `${a.id} body`).toBeGreaterThanOrEqual(0.95);
    }
  });

  it("headlines carry no Latin letters except a short allow-list of acronyms", () => {
    for (const a of arts) for (const m of a.headline.match(/[A-Za-z0-9]*[A-Za-z][A-Za-z0-9]*/g) ?? []) expect(LATIN_ALLOW.has(m), `${a.id}: ${m}`).toBe(true);
  });

  it("numerals are Arabic digits and Tamil digits are not used", () => {
    for (const a of arts) expect(allText(a), a.id).not.toMatch(/[\u0BE6-\u0BEF]/);
  });

  it("names no real newspaper, party, public body, team or league", () => {
    for (const a of arts) {
      const t = allText(a);
      for (const n of [...REAL_PAPERS, ...REAL_ENTITIES]) expect(t.includes(n), `${a.id} mentions ${n}`).toBe(false);
    }
  });

  it("uses no straight double quotes inside text and ends sentences with Tamil-friendly punctuation", () => {
    for (const a of arts) {
      expect(a.headline.includes('"'), a.id).toBe(false);
      for (const p of a.body) expect(p.trim().length > 40 && /[.!?”’)]$/.test(p.trim()), `${a.id}: ${p.slice(-30)}`).toBe(true);
    }
  });
});

describe("generated site", () => {
  it("has index, section pages, one page per article, rss, sitemap, robots", () => {
    for (const f of ["index.html", "rss.xml", "sitemap.xml", "robots.txt", "style.css"]) expect(existsSync(SITE + f), f).toBe(true);
    const idx = readFileSync(SITE + "index.html", "utf8");
    expect(idx).toContain('<html lang="ta"');
    expect(idx).toContain("மாதிரி இதழ் · டெமோ");
    expect(readFileSync(SITE + "robots.txt", "utf8")).toContain("Sitemap: http://127.0.0.1:8190/sitemap.xml");
    for (const a of arts) {
      const h = readFileSync(SITE + `news/${a.id}.html`, "utf8");
      expect(h).toContain(`<h1>${a.headline}</h1>`);
      expect(h).toContain(`<time datetime="${a.published_at}">`);
      expect(h).toContain('property="og:title"');
      expect(h).toContain("application/ld+json");
      const ld = JSON.parse(h.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]);
      expect(ld).toMatchObject({ "@type": "NewsArticle", headline: a.headline, inLanguage: "ta", articleSection: a.section });
      expect(h.includes("<figure>"), a.id).toBe(!!a.image_file);
      expect(idx).toContain(`news/${a.id}.html`);
    }
  });

  it("uses only the placeholder origin for absolute links", () => {
    for (const f of ["rss.xml", "sitemap.xml", "index.html"]) {
      const t = readFileSync(SITE + f, "utf8");
      for (const m of t.matchAll(/https?:\/\/[^"'<\s]+/g)) {
        if (/^https?:\/\/(purl\.org|www\.w3\.org|search\.yahoo\.com|www\.sitemaps\.org|schema\.org)/.test(m[0])) continue;
        expect(m[0].startsWith("http://127.0.0.1:8190"), `${f}: ${m[0]}`).toBe(true);
      }
    }
  });

  it("rss.xml is well-formed RSS 2.0 in Tamil with content:encoded, dc:creator, category", () => {
    const xml = readFileSync(SITE + "rss.xml", "utf8");
    expect(XMLValidator.validate(xml)).toBe(true);
    const p = new XMLParser({ ignoreAttributes: false });
    const rss = p.parse(xml).rss;
    expect(rss["@_version"]).toBe("2.0");
    expect(rss.channel.language).toBe("ta");
    expect(rss.channel.item).toHaveLength(40);
    for (const it of rss.channel.item) {
      expect(it["content:encoded"].length).toBeGreaterThan(300);
      expect(SECTIONS).toContain(it.category);
      expect(it["dc:creator"]).toBeTruthy();
    }
    expect((xml.match(/<media:content /g) ?? []).length).toBe(arts.filter((a) => a.image_file).length);
  });
});

describe("ingest through the connectors RSS adapter", () => {
  it("ingests all 40 with section, headline, body, byline, dateline and Unicode intact", async () => {
    const { createRssConnector, syncSource, MemoryArticleStore, RSS_DEFAULT_MAPPING } = await import("../../packages/connectors/src/index.js");
    const { ArticleSchema } = await import("@epaper/core");
    const xml = readFileSync(SITE + "rss.xml", "utf8");
    const fetcher = { get: async (u: string) => ({ url: u, status: 200, contentType: "application/rss+xml", text: xml }) };
    const store = new MemoryArticleStore();
    // A Tamil source is set up with a fixed language and script in its mapping: the adapter's script detection (util.detectScript)
    // does not know Tamil yet and would report lang "en" / script "Latn".
    const mapping = { ...RSS_DEFAULT_MAPPING, lang: "const:ta", script: "const:Taml" };
    const rep = await syncSource(createRssConnector(fetcher as never), { url: "http://127.0.0.1:8190/rss.xml", limit: 200 }, mapping, { paperId: "pap_ta", sourceId: "src_ta" }, store);
    expect(rep.rejected).toEqual([]);
    expect(rep.created).toBe(40);
    const all = store.all();
    expect(all).toHaveLength(40);
    for (const a of arts) {
      const got = all.find((x) => x.url === `http://127.0.0.1:8190/news/${a.id}.html`);
      expect(got, a.id).toBeDefined();
      expect(ArticleSchema.safeParse(got).success, a.id).toBe(true);
      expect(got!.section).toBe(a.section);
      expect(got!.headline).toBe(a.headline);
      expect(got!.subhead).toBe(a.standfirst);
      expect(got!.byline).toBe(a.byline);
      expect(got!.lang).toBe("ta");
      expect(got!.script).toBe("Taml");
      const paras = got!.body.filter((b) => b.t === "p").map((b) => b.text);
      expect(paras).toHaveLength(a.body.length);
      expect(paras[0]).toBe(`${a.dateline} ${a.body[0]}`);
      expect(paras.slice(1)).toEqual(a.body.slice(1));
      expect(got!.body.filter((b) => b.t === "quote").map((b) => b.text)).toEqual(a.pull_quote ? [a.pull_quote] : []);
      for (const s of [got!.headline, got!.byline ?? "", ...got!.body.map((b) => b.text)]) expect(s.normalize("NFC")).toBe(s);
      expect(got!.published_at.startsWith("2026-11-2"), a.id).toBe(true);
    }
  });
});
