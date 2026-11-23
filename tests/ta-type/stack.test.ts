// Tamil demo through the real API + worker, in a THROWAWAY compose project (tmp-ta, API on 127.0.0.1:8111). The live project is never touched.
//   pnpm exec vitest run -c vitest.stack.config.ts tests/ta-type/stack
// Brings the stack up itself (images tmp-ta-api:ta, tmp-ta-worker:ta are built from this checkout by compose on first use) and leaves it
// running for the next run; remove it with:  BACKUP_ROOT=/srv/epaper/ta-tmp-root docker compose -p tmp-ta -f docker-compose.yml -f docker-compose.ta-test.yml down -v
// Covers: GET /fonts, 40 Tamil articles synced through the wizard/RSS source, 8 section pages auto-planned from the template set, the screen PDF made
// by the worker's Chromium (fonts embedded, text exact), and the IDML export (job, write-once store, download, structural validation).
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { validateIdml } from "../../packages/idml/dist/index.js";
import { pdfFonts, pdfWords, squash } from "./lib/pdf.js";

const API = process.env.TA_API ?? "http://127.0.0.1:8111";
const cwd = new URL("../..", import.meta.url).pathname;
const SITE = "http://127.0.0.1:8190/";
const COMPOSE = "BACKUP_ROOT=/srv/epaper/ta-tmp-root docker compose -p tmp-ta -f docker-compose.yml -f docker-compose.ta-test.yml";
const sh = (cmd: string, env = "") => execSync(`sg docker -c "${env} ${cmd}"`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], cwd });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = () => randomBytes(9).toString("hex");
const run = rnd();
const slug = `ta-${run}`;
const PW = { owner: `pw-${rnd()}`, ana: `pw-${rnd()}` };
const EMAIL = (n: string) => `${n}-${run}@test.example`;
const JSZip = createRequire(new URL("../../packages/idml/package.json", import.meta.url))("jszip") as typeof import("../../packages/idml/node_modules/jszip");
const SECTIONS = ["முதல் பக்கம்", "தமிழ்நாடு", "சென்னை", "இந்தியா", "உலகம்", "வணிகம்", "விளையாட்டு", "சினிமா"];

async function call(method: string, path: string, o: { cookie?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (o.cookie) headers.cookie = o.cookie;
  let body: string | undefined;
  if (o.body !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(o.body); }
  const r = await fetch(API + path, { method, headers, body });
  const buf = Buffer.from(await r.arrayBuffer());
  let json: any; try { json = JSON.parse(buf.toString()); } catch { /* not json */ }
  return { status: r.status, json, buf, headers: r.headers };
}
async function until<T>(what: string, fn: () => Promise<T | undefined | false>, ms = 180_000, every = 800): Promise<T> {
  const t = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - t > ms) throw new Error(`timed out waiting for: ${what}`);
    await sleep(every);
  }
}

let owner: string, ana: string, editionId: string, pages: any[] = [], leadIds: string[] = [];
mkdirSync("/srv/epaper/ta-tmp-root", { recursive: true }); // the test makes its own scratch folder
for (const d of ["/srv/epaper/ta-tmp-root/walarchive", "/srv/epaper/files-ta-tmp"]) mkdirSync(d, { recursive: true, mode: 0o777 }); // made by us (uid 1001), not by Docker as root
const root = mkdtempSync("/srv/epaper/ta-tmp-root/site-");

beforeAll(async () => {
  // a copy of the Tamil demo site where the newest article of each section carries a real JPEG (the fixture has no photos)
  const fix = JSON.parse(readFileSync(join(cwd, "fixtures/demo-site-ta/articles.ta.json"), "utf8")) as { articles: { id: string; section: string; published_at: string }[] };
  const site = join(root, "site");
  cpSync(join(cwd, "fixtures/demo-site-ta/site"), site, { recursive: true });
  mkdirSync(join(site, "img"), { recursive: true });
  const jpg = await sharp({ create: { width: 1800, height: 1200, channels: 3, background: "#6a7f8a" } }).jpeg().toBuffer();
  let rss = readFileSync(join(site, "rss.xml"), "utf8");
  for (const s of SECTIONS) {
    const lead = fix.articles.filter((a) => a.section === s).sort((a, b) => +new Date(b.published_at) - +new Date(a.published_at) || (a.id < b.id ? -1 : 1))[0]!;
    leadIds.push(lead.id);
    writeFileSync(join(site, "img", `${lead.id}.jpg`), jpg);
    rss = rss.replace(new RegExp(`(<link>[^<]*/news/${lead.id}\\.html</link>[\\s\\S]*?)</item>`), `$1<media:content url="http://127.0.0.1:8190/img/${lead.id}.jpg" medium="image" type="image/jpeg"/></item>`);
  }
  writeFileSync(join(site, "rss.xml"), rss);
  sh(`${COMPOSE} build api worker`, `TA_SITE=${site}`); // the images tmp-ta-api:ta / tmp-ta-worker:ta do not exist on a clean box
  sh(`${COMPOSE} up -d postgres api worker demo-api demo-worker`, `TA_SITE=${site}`);
  await until("api ready", async () => (await call("GET", "/readyz").catch(() => ({ status: 0 }))).status === 200);
  sh(`${COMPOSE} exec -T -e SEED_OWNER_PASSWORD=${PW.owner} -e SEED_PAPER_SLUG=${slug} -e SEED_OWNER_EMAIL=${EMAIL("owner")} api sh -c 'cd /app && node_modules/.bin/tsx prisma/seed.mts'`);
  const login = async (email: string, password: string) => {
    const r = await call("POST", "/v1/auth/login", { body: { email, password, paper: slug } });
    expect(r.status).toBe(200);
    return r.headers.get("set-cookie")!.split(";")[0]!;
  };
  owner = await login(EMAIL("owner"), PW.owner);
  expect((await call("POST", "/v1/members", { cookie: owner, body: { email: EMAIL("ana"), name: "Ana", password: PW.ana, role: "editor" } })).status).toBe(201);
  ana = await login(EMAIL("ana"), PW.ana);
}, 900_000);

