import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OpsStatusSchema, ServiceListSchema } from "@epaper/core";
import YAML from "yaml";
import { BackupError } from "../src/backup.js";
import { evalExpr, MissingMetric } from "../src/expr.js";
import { REPO_OPS, loginCookie, mkStack, get } from "./helpers.js";

const light = async (s: ReturnType<typeof mkStack>, name: string) => (await s.snapshot(true)).services.find((x) => x.name === name)!;

describe("services.yml and alerts.yml", () => {
  it("services.yml is a valid D9 list with every row the owner asked for", () => {
    const list = ServiceListSchema.parse(YAML.parse(fs.readFileSync(path.join(REPO_OPS, "services.yml"), "utf8")));
    const names = list.map((x) => x.name);
    for (const n of ["api", "worker", "postgres", "ops", "proxy", "reader", "backups", "disk", "memory", "queue-depth", "dead-letter", "last-backup-age", "last-drill", "certificate"]) expect(names).toContain(n);
  });
});

describe("expressions", () => {
  it("evaluates and/or, and reports a missing number instead of guessing", () => {
    expect(evalExpr("a < 5 and b >= 2 or c == 0", { a: 9, b: 9, c: 0 })).toBe(true);
    expect(evalExpr("a < 5 and b >= 2", { a: 9, b: 9 })).toBe(false);
    expect(() => evalExpr("a < 5", {})).toThrow(MissingMetric);
    expect(() => evalExpr("process.exit()", {})).toThrow();
  });
});

