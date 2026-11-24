import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BackupError, ScriptBackupDriver } from "../src/backup.js";
import { SocketProxyDocker } from "../src/docker.js";
import { HttpApiClient } from "../src/api-client.js";
import { tmp } from "./helpers.js";

function frame(type: number, s: string) { const b = Buffer.from(s); const h = Buffer.alloc(8); h[0] = type; h.writeUInt32BE(b.length, 4); return Buffer.concat([h, b]); }

describe("SocketProxyDocker (the real driver, against a fake socket proxy)", () => {
  let srv: http.Server, base = "";
  const seen: string[] = [];
  beforeAll(async () => {
    srv = http.createServer((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      const u = req.url!;
      const json = (o: unknown, c = 200) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
      if (u.startsWith("/containers/json")) return json([{ Id: "abc", Names: ["/epaper-api"], Labels: { "com.docker.compose.service": "api" } }]);
      if (u === "/containers/abc/json") return json({ Name: "/epaper-api", Config: { Image: "epaper/api:dev" }, State: { Status: "running", StartedAt: "2026-11-23T10:00:00Z", FinishedAt: "0001-01-01T00:00:00Z", ExitCode: 0, Health: { Status: "healthy" } } });
      if (u.startsWith("/containers/epaper-api/restart")) { res.writeHead(204); return res.end(); }
      if (u.startsWith("/containers/epaper-api/logs")) { res.writeHead(200); return res.end(Buffer.concat([frame(1, "hello out\n"), frame(2, "oops err\n")])); }
      if (u === "/images/json") return json([{ RepoTags: ["epaper/api:2026-11-21.1", "x/y:z"] }, { RepoTags: null }]);
      if (u === "/build/prune") return json({ SpaceReclaimed: 1234 });
      if (u.startsWith("/images/prune")) return json({ SpaceReclaimed: 10 });
      if (u.startsWith("/containers/other")) { res.writeHead(403); return res.end("forbidden"); }
      res.writeHead(404); res.end();
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  });
  afterAll(() => srv.close());

  it("lists only the epaper project, restarts with a timeout, demuxes logs, lists images, prunes", async () => {
    const execs: { args: string[]; env: Record<string, string> }[] = [];
    const d = new SocketProxyDocker({ host: base, project: "epaper", composeFiles: ["/a.yml", "/b.yml"], exec: async (_f, args, env) => { execs.push({ args, env }); return { stdout: "", stderr: "" }; } });
    const list = await d.list();
    expect(list).toEqual([expect.objectContaining({ name: "epaper-api", service: "api", state: "running", health: "healthy", image: "epaper/api:dev" })]);
    expect(seen.find((s) => s.startsWith("GET /containers/json"))).toContain(encodeURIComponent("com.docker.compose.project=epaper"));
    await d.restart("epaper-api", 60);
    expect(seen).toContain("POST /containers/epaper-api/restart?t=60");
    expect(await d.logs("epaper-api", 5)).toBe("hello out\noops err\n");
    expect(await d.imageTags()).toEqual(["epaper/api:2026-11-21.1", "x/y:z"]);
    expect((await d.pruneBuildCache()).freedBytes).toBe(1234);
    await d.up({ services: ["api"], env: { EPAPER_RELEASE: "2026-11-21.1" } });
    expect(execs[0]!.args).toEqual(["compose", "-p", "epaper", "-f", "/a.yml", "-f", "/b.yml", "up", "-d", "--no-build", "--no-deps", "api"]);
    expect(execs[0]!.env.EPAPER_RELEASE).toBe("2026-11-21.1");
    expect(execs[0]!.env.DOCKER_HOST).toBe(base.replace("http", "tcp"));
  });
  it("refuses a container outside the project without calling Docker for it", async () => {
    const d = new SocketProxyDocker({ host: base, project: "epaper", composeFiles: [] });
    await expect(d.restart("some-other-container")).rejects.toThrow(/not part of the epaper project/);
    expect(seen.some((s) => s.includes("some-other-container"))).toBe(false);
  });
  it("says in plain words when the proxy is not answering", async () => {
    const d = new SocketProxyDocker({ host: "http://127.0.0.1:1", project: "epaper", composeFiles: [] });
    await expect(d.list()).rejects.toThrow(/socket proxy is not answering/);
  });
});

describe("ScriptBackupDriver", () => {
  it("missing scripts give a plain-words error, not a stack trace", async () => {
    const d = new ScriptBackupDriver(path.join(tmp(), "nope"));
    for (const fn of [() => d.runNow(), () => d.status(), () => d.snapshot("x"), () => d.restoreDb("2026-11-21T01:58:00Z")]) {
      const e = await fn().catch((x) => x);
      expect(e).toBeInstanceOf(BackupError);
      expect(e.message).toMatch(/not installed yet/);
      expect(e.message).toMatch(/Backups are NOT running/);
    }
  });
  it("calls the real executables with the agreed arguments", async () => {
    const dir = tmp();
    const script = (n: string, body: string) => { fs.writeFileSync(path.join(dir, n), `#!/bin/sh\n${body}\n`, { mode: 0o755 }); };
    script("backup-now.sh", 'echo "$@" >> "$0.args"; if [ "$1" = "--status" ]; then echo \'{"files":{"at":"2026-11-23T10:00:00Z","size_bytes":5},"wal":null,"base":null,"drill":{"at":"2026-11-20T00:00:00Z","result":"pass"}}\'; elif [ "$1" = "--snapshot" ]; then echo \'{"id":"s1"}\'; fi');
    script("restore.sh", 'echo "$@" >> "$0.args"; if [ "$1" = "db" ]; then echo \'{"id":"r1","counts":[{"table":"t","live":2,"restored":1}]}\'; fi');
    const d = new ScriptBackupDriver(dir);
    const st = await d.status();
    expect(st.files?.size_bytes).toBe(5); expect(st.wal).toBeNull(); expect(st.drill?.result).toBe("pass");
    expect(await d.snapshot("before x")).toEqual({ id: "s1" });
    expect((await d.restoreDb("2026-11-21T01:58:00Z")).id).toBe("r1");
    await d.runNow(); await d.switchDb("r1"); await d.restoreFiles("all", "2026-11-21T01:58:00Z");
    expect(fs.readFileSync(path.join(dir, "backup-now.sh.args"), "utf8")).toBe("--status\n--snapshot before x\n\n");
    expect(fs.readFileSync(path.join(dir, "restore.sh.args"), "utf8")).toBe("db --to 2026-11-21T01:58:00Z\ndb-switch r1\nfiles --scope all --at 2026-11-21T01:58:00Z\n");
  });
  it("a script that fails says so and what it printed last", async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "backup-now.sh"), "#!/bin/sh\necho 'bucket key rejected' >&2\nexit 3\n", { mode: 0o755 });
    const e = await new ScriptBackupDriver(dir).runNow().catch((x) => x);
    expect(e.message).toMatch(/stopped with an error: bucket key rejected/);
  });
});

describe("HttpApiClient", () => {
  it("says the API is not answering instead of throwing a network error", async () => {
    const c = new HttpApiClient("http://127.0.0.1:1", "t");
    expect(await c.queueStats()).toBeNull();
    await expect(c.retry({})).rejects.toThrow(/API is not answering/);
  });
});
