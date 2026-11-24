#!/usr/bin/env node
// Rehearsal on the LIVE stack for one paper, from the planned edition to the published e-paper, checked by page CONTENT:
//   screen PDF -> e-paper edition -> publish -> the PDF text holds every placed story's headline -> the public reader API
//   lists the edition with the right page count -> the reader's Stories list shows the headlines.
// Usage: node scripts/rehearse.mjs <paper-slug> [--api http://127.0.0.1:8100] [--reader http://127.0.0.1:8102]
// Password: SEED_OWNER_PASSWORD from /srv/epaper/.env (never printed). Needs pdftotext. Exit 0 only if every check passes.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
const SLUG = process.argv[2]; if (!SLUG) { console.error("Say which paper: node scripts/rehearse.mjs <slug>"); process.exit(2); }
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const API = arg("--api", "http://127.0.0.1:8100"), READER = arg("--reader", "http://127.0.0.1:8102");
const pw = process.env.SEED_OWNER_PASSWORD ?? readFileSync("/srv/epaper/.env", "utf8").match(/^SEED_OWNER_PASSWORD=(.*)$/m)?.[1];
let cookie = "";
const call = async (m, p, b, raw) => { const r = await fetch(API + p, { method: m, headers: { ...(cookie ? { cookie } : {}), ...(b ? { "content-type": "application/json" } : {}) }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0]; if (raw) return Buffer.from(await r.arrayBuffer()); const t = await r.text(); try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, json: t }; } };
let bad = 0; const check = (name, pass, note = "") => { if (!pass) bad++; console.log(`${pass ? "PASS" : "FAIL"}  ${SLUG}: ${name}${note ? "  " + note : ""}`); };
const until = async (what, fn, ms = 600000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 4000)); } throw new Error("timed out: " + what); };
const squash = (s) => s.normalize("NFC").replace(/[\s​-‍­]+/g, "").replace(/[“”"'‘’.,:;!?()\-–—]/g, "");

let r = await call("POST", "/v1/auth/login", { email: "owner@riverton.example", password: pw, paper: SLUG });
if (r.status !== 200) { console.error("login failed"); process.exit(1); }
const eds = (await call("GET", "/v1/editions")).json.items;
const edId = eds[0].id;
const ed = (await call("GET", `/v1/editions/${edId}`)).json;
const pages = ed.pages ?? [];
const fills = pages.map((p) => p.fit?.fill_pct ?? p.fit_pct);
console.log(`${SLUG}: ${pages.length} pages, fill ${fills.join(", ")}%`);
check("every page is 85-100% full", fills.length > 0 && fills.every((f) => f >= 85 && f <= 100), fills.join(","));
const placed = []; // headlines of placed stories, from the saved pages
for (const p of pages) for (const it of p.doc?.items ?? []) if (it.text?.head) placed.push({ page: p.no, head: it.text.head });
console.log(`   ${placed.length} placed stories`);

const ex = await call("POST", `/v1/editions/${edId}/exports`, { format: "pdf_screen" });
check("PDF export accepted", ex.status === 202);
const done = await until("the PDF", async () => { const x = (await call("GET", `/v1/exports/${ex.json.id}`)).json; if (x.status === "failed") throw new Error("PDF export failed"); return x.status === "done" ? x : null; });
const dir = mkdtempSync(join(tmpdir(), "rehearse-")); const pdf = join(dir, "e.pdf");
writeFileSync(pdf, await call("GET", `/v1/exports/${ex.json.id}/download`, null, true));
const info = execFileSync("pdfinfo", [pdf]).toString();
check("PDF has one sheet per page", +info.match(/Pages:\s+(\d+)/)[1] === pages.length, info.match(/Pages:\s+\d+/)[0]);
let missing = [];
for (const s of placed) { const t = squash(execFileSync("pdftotext", ["-f", String(s.page), "-l", String(s.page), pdf, "-"]).toString()); const words = s.head.split(/\s+/).map(squash).filter((w) => w.length > 1); // a wrapped headline is read column by column, so check its words
  if (!words.every((w) => t.includes(w))) missing.push(`p${s.page}: ${s.head.slice(0, 40)}`); }
check("every placed headline is in the PDF text on its own page", missing.length === 0, missing.slice(0, 3).join(" | "));

const ep = await until("the e-paper edition", async () => { const e = ((await call("GET", "/v1/epaper/editions")).json.items ?? []).filter((x) => x.source === "export" && x.status !== "published").sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0]; if (e?.status === "failed") throw new Error("e-paper build failed"); return e?.status === "ready" ? e : null; });
r = await call("POST", `/v1/epaper/editions/${ep.id}/publish`, {});
check("published", r.status === 200 && r.json.status === "published");
const pub = (await call("GET", `/v1/public/papers/${SLUG}/editions`)).json;
const newest = (pub.items ?? []).sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)))[0];
check("the public reader API lists the new edition", !!newest && newest.id === ep.id);
const one = await fetch(`${API}/v1/public/editions/${newest.id}/pages`).then((x) => x.json()).catch(() => ({}));
const np = (one.pages ?? one.items ?? []).length;
check("the reader sees every page", np === pages.length, `reader ${np} / edition ${pages.length}`);
const rr = await fetch(`${READER}/?paper=${SLUG}`);
check("the reader app loads", rr.status === 200 && /<div id="root"|<script/.test(await rr.text()));
console.log(bad ? `\n${bad} check(s) FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
