// Integration tests against the running compose stack (127.0.0.1:8100).
// Run `docker compose up -d --build` first. Passwords here are random per run.
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

const API = "http://127.0.0.1:8100";
const dc = (args: string, env = "") => execSync(`sg docker -c "${env}docker compose ${args}"`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], cwd: new URL("..", import.meta.url).pathname });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = () => randomBytes(9).toString("hex");
const run = rnd();
const PW_A = `pw-${rnd()}`, PW_B = `pw-${rnd()}`, PW_V = `pw-${rnd()}`;

function seed(slug: string, email: string, pw: string) {
  dc(`exec -T -e SEED_OWNER_PASSWORD=${pw} -e SEED_PAPER_SLUG=${slug} -e SEED_OWNER_EMAIL=${email} api sh -c 'cd /app && node_modules/.bin/tsx prisma/seed.mts'`);
}
async function call(method: string, path: string, opts: { cookie?: string; body?: unknown; raw?: Buffer } = {}) {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  let body: any;
  if (opts.raw) { headers["content-type"] = "application/octet-stream"; body = opts.raw; }
  else if (opts.body !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(opts.body); }
  const r = await fetch(API + path, { method, headers, body });
  const buf = Buffer.from(await r.arrayBuffer());
  let json: any; try { json = JSON.parse(buf.toString()); } catch {}
  return { status: r.status, json, buf, headers: r.headers };
}
async function login(email: string, password: string, paper?: string) {
  const r = await call("POST", "/v1/auth/login", { body: { email, password, paper } });
  expect(r.status).toBe(200);
  const c = r.headers.get("set-cookie")!.split(";")[0]!;
  return c;
}
async function waitHealthy(ms = 120_000) {
  const t = Date.now();
  for (;;) {
    try {
      const out = dc(`ps --format '{{.Name}} {{.Health}}'`).trim().split("\n");
      if (out.length >= 5 && out.every((l) => l.endsWith(" healthy"))) return out;
    } catch {}
    if (Date.now() - t > ms) throw new Error("stack did not become healthy");
    await sleep(2000);
  }
}

let ownerA: string, ownerB: string;
const emailA = `owner-a-${run}@test.example`, emailB = `owner-b-${run}@test.example`;
const slugA = `a-${run}`, slugB = `b-${run}`;

beforeAll(async () => { await waitHealthy(); });

