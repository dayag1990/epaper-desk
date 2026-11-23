import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The ops desk's Docker filter (ops/dockerguard/Caddyfile) must refuse every prune route and every delete of
// volumes, networks or images, and still let a deploy replace containers. This runs the REAL filter in front of a
// stand-in upstream, in a THROWAWAY network and containers named tmp-dg-* (owner rule: tests never touch the live project).
const sh = (...a: string[]) => execFileSync("docker", a, { encoding: "utf8" }).trim();
const NET = "tmp-dg-net", STUB = "tmp-dg-stub", GUARD = "tmp-dg-guard";
const repo = join(__dirname, "..");
let base = "";

async function up(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(base + "/_ping"); if (r.status === 200) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("the filter did not start");
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "dg-stub-"));
  writeFileSync(join(dir, "Caddyfile"), "{\n\tadmin off\n\tauto_https off\n}\n:2375 {\n\trespond \"UPSTREAM-OK\" 200\n}\n");
  chmodSync(dir, 0o755);
  sh("network", "create", NET);
  sh("run", "-d", "--name", STUB, "--network", NET, "--network-alias", "dockerproxy", "-v", `${dir}:/etc/caddy:ro`, "caddy:2.8.4-alpine");
  sh("run", "-d", "--name", GUARD, "--network", NET, "-p", "127.0.0.1::2375", "-v", `${join(repo, "ops", "dockerguard")}:/etc/caddy:ro`, "caddy:2.8.4-alpine");
  base = "http://" + sh("port", GUARD, "2375/tcp").split("\n")[0].replace("0.0.0.0", "127.0.0.1");
  await up();
}, 120_000);

afterAll(() => {
  // only what this test created
  for (const n of [GUARD, STUB]) { try { sh("rm", "-f", n); } catch { /* already gone */ } }
  try { sh("network", "rm", NET); } catch { /* already gone */ }
});

const call = async (method: string, path: string) => { const r = await fetch(base + path, { method }); return { status: r.status, body: await r.text() }; };

describe("ops desk Docker filter: refused", () => {
  const refused: [string, string][] = [
    ["POST", "/volumes/prune"], ["POST", "/v1.43/volumes/prune"], ["POST", "/containers/prune"], ["POST", "/images/prune"],
    ["POST", "/networks/prune"], ["POST", "/system/prune"], ["POST", "/build/prune"], ["POST", "/v1.45/build/prune?all=true"],
    ["DELETE", "/volumes/epaper_pgdata"], ["DELETE", "/v1.43/volumes/anything?force=true"], ["DELETE", "/networks/epaper_default"], ["DELETE", "/images/postgres:17.2-bookworm"],
  ];
  for (const [m, p] of refused) it(`${m} ${p} -> 403, never reaches the upstream`, async () => {
    const r = await call(m, p);
    expect(r.status).toBe(403);
    expect(r.body).not.toContain("UPSTREAM-OK");
    expect(r.body).toMatch(/Blocked/);
  });
});

describe("ops desk Docker filter: allowed (a deploy and a rollback still work)", () => {
  const allowed: [string, string][] = [
    ["GET", "/_ping"], ["GET", "/containers/json"], ["GET", "/v1.43/volumes/epaper_pgdata"], ["GET", "/v1.43/networks"], ["POST", "/containers/abc/restart"],
    ["POST", "/v1.43/containers/create"], ["DELETE", "/containers/abc"], ["POST", "/containers/abc/start"], ["POST", "/containers/abc/stop"],
  ];
  for (const [m, p] of allowed) it(`${m} ${p} -> passed on`, async () => {
    const r = await call(m, p);
    expect(r.status).toBe(200);
    expect(r.body).toContain("UPSTREAM-OK");
  });
});