describe("Tamil demo on the real stack (project tmp-ta)", () => {
  it("serves the fonts at /fonts: same bytes, font/ttf, one year cache, CORS; refuses traversal", async () => {
    for (const rel of ["noto-serif-tamil/NotoSerifTamil[wdth,wght].ttf", "anek-tamil/AnekTamil[wdth,wght].ttf"]) {
      const r = await call("GET", "/fonts/" + rel.split("/").map(encodeURIComponent).join("/"));
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("font/ttf");
      expect(r.headers.get("cache-control")).toContain("max-age=31536000");
      expect(r.headers.get("access-control-allow-origin")).toBe("*");
      expect(Buffer.compare(r.buf, readFileSync(join(cwd, "templates/fonts", rel)))).toBe(0);
    }
    for (const bad of ["/fonts/%2e%2e/broadsheet-en/front_a.json", "/fonts/noto-serif-tamil/OFL.txt", "/fonts/%2e%2e%2f%2e%2e%2fpackage.json", "/fonts/"]) {
      const r = await call("GET", bad);
      expect(r.status, bad).toBe(404);
      expect(r.buf.toString()).not.toContain("demo_default");
    }
  });

  it("syncs the Tamil site as a source: 40 articles in Tamil", async () => {
    const w = await call("POST", "/v1/sources/wizard", { cookie: owner, body: { url: SITE } });
    expect(w.status, JSON.stringify(w.json)).toBe(200);
    // the script detector does not know Tamil yet: the source is set up with a fixed language and script (see fixtures/demo-site-ta/README.md)
    const mk = await call("POST", "/v1/sources", { cookie: owner, body: { kind: w.json.kind, name: "தென்பொதிகை", config: w.json.config, mapping: { ...w.json.mapping, lang: "const:ta", script: "const:Taml" } } });
    expect(mk.status, JSON.stringify(mk.json)).toBe(201);
    expect((await call("POST", `/v1/sources/${mk.json.id}/sync`, { cookie: owner })).status).toBe(202);
    const items = await until("40 articles", async () => { const r = await call("GET", "/v1/articles", { cookie: owner }); return r.json.items.length === 40 ? r.json.items : undefined; });
    expect(items.every((a: any) => a.lang === "ta")).toBe(true);
    for (const s of SECTIONS) expect(items.filter((a: any) => a.section === s), s).toHaveLength(5);
    await until("lead photos stored", async () => {
      const withImg = items.filter((a: any) => a.images.length);
      if (withImg.length !== 8) return false;
      const r = await call("GET", `/v1/assets/${withImg[0].images[0].asset_id}/file`, { cookie: owner });
      return r.status === 200 && r.buf.length > 1000;
    });
  }, 240_000);

  it("auto-plans 8 pages from the template set: one section per page in the paper's order, every page 85-100 %", async () => {
    const e = await call("POST", "/v1/editions", { cookie: ana, body: { paper: slug, date: "2026-11-24", template_set: "broadsheet-ta", name: "தென்பொதிகை" } });
    expect(e.status, JSON.stringify(e.json)).toBe(201);
    editionId = e.json.id;
    expect((await call("POST", `/v1/editions/${editionId}/autoplan`, { cookie: ana, body: {} })).status).toBe(202);
    const ed = await until("8 planned pages", async () => {
      const r = await call("GET", `/v1/editions/${editionId}`, { cookie: ana });
      return r.json.status === "planned" && r.json.pages.length === 8 ? r.json : undefined;
    }, 240_000);
    pages = ed.pages;
    expect(ed.template_set).toBe("broadsheet-ta");
    const bySec = new Map<string, string>((ed.articles as any[]).map((a) => [a.id, a.section]));
    pages.forEach((p, i) => {
      expect(p.no).toBe(i + 1);
      expect(p.doc.items).toHaveLength(5);
      expect(new Set(p.doc.items.map((it: any) => bySec.get(it.article_id)))).toEqual(new Set([SECTIONS[i]]));
      expect(p.fit_pct, `page ${i + 1}`).toBeGreaterThanOrEqual(85);
      expect(p.fit_pct, `page ${i + 1}`).toBeLessThanOrEqual(100);
      expect(p.doc.items.filter((it: any) => it.image)).toHaveLength(1); // the lead photo
      if (i > 0) expect(p.doc.furniture.strip[0]).toBe(SECTIONS[i]);
      expect(p.doc.furniture.strip[1]).toBe("நவம்பர் 24, 2026");
    });
    console.log("stack plan: " + pages.map((p) => `p${p.no} ${p.fit_pct}%`).join(" "));
  }, 300_000);

  it("screen PDF from the worker: both Tamil fonts embedded, the headline of every story in the text layer", async () => {
    const x = await call("POST", `/v1/editions/${editionId}/exports`, { cookie: ana, body: { format: "pdf_screen", build_epaper: false } });
    expect(x.status, JSON.stringify(x.json)).toBe(202);
    const done = await until("pdf done", async () => { const r = await call("GET", `/v1/exports/${x.json.id}`, { cookie: ana }); if (r.json.status === "failed") throw new Error(JSON.stringify(r.json.log)); return r.json.status === "done" ? r.json : undefined; });
    const dl = await call("GET", done.url, { cookie: ana });
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("application/pdf");
    const fonts = pdfFonts(dl.buf);
    expect(fonts.every((f) => f.emb), JSON.stringify(fonts)).toBe(true);
    expect(fonts.some((f) => /NotoSerifTamil/.test(f.name)) && fonts.some((f) => /AnekTamil/.test(f.name))).toBe(true);
    const text = squash(pdfWords(dl.buf).map((w) => w.text).join(""));
    let n = 0;
    for (const p of pages) for (const it of p.doc.items) { expect(text, `headline ${it.text.head}`).toContain(squash(it.text.head)); n++; }
    expect(n).toBe(40);
  }, 300_000);

  it("IDML export: a job makes one zip with the .idml and the photos in Links/, stored once, downloadable, valid", async () => {
    const x = await call("POST", `/v1/editions/${editionId}/exports`, { cookie: ana, body: { format: "idml" } });
    expect(x.status, JSON.stringify(x.json)).toBe(202);
    const done = await until("idml done", async () => { const r = await call("GET", `/v1/exports/${x.json.id}`, { cookie: ana }); if (r.json.status === "failed") throw new Error(JSON.stringify(r.json.log)); return r.json.status === "done" ? r.json : undefined; });
    expect(done.format).toBe("idml");
    expect(done.log.map((l: any) => l.msg).join("\n")).toMatch(/InDesign package written: 8 pages, 8 linked photos/);
    const dl = await call("GET", done.url, { cookie: ana });
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("application/zip");
    expect(dl.headers.get("content-disposition")).toMatch(new RegExp(`filename="${slug}_2026-11-24\\.zip"`));
    const zip = await JSZip.loadAsync(dl.buf);
    const names = Object.keys(zip.files);
    expect(names).toContain(`${slug}_2026-11-24.idml`);
    expect(names.filter((n) => n.startsWith("Links/") && !zip.files[n]!.dir)).toHaveLength(8);
    const idml = await zip.file(`${slug}_2026-11-24.idml`)!.async("uint8array");
    const snap = (await call("GET", `/v1/exports/${x.json.id}/snapshot`, { cookie: ana })).json;
    const rep = await validateIdml(idml, snap);
    expect(rep.problems).toEqual([]);
    expect(rep.maxGeometryDeltaPt).toBeLessThan(0.1);
    const z2 = await JSZip.loadAsync(idml);
    const stories = (await Promise.all(Object.keys(z2.files).filter((f) => f.startsWith("Stories/")).map((f) => z2.file(f)!.async("string")))).join("");
    for (const p of pages) for (const it of p.doc.items) expect(stories).toContain(it.text.head);
    expect(await z2.file("Resources/Fonts.xml")!.async("string")).toContain('Name="Anek Tamil"');
    expect(await z2.file("Resources/Styles.xml")!.async("string")).toContain("HL Composer Optyca");
    // make it again: a second export of the same edition is a new row but the same stored file (write once, never overwritten)
    const y = await call("POST", `/v1/editions/${editionId}/exports`, { cookie: ana, body: { format: "idml" } });
    const done2 = await until("second idml", async () => { const r = await call("GET", `/v1/exports/${y.json.id}`, { cookie: ana }); return r.json.status === "done" ? r.json : undefined; });
    const dl2 = await call("GET", done2.url, { cookie: ana });
    expect(Buffer.compare(dl2.buf, dl.buf)).toBe(0);
    const list = await call("GET", `/v1/editions/${editionId}/exports`, { cookie: ana });
    expect(list.json.items.filter((i: any) => i.format === "idml")).toHaveLength(2);
  }, 300_000);

  it("the press PDF still says plainly that it is not built", async () => {
    const r = await call("POST", `/v1/editions/${editionId}/exports`, { cookie: ana, body: { format: "pdf_press" } });
    expect(r.status).toBe(501);
    expect(r.json.message).toMatch(/phase 2/);
  });
});
