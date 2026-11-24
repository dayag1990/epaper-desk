import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loginCookie, mkStack, post, get, type Stack } from "./helpers.js";

async function ready() {
  const s = mkStack();
  const cookie = await loginCookie(s);
  s.docker.images = ["epaper/api:2026-11-21.1", "epaper/worker:2026-11-21.1", "epaper/api:2026-11-21.2", "epaper/worker:2026-11-21.2", "epaper/api:2026-11-20.1", "epaper/worker:2026-11-20.1"];
  return { s, cookie };
}
const states = (s: Stack) => JSON.stringify([...s.docker.containers.values()].map((c) => [c.name, c.state, c.health, c.image]));

describe("restart buttons are safe to press twice", () => {
  it("restart a stopped service: it comes back; pressing again leaves it running", async () => {
    const { s, cookie } = await ready();
    s.docker.stop("worker");
    const a = await post(s, cookie, "/ops/services/worker/restart");
    expect(a.statusCode).toBe(200);
    expect(a.json().message).toMatch(/healthy/);
    const after1 = states(s).replace(/"startedAt[^,]*/g, "");
    const b = await post(s, cookie, "/ops/services/worker/restart");
    expect(b.statusCode).toBe(200);
    expect(JSON.parse(states(s)).map((x: string[]) => x.slice(0, 3))).toEqual(JSON.parse(after1).map((x: string[]) => x.slice(0, 3)));
  });
  it("bring everything up names compose services (not container names), also for containers that do not exist yet", async () => {
    const { s, cookie } = await ready();
    s.docker.containers.clear();
    const orig = s.docker.up.bind(s.docker);
    s.docker.up = async (o) => { await orig(o); for (const n of o.services ?? []) s.docker.add(n); };
    const r = await post(s, cookie, "/ops/up");
    expect(r.statusCode).toBe(200);
    expect(s.docker.upCalls.map((u) => u.services!.join(","))).toEqual(["postgres", "api", "worker", "caddy", "backup"]);
  });
  it("two presses at the same moment run one restart", async () => {
    const { s, cookie } = await ready();
    const orig = s.docker.restart.bind(s.docker);
    s.docker.restart = async (n: string) => { await new Promise((r) => setTimeout(r, 60)); return orig(n); };
    const [a, b] = await Promise.all([post(s, cookie, "/ops/services/api/restart"), post(s, cookie, "/ops/services/api/restart")]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(s.docker.calls.filter((c) => c === "restart epaper-api").length).toBe(1);
  });
  it("a service that never comes back says so in plain words (and 502)", async () => {
    const { s, cookie } = await ready();
    s.docker.stayBroken.add("api");
    const r = await post(s, cookie, "/ops/services/api/restart");
    expect(r.statusCode).toBe(502);
    expect(r.json().error).toMatch(/did not come back healthy/);
  });
  it("the database is given 60 s to close cleanly, and a service outside the project is refused", async () => {
    const { s, cookie } = await ready();
    const spy: number[] = [];
    const orig = s.docker.restart.bind(s.docker);
    s.docker.restart = async (n: string, t?: number) => { spy.push(t ?? 10); return orig(n); };
    await post(s, cookie, "/ops/services/postgres/restart");
    expect(spy).toEqual([60]);
    const r = await post(s, cookie, "/ops/services/nonsense/restart");
    expect(r.statusCode).toBe(404);
    expect(r.json().error).toMatch(/no service called/);
    expect(r.json().error).not.toMatch(/Error|undefined|stack/);
  });
  it("restart all goes in order (database first) and waits; twice is the same", async () => {
    const { s, cookie } = await ready();
    const a = await post(s, cookie, "/ops/restart-all");
    expect(a.json().order).toEqual(["postgres", "api", "worker", "proxy", "backup-service"]);
    const order = s.docker.calls.filter((c) => c.startsWith("restart")).map((c) => c.replace("restart epaper-", ""));
    expect(order).toEqual(["postgres", "api", "worker", "caddy", "backup"]);
    const b = await post(s, cookie, "/ops/restart-all");
    expect(b.statusCode).toBe(200);
    expect(b.json().order).toEqual(a.json().order);
  });
  it("bring everything up creates a missing container and is a no-op when all is running", async () => {
    const { s, cookie } = await ready();
    s.docker.containers.delete("epaper-worker");
    const orig = s.docker.up.bind(s.docker);
    s.docker.up = async (o) => { await orig(o); s.docker.add("worker"); };
    expect((await post(s, cookie, "/ops/up")).statusCode).toBe(200);
    expect(s.docker.containers.get("epaper-worker")?.state).toBe("running");
    const before = states(s);
    expect((await post(s, cookie, "/ops/up")).statusCode).toBe(200);
    expect(JSON.parse(states(s)).map((x: string[]) => x[1])).toEqual(JSON.parse(before).map((x: string[]) => x[1]));
  });
  it("restarting the desk itself answers first, then restarts", async () => {
    const { s, cookie } = await ready();
    const r = await post(s, cookie, "/ops/services/ops/restart");
    expect(r.statusCode).toBe(200);
    expect(r.json().message).toMatch(/restarting itself/);
  });
});

describe("rollback", () => {
  it("refuses without the typed word and takes no snapshot, changes nothing", async () => {
    const { s, cookie } = await ready();
    const r = await post(s, cookie, "/ops/releases/2026-11-21.1/rollback", {});
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/type the word ROLLBACK/);
    expect(s.backup.calls).toEqual([]);
    expect(s.docker.upCalls).toEqual([]);
    expect(s.releases.current()).toBeNull();
    expect((await post(s, cookie, "/ops/releases/2026-11-21.1/rollback", { confirm: "nope" })).statusCode).toBe(400);
  });
  it("snapshots FIRST, then repoints and brings up; twice is the same state", async () => {
    const { s, cookie } = await ready();
    const calls: string[] = [];
    const snap = s.backup.snapshot.bind(s.backup);
    s.backup.snapshot = async (r: string) => { calls.push("snapshot"); return snap(r); };
    const up = s.docker.up.bind(s.docker);
    s.docker.up = async (o) => { calls.push("up"); return up(o); };
    const a = await post(s, cookie, "/ops/releases/2026-11-21.1/rollback", { confirm: "rollback" });
    expect(a.statusCode).toBe(200);
    expect(calls).toEqual(["snapshot", "up"]);
    expect(s.releases.current()).toBe("2026-11-21.1");
    expect(s.docker.upCalls[0]).toEqual({ services: ["api", "worker"], env: { EPAPER_RELEASE: "2026-11-21.1" } });
    const b = await post(s, cookie, "/ops/releases/2026-11-21.1/rollback", { confirm: "ROLLBACK" });
    expect(b.statusCode).toBe(200);
    expect(b.json().already).toBe(true);
    expect(calls).toEqual(["snapshot", "up"]);
  });
  it("no snapshot, no rollback", async () => {
    const { s, cookie } = await ready();
    s.backup.failSnapshot = "bucket unreachable";
    const r = await post(s, cookie, "/ops/releases/2026-11-21.1/rollback", { confirm: "ROLLBACK" });
    expect(r.statusCode).toBe(503);
    expect(r.json().error).toMatch(/Nothing was changed/);
    expect(s.docker.upCalls).toEqual([]);
    expect(s.releases.current()).toBeNull();
  });
  it("only the last 5 complete releases are offered; unknown tags are refused", async () => {
    const { s, cookie } = await ready();
    s.docker.images.push("epaper/api:2026-11-19.9"); // no worker image: not a usable release
    for (let i = 1; i <= 6; i++) s.docker.images.push(`epaper/api:2026-11-1${i}.1`, `epaper/worker:2026-11-1${i}.1`);
    const list = (await get(s, cookie, "/ops/releases")).json();
    expect(list.kept.length).toBe(5);
    expect(list.kept).not.toContain("2026-11-19.9");
    const r = await post(s, cookie, "/ops/releases/2020-01-01.1/rollback", { confirm: "ROLLBACK" });
    expect(r.statusCode).toBe(404);
    expect((await post(s, cookie, "/ops/releases/..%2Fevil/rollback", { confirm: "ROLLBACK" })).statusCode).toBe(400);
  });
  it("a broken release backs itself out to the previous one", async () => {
    const { s, cookie } = await ready();
    s.releases.setCurrent("2026-11-21.2");
    s.docker.stayBroken.add("worker");
    const r = await post(s, cookie, "/ops/releases/2026-11-21.1/rollback", { confirm: "ROLLBACK" });
    expect(r.statusCode).toBe(502);
    expect(r.json().error).toMatch(/went back to 2026-11-21.2/);
    expect(s.releases.current()).toBe("2026-11-21.2");
    expect(s.docker.upCalls.at(-1)?.env.EPAPER_RELEASE).toBe("2026-11-21.2");
  });
});

describe("free disk space", () => {
  function layout(root: string) {
    const f = path.join(root, "files");
    const mk = (p: string, n = 1000) => { fs.mkdirSync(path.dirname(path.join(f, p)), { recursive: true }); fs.writeFileSync(path.join(f, p), "x".repeat(n)); };
    mk("paper1/2026-11-23/original/a.pdf"); mk("paper1/2026-11-23/exports/e.pdf", 5000); mk("paper1/2026-11-23/derived/w400.webp", 3000);
    mk("_cache/thumb.bin", 2000); mk("_ops/users.json"); mk("backups/b1.bin"); mk("paper1/2026-11-23/original/exports/trap.bin");
    return f;
  }
  it("lists first, refuses without CLEAR, then removes only rebuildable copies; second press frees nothing more", async () => {
    const { s, cookie } = await ready();
    const f = layout(s.root);
    const plan = (await get(s, cookie, "/ops/disk/plan")).json();
    expect(plan.items.map((i: { path: string }) => path.relative(f, i.path)).sort()).toEqual(["_cache", "paper1/2026-11-23/derived", "paper1/2026-11-23/exports"]);
    const no = await post(s, cookie, "/ops/disk/clear", {});
    expect(no.statusCode).toBe(400);
    expect(fs.existsSync(path.join(f, "paper1/2026-11-23/exports/e.pdf"))).toBe(true);
    const ok = await post(s, cookie, "/ops/disk/clear", { confirm: "CLEAR" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().freed_bytes).toBeGreaterThanOrEqual(10000);
    expect(fs.existsSync(path.join(f, "paper1/2026-11-23/exports/e.pdf"))).toBe(false);
    for (const keep of ["paper1/2026-11-23/original/a.pdf", "paper1/2026-11-23/original/exports/trap.bin", "_ops/users.json", "backups/b1.bin"]) expect(fs.existsSync(path.join(f, keep)), keep).toBe(true);
    expect(s.docker.calls).toContain("prune-build");
    const again = await post(s, cookie, "/ops/disk/clear", { confirm: "CLEAR" });
    expect(again.statusCode).toBe(200);
    expect(fs.existsSync(path.join(f, "paper1/2026-11-23/original/a.pdf"))).toBe(true);
  });
});

describe("failed jobs and queues", () => {
  it("retries through the API when it is healthy; twice is the same", async () => {
    const { s, cookie } = await ready();
    const a = await post(s, cookie, "/ops/jobs/retry", {});
    expect(a.json().retried).toBe(3);
    const b = await post(s, cookie, "/ops/jobs/retry", {});
    expect(b.statusCode).toBe(200);
    expect(b.json().message).toMatch(/no failed jobs/);
    expect((await post(s, cookie, "/ops/queues/export/pause")).statusCode).toBe(200);
    expect((await post(s, cookie, "/ops/queues/export/pause")).statusCode).toBe(200);
    expect(s.api.stats?.queues[0]?.paused).toBe(true);
    await post(s, cookie, "/ops/queues/export/resume");
    expect(s.api.stats?.queues[0]?.paused).toBe(false);
  });
  it("does NOT call the API when it is down, and says why", async () => {
    const { s, cookie } = await ready();
    s.docker.stop("api");
    const r = await post(s, cookie, "/ops/jobs/retry", {});
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/API is down/);
    expect(r.json().error).toMatch(/Fix the API first/);
    expect(s.api.calls).toEqual([]);
  });
});

describe("logs", () => {
  it("masks secrets and respects the tail", async () => {
    const { s, cookie } = await ready();
    s.docker.logsText.set("epaper-api", ["line1", "BACKUP_S3_SECRET=abc123supersecret", "Authorization: Bearer abcdef1234567890abcdef", "postgres://epaper:hunter2@postgres/db", "last"].join("\n"));
    const r = await get(s, cookie, "/ops/services/api/logs?tail=4");
    const t = r.json().text as string;
    expect(t).not.toMatch(/abc123supersecret|abcdef1234567890|hunter2|line1/);
    expect(t).toMatch(/last/);
    expect((await get(s, cookie, "/ops/services/api/logs?tail=0")).statusCode).toBe(400);
  });
});

describe("backups, restore and the ops log", () => {
  it("db restore: confirm first, snapshot before restore, switch needs its own word, all idempotent", async () => {
    const { s, cookie } = await ready();
    const to = "2026-11-21T01:58:00+05:30";
    const no = await post(s, cookie, "/ops/db/restore", { to });
    expect(no.statusCode).toBe(400);
    expect(s.backup.calls).toEqual([]);
    const a = await post(s, cookie, "/ops/db/restore", { to, confirm: "RESTORE" });
    expect(a.statusCode).toBe(200);
    expect(a.json().counts[0]).toEqual({ table: "articles", live: 120, restored: 118 });
    expect(s.backup.calls[0]).toMatch(/^snapshot before db restore/);
    expect(s.backup.calls[1]).toMatch(/^restoreDb/);
    const id = a.json().id as string;
    const again = await post(s, cookie, "/ops/db/restore", { to, confirm: "RESTORE" });
    expect(again.json().id).toBe(id);
    expect(s.backup.calls.filter((c) => c.startsWith("snapshot")).length).toBe(1); // no second safety copy, no second build
    expect(again.json().counts[0]).toEqual({ table: "articles", live: 120, restored: 118 });
    expect((await post(s, cookie, `/ops/db/restore/${id}/switch`, {})).statusCode).toBe(400);
    expect((await post(s, cookie, `/ops/db/restore/${id}/switch`, { confirm: "SWITCH" })).statusCode).toBe(200);
    expect((await post(s, cookie, `/ops/db/restore/${id}/switch`, { confirm: "SWITCH" })).json().already).toBe(true);
    expect(s.backup.calls.filter((c) => c.startsWith("switch")).length).toBe(1);
    expect((await post(s, cookie, "/ops/db/restore/nope/switch", { confirm: "SWITCH" })).statusCode).toBe(404);
    expect((await post(s, cookie, "/ops/db/restore", { to: "yesterday", confirm: "RESTORE" })).statusCode).toBe(400);
  });
  it("after a switch the api and worker are restarted, and every later `up` keeps the database on the restored folder", async () => {
    const { s, cookie } = await ready();
    const to = "2026-11-21T01:58:00+05:30";
    const id = (await post(s, cookie, "/ops/db/restore", { to, confirm: "RESTORE" })).json().id as string;
    s.docker.calls.length = 0;
    // the switch program writes this pointer file; the desk must carry it on every compose call from then on
    fs.mkdirSync(s.cfg.stateDir, { recursive: true });
    fs.writeFileSync(path.join(s.cfg.stateDir, "pgdata-source"), "/srv/epaper/restores/r1/pgdata\n");
    const r = await post(s, cookie, `/ops/db/restore/${id}/switch`, { confirm: "SWITCH" });
    expect(r.statusCode).toBe(200);
    expect(r.json().message).toMatch(/restarted and are healthy/);
    expect(s.docker.calls.filter((c) => c.startsWith("restart epaper-")).length).toBeGreaterThanOrEqual(3);
    s.docker.containers.delete("epaper-api");
    const orig = s.docker.up.bind(s.docker);
    s.docker.up = async (o) => { await orig(o); for (const n of o.services ?? []) if (!s.docker.containers.has(`epaper-${n}`)) s.docker.add(n); };
    await post(s, cookie, "/ops/up");
    await post(s, cookie, "/ops/releases/2026-11-21.1/rollback", { confirm: "ROLLBACK" });
    expect(s.docker.upCalls.length).toBeGreaterThanOrEqual(2);
    for (const u of s.docker.upCalls) expect(u.env.PGDATA_SOURCE).toBe("/srv/epaper/restores/r1/pgdata");
  });
  it("files restore needs the word and a snapshot", async () => {
    const { s, cookie } = await ready();
    const at = "2026-11-21T01:58:00Z";
    expect((await post(s, cookie, "/ops/files/restore", { scope: "all", at })).statusCode).toBe(400);
    expect(s.backup.calls).toEqual([]);
    expect((await post(s, cookie, "/ops/files/restore", { scope: "all", at, confirm: "RESTORE" })).statusCode).toBe(200);
    expect(s.backup.calls[0]).toMatch(/^snapshot/);
    expect(s.backup.calls[1]).toBe(`restoreFiles all ${at}`);
  });
  it("back up now and verify call the driver; every press, even a refused one, is in the ops log", async () => {
    const { s, cookie } = await ready();
    await post(s, cookie, "/ops/backups/run");
    await post(s, cookie, "/ops/backups/verify");
    await post(s, cookie, "/ops/releases/2026-11-21.1/rollback", {});
    const log = (await get(s, cookie, "/ops/log")).json().entries as { action: string; result: string }[];
    expect(log.map((l) => `${l.action}:${l.result}`)).toEqual(expect.arrayContaining(["back up now:ok", "verify backups:ok", "rollback:refused"]));
    expect(s.backup.calls).toEqual(expect.arrayContaining(["run", "verify"]));
  });
});
