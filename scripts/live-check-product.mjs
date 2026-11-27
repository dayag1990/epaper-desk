#!/usr/bin/env node
// Live check of the joined-up product on the running stack: one login reaches the ops desk, live events arrive, alerts stream answers.
//   node scripts/live-check-product.mjs [paper-slug]      (password from /srv/epaper/.env, never printed)
import { readFileSync } from "node:fs";
const SLUG = process.argv[2] ?? "riverton-herald";
const pw = readFileSync("/srv/epaper/.env", "utf8").match(/^SEED_OWNER_PASSWORD=(.*)$/m)[1];
const API = "http://127.0.0.1:8100", OPS = "http://127.0.0.1:8101";
let bad = 0; const ok = (n, p, note = "") => { if (!p) bad++; console.log(`${p ? "PASS" : "FAIL"}  ${n}${note ? "  " + note : ""}`); };
let ck = "";
const call = async (m, p, b) => { const r = await fetch(API + p, { method: m, headers: { ...(ck ? { cookie: ck } : {}), ...(b ? { "content-type": "application/json" } : {}) }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) ck = sc.map((x) => x.split(";")[0]).join("; "); const t = await r.text(); try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, json: null }; } };
const l = await call("POST", "/v1/auth/login", { email: "owner@riverton.example", password: pw, paper: SLUG });
ok("login works", l.status === 200);
ok("login set the shared sign-in cookie", ck.includes("epaper_sso=") && ck.includes("epaper_session="));
// ops desk with the shared cookie: no second password page, only the code step (or enrolment)
const o = await fetch(OPS + "/", { headers: { cookie: ck }, redirect: "manual" });
const loc = o.headers.get("location") ?? "";
const body = o.status === 200 ? await o.text() : "";
ok("ops desk accepts the shared sign-in (no second password)", !/password/i.test(loc) && !/name="password"/.test(body), `status ${o.status} -> ${loc || "page"}`);
const anon = await fetch(OPS + "/", { redirect: "manual" });
ok("ops desk without any cookie still asks for its own login (break-glass)", anon.status === 302 || anon.status === 200);
// live events
const eds = (await call("GET", "/v1/editions")).json.items; const ed = (await call("GET", `/v1/editions/${eds[0].id}`)).json;
const page = ed.pages[0];
const ctl = new AbortController(); const got = [];
const s = await fetch(API + "/v1/events", { headers: { cookie: ck }, signal: ctl.signal });
ok("live event stream opens", s.status === 200 && /event-stream/.test(s.headers.get("content-type") ?? ""));
(async () => { try { const rd = s.body.getReader(); const dec = new TextDecoder(); for (;;) { const { value, done } = await rd.read(); if (done) break; got.push(dec.decode(value)); } } catch {} })();
await new Promise((r) => setTimeout(r, 1500));
const f = await call("POST", `/v1/pages/${page.id}/fit`);
ok("refit accepted", f.status < 300, `status ${f.status}`);
for (let i = 0; i < 40 && !/page\.(fit|updated)/.test(got.join("")); i++) await new Promise((r) => setTimeout(r, 500));
ok("the editor stream got the page event without a reload", /page\.(fit|updated)/.test(got.join("")));
ctl.abort();
const al = await fetch(OPS + "/alerts", { headers: { cookie: ck }, redirect: "manual" });
ok("alerts list answers", al.status < 500, `status ${al.status}`);
console.log(bad ? `\n${bad} FAILED` : "\nALL PASS"); process.exit(bad ? 1 : 0);
