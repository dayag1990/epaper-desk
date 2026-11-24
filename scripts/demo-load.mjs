#!/usr/bin/env node
// Loads the English demo into a RUNNING stack through the public API, exactly as an owner would:
// wizard -> source -> sync (15 articles) -> edition -> auto-plan (4 pages) -> screen PDF -> e-paper -> publish.
// Safe to re-run: the source, the edition and the e-paper edition are reused when they already exist.
// Usage: node scripts/demo-load.mjs [--site http://demo-site:8190] [--paper riverton-herald] [--api http://127.0.0.1:8100]
// The owner password is read from SEED_OWNER_PASSWORD in /srv/epaper/.env (or the environment). It is never printed.
import { readFileSync } from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const API = arg("--api", "http://127.0.0.1:8100");
const SLUG = arg("--paper", "riverton-herald");
const SITE = arg("--site", "http://demo-site:8190"); // must be reachable from inside the api container
const EMAIL = arg("--email", process.env.SEED_OWNER_EMAIL ?? "owner@riverton.example");
const TEMPLATE = arg("--template", "broadsheet-en");
const PAGES = Number(arg("--pages", "4")); // 0 = one page per section (the template's section order)
const MIN = Number(arg("--min", "15"));
const SRCNAME = arg("--name", "Riverton Herald (demo site)");
const FEED = process.argv.includes("--feed"); // ingest the site's RSS feed itself (reachable inside the compose network)
const DATE = arg("--date", new Date().toISOString().slice(0, 10));
let password = process.env.SEED_OWNER_PASSWORD;
if (!password) {
  try { password = readFileSync(process.env.EPAPER_ENV ?? "/srv/epaper/.env", "utf8").match(/^SEED_OWNER_PASSWORD=(.*)$/m)?.[1]; } catch {}
}
if (!password) { console.error("No owner password: set SEED_OWNER_PASSWORD in /srv/epaper/.env."); process.exit(2); }

let cookie = "";
async function call(method, path, body) {
  const r = await fetch(API + path, { method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}
const step = (n, msg) => console.log(`${String(n).padStart(2)}. ${msg}`);
const fail = (msg, r) => { console.error(`FAILED: ${msg}${r ? ` (HTTP ${r.status}: ${JSON.stringify(r.json).slice(0, 300)})` : ""}`); process.exit(1); };
async function until(what, fn, ms = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 1500)); }
  fail(`timed out waiting for ${what}`);
}
const t0 = Date.now(); const secs = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

let r = await call("POST", "/v1/auth/login", { email: EMAIL, password, paper: SLUG });
if (r.status !== 200) fail("login", r);
step(1, `signed in to ${SLUG}`);

r = await call("POST", "/v1/sources/wizard", { url: SITE });
if (r.status !== 200) fail("the mapping wizard could not read the demo site", r);
const wiz = r.json;
step(2, `wizard proposed a "${wiz.kind}" source (confidence ${wiz.confidence ?? "n/a"})`);

const existing = (await call("GET", "/v1/sources")).json.items ?? [];
let src = existing.find((s) => s.name === SRCNAME);
if (!src) {
  r = await call("POST", "/v1/sources", FEED ? { kind: "rss", name: SRCNAME, config: { url: SITE.replace(/\/$/, "") + "/rss.xml" } } : { kind: wiz.kind, name: SRCNAME, config: wiz.kind === "scrape" ? { ...wiz.config, max_links: 100 } : wiz.config, mapping: wiz.mapping });
  if (r.status >= 300) fail("could not save the source", r);
  src = r.json;
}
step(3, `source ready`);

const syncedBefore = (await call("GET", `/v1/sources/${src.id}`)).json.last_sync_at ?? null;
r = await call("POST", `/v1/sources/${src.id}/sync`);
if (r.status >= 300) fail("could not start the sync", r);
// wait for THIS sync to finish (a re-run must not race ahead on the articles that are already there)
const synced = await until("the sync to finish", async () => {
  const s = (await call("GET", `/v1/sources/${src.id}`)).json;
  if (String(s.status).startsWith("error")) fail("the sync failed: " + s.status);
  return s.last_sync_at && s.last_sync_at !== syncedBefore && String(s.status).startsWith("ok") ? s : null;
});
const arts = (await call("GET", "/v1/articles")).json.items ?? [];
if (arts.length < MIN) fail(`only ${arts.length} articles after the sync`);
step(4, `${arts.length} articles ingested; ${synced.status} (${secs()})`);

r = await call("POST", "/v1/editions", { paper: SLUG, date: DATE, template_set: TEMPLATE, name: "Main" });
if (r.status >= 300) fail("could not create the edition", r);
const editionId = r.json.id;
r = await call("POST", `/v1/editions/${editionId}/autoplan`, PAGES ? { pages: PAGES } : {});
if (r.status >= 300) fail("auto-plan did not start", r);
const ed = await until("the planned pages", async () => { const e = (await call("GET", `/v1/editions/${editionId}`)).json; return (e.pages ?? []).length >= (PAGES || 8) && e.status !== "planning" ? e : null; });
step(5, `auto-planned ${ed.pages.length} pages (${secs()})`);

r = await call("POST", `/v1/editions/${editionId}/exports`, { format: "pdf_screen" });
if (r.status !== 202) fail("could not start the PDF export", r);
const exportId = r.json.id;
await until("the PDF", async () => {
  const x = (await call("GET", `/v1/exports/${exportId}`)).json;
  if (x.status === "failed") fail("the PDF export failed: " + JSON.stringify(x.log).slice(0, 200));
  return x.status === "done" ? x : null;
});
step(6, `screen PDF built (${secs()})`);

const ep = await until("the e-paper edition", async () => {
  const e = ((await call("GET", "/v1/epaper/editions")).json.items ?? []).find((x) => x.source === "export");
  if (e?.status === "failed") fail("the e-paper build failed");
  return e?.status === "ready" || e?.status === "published" ? e : null;
});
step(7, `e-paper ready (${secs()})`);

r = await call("POST", `/v1/epaper/editions/${ep.id}/publish`, {});
if (r.status !== 200) fail("publish failed", r);
step(8, `published (${secs()})`);

const pub = await call("GET", `/v1/public/papers/${SLUG}/editions`);
const items = pub.json.items ?? [];
console.log(`\nPublic reader sees ${items.length} edition(s) for ${SLUG}: ${items.map((i) => `${i.date} (${i.pages} pages)`).join(", ")}`);
if (!items.length) process.exit(1);