describe("lights", () => {
  it("all green on a healthy fake stack", async () => {
    const s = mkStack({ cfgOver: { OPS_HOST: "ops.example.test" } });
    s.api.stats!.dead = 0;
    const snap = await s.snapshot(true);
    const bad = snap.services.filter((x) => x.state !== "green");
    expect(bad.map((b) => `${b.name}:${b.state}:${b.last_error}`)).toEqual([]);
  });

  it("a stopped container is RED in plain words, with what to press, then green after the fix", async () => {
    const s = mkStack();
    const cookie = await loginCookie(s);
    s.docker.stop("worker");
    const w = await light(s, "worker");
    expect(w.state).toBe("red");
    expect(w.plain).toMatch(/The worker \(renders, exports\) is stopped/);
    expect(w.todo).toMatch(/Press 'Fix it'/);
    expect(w.fixes).toContain("restart");
    const st = (await get(s, cookie, "/ops/status")).json();
    expect(st.services.find((x: { name: string }) => x.name === "worker").state).toBe("red");
    expect((await s.app.inject({ method: "POST", url: "/ops/services/worker/restart", headers: { cookie, "x-ops": "1" } })).statusCode).toBe(200);
    expect((await light(s, "worker")).state).toBe("green");
  });

  it("each service in turn: stop it, it is red; one tap brings it back", async () => {
    const s = mkStack();
    const cookie = await loginCookie(s);
    for (const [svc, name] of [["api", "api"], ["worker", "worker"], ["postgres", "postgres"], ["caddy", "proxy"]] as const) {
      s.docker.stop(svc);
      expect((await light(s, name)).state, `${name} red`).toBe("red");
      await s.app.inject({ method: "POST", url: `/ops/services/${name}/restart`, headers: { cookie, "x-ops": "1" } });
      expect((await light(s, name)).state, `${name} green`).toBe("green");
    }
  });

  it("a service that runs but does not answer is red with the reason; dependants point at the root cause", async () => {
    const s = mkStack();
    s.docker.stop("postgres");
    s.docker.containers.set("epaper-api", { ...s.docker.containers.get("epaper-api")!, startedAt: new Date(Date.now() - 600_000).toISOString() });
    s.docker.stayBroken.add("api");
    const snap = await s.snapshot(true);
    const api = snap.services.find((x) => x.name === "api")!;
    expect(api.state).toBe("red");
    expect(api.last_error).toMatch(/says it is not ready \(db: timeout after 5 s\)/);
    expect(api.last_error).toMatch(/waiting on postgres/);
    expect(api.todo).toMatch(/Fix postgres first/);
  });

  it("a freshly started service is amber, not red", async () => {
    const s = mkStack();
    s.docker.containers.set("epaper-api", { ...s.docker.containers.get("epaper-api")!, startedAt: new Date().toISOString() });
    s.down.add("http://api:8100/readyz");
    expect((await light(s, "api")).state).toBe("amber");
  });

  it("a missing container is red; Docker unreachable is red with what to check", async () => {
    const s = mkStack();
    s.docker.containers.delete("epaper-worker");
    expect((await light(s, "worker")).plain).toMatch(/does not exist/);
    s.docker.list = async () => { throw new Error("The desk cannot reach Docker (the socket proxy is not answering)."); };
    const w = await light(s, "api");
    expect(w.state).toBe("red");
    expect(w.todo).toMatch(/dockerproxy/);
  });

  it("missing backup scripts / empty bucket is RED, never hidden", async () => {
    const s = mkStack();
    s.backup.status = async () => { throw new BackupError("The backup program (backup-now.sh) is not installed yet, so this button cannot work. Backups are NOT running."); };
    for (const n of ["backups", "last-backup-age", "last-drill"]) {
      const l = await light(s, n);
      expect(l.state, n).toBe("red");
      expect(l.last_error, n).toMatch(/not installed yet/);
      expect(l.todo, n).toBeTruthy();
    }
    const s2 = mkStack();
    s2.backup.status_ = { files: null, wal: null, base: null, drill: null };
    expect((await light(s2, "backups")).state).toBe("red");
    expect((await light(s2, "last-drill")).plain).toMatch(/no backup record|out of range|cannot read/);
  });

  it("an old backup is amber then red; old drill is red; low disk is red", async () => {
    const s = mkStack();
    const ago = (min: number) => new Date(s.clock.now() - min * 60_000).toISOString();
    // pushes to the bucket run every 15 minutes in the demo phase: green up to 25 min, amber to 40, red after
    s.backup.status_.files = { at: ago(16), size_bytes: 1 };
    expect((await light(s, "last-backup-age")).state).toBe("green");
    s.backup.status_.files = { at: ago(30), size_bytes: 1 };
    expect((await light(s, "last-backup-age")).state).toBe("amber");
    s.backup.status_.files = { at: ago(50), size_bytes: 1 };
    expect((await light(s, "last-backup-age")).state).toBe("red");
    s.backup.status_.drill = { at: ago(8 * 1440), result: "pass" };
    expect((await light(s, "last-drill")).state).toBe("red");
    s.backup.status_.drill = { at: ago(10), result: "fail" };
    expect((await light(s, "last-drill")).state).toBe("red");
  });

  it("memory and queue and failed jobs lights; unknown API numbers are amber, not green", async () => {
    const s = mkStack();
    fs.writeFileSync(path.join(s.cfg.procDir, "meminfo"), "MemTotal: 1000000 kB\nMemAvailable: 50000 kB\n");
    expect((await light(s, "memory")).state).toBe("red");
    expect((await light(s, "dead-letter")).state).toBe("amber"); // 3 failed jobs
    s.api.stats = null;
    expect((await light(s, "queue-depth")).state).toBe("amber");
    expect((await light(s, "queue-depth")).plain).toMatch(/API is not answering/);
  });

  it("missing config (no host name for the certificate) is red and says what to set", async () => {
    const s = mkStack();
    const l = await light(s, "certificate");
    expect(l.state).toBe("red");
    expect(l.last_error).toMatch(/OPS_HOST/);
  });

  it("a broken or missing services.yml is one red row, and the desk still answers", async () => {
    const s = mkStack({ cfgOver: { OPS_SERVICES_FILE: "/nonexistent/services.yml" } });
    const cookie = await loginCookie(s);
    const r = await get(s, cookie, "/ops/status");
    expect(r.statusCode).toBe(200);
    expect(r.json().services[0].state).toBe("red");
    expect(r.json().services[0].last_error).toMatch(/service list/);
  });

  it("GET /ops/status matches the D10 contract", async () => {
    const s = mkStack();
    const cookie = await loginCookie(s);
    const body = (await get(s, cookie, "/ops/status")).json();
    expect(() => OpsStatusSchema.parse(body)).not.toThrow();
    expect(body.release).toBe("dev");
    expect(body.backups.last_drill).toMatch(/^\d{4}-\d{2}-\d{2} pass$/);
  });

  it("the phone page shows the red thing first, in words, with a big button", async () => {
    const s = mkStack();
    const cookie = await loginCookie(s);
    s.docker.stop("worker");
    const page = (await s.app.inject({ method: "GET", url: "/", headers: { cookie } })).body;
    expect(page).toMatch(/name="viewport"/);
    expect(page).toMatch(/need[s]? you/);
    expect(page.indexOf("Needs you")).toBeLessThan(page.indexOf("Working"));
    expect(page).toMatch(/data-post="\/ops\/services\/worker\/restart"/);
    expect(page).toMatch(/data-confirm="ROLLBACK"|No earlier releases/);
    expect(page).not.toMatch(/<script>|onsubmit=|onclick=/); // CSP: no inline script
  });
});

describe("build + log pages", () => {
  it("GET /ops/build shows STATUS.md as readable HTML, with secrets hidden", async () => {
    const s = mkStack();
    const cookie = await loginCookie(s);
    fs.writeFileSync(s.cfg.statusMdFile, "# Build\n## Done\n- **M13** · desk <script>x</script>\nBACKUP_PASSWORD=hunter2hunter2\n");
    const r = await s.app.inject({ method: "GET", url: "/ops/build", headers: { cookie } });
    expect(r.headers["content-type"]).toMatch(/text\/html/);
    expect(r.body).toMatch(/<h2>Build<\/h2>/);
    expect(r.body).toMatch(/<li><b>M13<\/b>/);
    expect(r.body).not.toMatch(/<script>x|hunter2hunter2/);
  });
  it("GET /ops/log lists presses newest first", async () => {
    const s = mkStack();
    const cookie = await loginCookie(s);
    await s.app.inject({ method: "POST", url: "/ops/backups/run", headers: { cookie, "x-ops": "1" } });
    const j = (await get(s, cookie, "/ops/log")).json();
    expect(j.entries[0].action).toBe("back up now");
    const h = await s.app.inject({ method: "GET", url: "/ops/log?html=1", headers: { cookie } });
    expect(h.body).toMatch(/back up now/);
  });
});