describe("M0 done_when", () => {
  it("stack is up: api, worker, ops, postgres, proxy all healthy", async () => {
    const out = await waitHealthy();
    expect(out.map((l) => l.split(" ")[0]).sort()).toEqual(["epaper-api", "epaper-caddy", "epaper-ops", "epaper-postgres", "epaper-worker"]);
    const ready = await call("GET", "/readyz");
    expect(ready.json).toEqual({ ok: true, checks: { db: "ok", files: "ok" } });
    expect((await fetch("http://127.0.0.1:8101/healthz")).status).toBe(200);
    expect((await fetch("http://127.0.0.1:8102/healthz")).status).toBe(200);
    expect((await call("GET", "/docs/json")).json.openapi).toBeTruthy();
  });

  it("seed creates the demo paper + owner (password from env)", async () => {
    seed("demo", "owner@demo.example", PW_A); // the real demo seed, idempotent
    seed(slugA, emailA, PW_A);
    seed(slugB, emailB, PW_B);
    ownerA = await login(emailA, PW_A, slugA);
    ownerB = await login(emailB, PW_B, slugB);
    const me = await call("GET", "/v1/auth/me", { cookie: ownerA });
    expect(me.json.paper.slug).toBe(slugA);
    expect(me.json.role).toBe("owner");
    const bad = await call("POST", "/v1/auth/login", { body: { email: emailA, password: "wrong-password" } });
    expect(bad.status).toBe(401);
    expect(bad.json).toMatchObject({ code: "bad_login", details: {} });
  });

  it("a viewer is refused on save; the owner can save", async () => {
    const vEmail = `viewer-${run}@test.example`;
    const add = await call("POST", "/v1/members", { cookie: ownerA, body: { email: vEmail, name: "Vi", password: PW_V + "xxxx", role: "viewer" } });
    expect(add.status).toBe(201);
    const viewer = await login(vEmail, PW_V + "xxxx", slugA);
    const refused = await call("POST", "/v1/sources", { cookie: viewer, body: { kind: "rss", name: "x" } });
    expect(refused.status).toBe(403);
    expect(refused.json.code).toBe("forbidden");
    expect(refused.json.message).toMatch(/Viewers can look but not save/);
    expect((await call("POST", "/v1/files?ext=txt", { cookie: viewer, raw: Buffer.from("no") })).status).toBe(403);
    expect((await call("GET", "/v1/sources", { cookie: viewer })).status).toBe(200); // viewing is fine
    expect((await call("POST", "/v1/sources", { cookie: ownerA, body: { kind: "rss", name: "ok" } })).status).toBe(201);
    expect((await call("POST", "/v1/sources", { body: { kind: "rss", name: "x" } })).status).toBe(401);
  });

  it("a failing job retries 3 times, then lands in the dead-letter list", async () => {
    const ok = await call("POST", "/v1/jobs", { cookie: ownerA, body: { type: "noop" } });
    expect(ok.status).toBe(202);
    const r = await call("POST", "/v1/jobs", { cookie: ownerA, body: { type: "always-fail", idempotency_key: `fail-${run}` } });
    expect(r.status).toBe(202);
    const id = r.json.id as string;
    let st: any;
    const t = Date.now();
    for (;;) {
      st = (await call("GET", `/v1/jobs/${id}`, { cookie: ownerA })).json;
      if (st.state === "failed") break;
      if (Date.now() - t > 120_000) throw new Error("job never reached failed: " + JSON.stringify(st));
      await sleep(1500);
    }
    expect(st.retries).toBe(3);
    let dead: any[] = [];
    for (let i = 0; i < 30 && !dead.length; i++) {
      dead = (await call("GET", "/v1/jobs/dead", { cookie: ownerA })).json.items.filter((d: any) => d.idempotency_key === `fail-${run}`);
      if (!dead.length) await sleep(1000);
    }
    expect(dead).toHaveLength(1);
    expect(dead[0].type).toBe("always-fail");
    // paper B sees nothing of it
    const deadB = (await call("GET", "/v1/jobs/dead", { cookie: ownerB })).json.items;
    expect(deadB.filter((d: any) => d.idempotency_key === `fail-${run}`)).toHaveLength(0);
  });

  it("paper A cannot read paper B's rows or files", async () => {
    const srcB = (await call("POST", "/v1/sources", { cookie: ownerB, body: { kind: "rss", name: "B secret" } })).json;
    const bytesB = Buffer.from("paper B private bytes " + run);
    const fileB = (await call("POST", "/v1/files?kind=original&ext=txt", { cookie: ownerB, raw: bytesB })).json;
    expect(fileB.key.startsWith(fileB.key.split("/")[0])).toBe(true);
    const jobB = (await call("POST", "/v1/jobs", { cookie: ownerB, body: { type: "noop" } })).json;
    // B reads its own
    expect((await call("GET", `/v1/sources/${srcB.id}`, { cookie: ownerB })).status).toBe(200);
    expect((await call("GET", `/v1/files/${fileB.id}`, { cookie: ownerB })).buf.equals(bytesB)).toBe(true);
    // A cannot, by id, by list, or by delete
    expect((await call("GET", `/v1/sources/${srcB.id}`, { cookie: ownerA })).status).toBe(404);
    expect((await call("DELETE", `/v1/sources/${srcB.id}`, { cookie: ownerA })).status).toBe(404);
    expect((await call("GET", `/v1/files/${fileB.id}`, { cookie: ownerA })).status).toBe(404);
    expect((await call("GET", `/v1/jobs/${jobB.id}`, { cookie: ownerA })).status).toBe(404);
    const listA = (await call("GET", "/v1/sources", { cookie: ownerA })).json.items;
    expect(listA.find((s: any) => s.id === srcB.id)).toBeUndefined();
    const filesA = (await call("GET", "/v1/files", { cookie: ownerA })).json.items;
    expect(filesA.find((f: any) => f.id === fileB.id)).toBeUndefined();
    // same bytes uploaded by A become A's own file under A's own folder
    const fileA = (await call("POST", "/v1/files?kind=original&ext=txt", { cookie: ownerA, raw: bytesB })).json;
    expect(fileA.id).not.toBe(fileB.id);
    expect(fileA.key.split("/")[0]).not.toBe(fileB.key.split("/")[0]);
    // B's source is still there
    expect((await call("GET", `/v1/sources/${srcB.id}`, { cookie: ownerB })).status).toBe(200);
  });

  it("stop and start the whole stack: rows, files and queued jobs survive", async () => {
    const src = (await call("POST", "/v1/sources", { cookie: ownerA, body: { kind: "rss", name: "survivor" } })).json;
    const bytes = Buffer.from("survive restart " + run);
    const file = (await call("POST", "/v1/files?kind=original&ext=txt", { cookie: ownerA, raw: bytes })).json;
    const job = (await call("POST", "/v1/jobs", { cookie: ownerA, body: { type: "noop", delay_s: 3600, idempotency_key: `later-${run}` } })).json;
    expect(job.id).toBeTruthy();
    dc("stop");
    dc("start");
    await waitHealthy();
    await sleep(2000);
    const s2 = await call("GET", `/v1/sources/${src.id}`, { cookie: ownerA }); // session survived too
    expect(s2.status).toBe(200);
    expect(s2.json.name).toBe("survivor");
    expect((await call("GET", `/v1/files/${file.id}`, { cookie: ownerA })).buf.equals(bytes)).toBe(true);
    const j = (await call("GET", `/v1/jobs/${job.id}`, { cookie: ownerA })).json;
    expect(j.state).toBe("created");
    // the files really are on the host disk
    expect(execSync(`test -f /srv/epaper/files/${file.key} && echo yes`, { encoding: "utf8" }).trim()).toBe("yes");
  });
});
