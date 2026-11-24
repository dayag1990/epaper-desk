// Tiny desk client for scripts/ops-drill.sh. Talks to the desk like a phone does: password + 6-digit code, then the same
// HTTP buttons. No terminal tricks, no Docker.  Usage:
//   node desk.mjs enrol                    first-time setup (setup code from env) + login; keeps the cookie in $DESK_STATE
//   node desk.mjs req METHOD PATH [JSON]   prints one JSON line {status, ms, body}
//   node desk.mjs light NAME               prints green|amber|red|unknown
//   node desk.mjs waitlight NAME COLOR S   polls once a second; prints the seconds it took, exit 1 on timeout
//   node desk.mjs up                       exit 0 when the desk answers /healthz
import crypto from "node:crypto";
import fs from "node:fs";

const BASE = process.env.DESK ?? "http://127.0.0.1:18101";
const STATE = process.env.DESK_STATE ?? `${process.env.DRILL_ROOT ?? "/srv/epaper/drill-tmp"}/desk-client.json`;
const SETUP = process.env.OPS_SETUP_CODE ?? "drill-setup-code-0001";
const PASSWORD = "drill password, not a secret 123";
const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function b32(s) { let bits = 0, v = 0; const out = []; for (const c of s.replace(/[\s=-]/g, "").toUpperCase()) { v = (v << 5) | ALPHA.indexOf(c); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
function totp(secret, ms = Date.now()) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(ms / 30000)));
  const h = crypto.createHmac("sha1", b32(secret)).update(msg).digest(); const o = h[h.length - 1] & 15;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0");
}
const load = () => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return {}; } };
const save = (s) => fs.writeFileSync(STATE, JSON.stringify(s), { mode: 0o600 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cookieOf = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

async function req(method, path, body, cookie) {
  const t0 = performance.now();
  const r = await fetch(BASE + path, { method, redirect: "manual", signal: AbortSignal.timeout(300_000), headers: { accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(method !== "GET" ? { "x-ops": "1" } : {}), ...(cookie ? { cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, ms: Math.round(performance.now() - t0), body: json, headers: r.headers };
}

async function login(st) {
  for (let i = 0; i < 4; i++) {
    const r = await req("POST", "/login", { password: PASSWORD, code: totp(st.secret) });
    if (r.status === 200) { st.cookie = cookieOf({ headers: r.headers }); save(st); return st; }
    await sleep(8000); // a code can be used once: wait for the next 30 s step
  }
  throw new Error("cannot log in to the desk");
}
async function session() {
  const st = load();
  if (st.cookie) { const r = await req("GET", "/ops/status", undefined, st.cookie); if (r.status === 200) return st; }
  if (!st.secret) throw new Error("the desk is not enrolled; run: desk.mjs enrol");
  return login(st);
}

const [cmd, ...a] = process.argv.slice(2);
try {
  if (cmd === "up") { const r = await req("GET", "/healthz"); process.exit(r.status === 200 ? 0 : 1); }
  else if (cmd === "enrol") {
    const st = load();
    if (!st.secret) {
      const form = (o) => new URLSearchParams(o).toString();
      const r1 = await fetch(BASE + "/setup", { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ setup: SETUP, password: PASSWORD }) });
      const html = await r1.text();
      const secret = /class="codes">([A-Z2-7]{32})</.exec(html)?.[1];
      if (!secret) throw new Error(`setup refused (${r1.status}): ${html.replace(/<[^>]+>/g, " ").slice(0, 200)}`);
      const ck = cookieOf(r1);
      const r2 = await fetch(BASE + "/setup/confirm", { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", cookie: ck }, body: form({ code: totp(secret) }) });
      if (r2.status !== 302) throw new Error(`setup confirm failed (${r2.status})`);
      save({ secret });
      await sleep(31000); // the enrolment code is used up: log in on the next step
    }
    await login(load());
    console.log("enrolled and logged in");
  } else {
    const st = await session();
    if (cmd === "req") { const r = await req(a[0], a[1], a[2] ? JSON.parse(a[2]) : a[0] === "GET" ? undefined : {}, st.cookie); console.log(JSON.stringify({ status: r.status, ms: r.ms, body: r.body })); }
    else if (cmd === "light") { const r = await req("GET", "/ops/status", undefined, st.cookie); console.log(r.body?.services?.find((s) => s.name === a[0])?.state ?? "unknown"); }
    else if (cmd === "waitlight") {
      const t0 = Date.now(), limit = Number(a[2] ?? 60) * 1000; let last = "";
      for (;;) {
        const r = await req("GET", "/ops/status", undefined, st.cookie).catch(() => null);
        last = r?.body?.services?.find((s) => s.name === a[0])?.state ?? "unknown";
        if (last === a[1]) { console.log(((Date.now() - t0) / 1000).toFixed(1)); process.exit(0); }
        if (Date.now() - t0 > limit) { console.error(`light ${a[0]} stayed ${last}`); process.exit(1); }
        await sleep(1000);
      }
    } else throw new Error("unknown command");
  }
} catch (e) { console.error(String(e.message ?? e)); process.exit(2); }
