import { describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// A stand-in for the real Docker: answers `inspect` from a small table, and says so if it is ever really called.
// Nothing here can touch a real container, volume or network.
const dir = mkdtempSync(join(tmpdir(), "guard-"));
const stub = join(dir, "docker");
writeFileSync(stub, `#!/usr/bin/env bash
t="\${@: -1}"
case "$*" in
  *"volume inspect"*)
    case "$t" in
      epaper_pgdata) echo "epaper_pgdata|epaper";;
      epaper-bk_pgdata) echo "epaper-bk_pgdata|epaper-bk";;
      drill-a-data) echo "drill-a-data|";;
      mystery-vol) echo "mystery-vol|";;
      permfail-vol) echo "permission denied while trying to connect to the docker API" >&2; exit 1;;
      *) echo "Error: No such volume: $t" >&2; exit 1;;
    esac;;
  *"network inspect"*)
    case "$t" in
      epaper_default) echo "epaper_default|epaper";;
      epaper-join_default) echo "epaper-join_default|epaper-join";;
      *) echo "Error: No such network: $t" >&2; exit 1;;
    esac;;
  *"inspect --type container"*)
    case "$t" in
      epaper-api|epaper-postgres|epaper-caddy|livehash123) echo "/$([ $t = livehash123 ] && echo epaper-worker || echo $t)|epaper";;
      epaper-join-api|joinhash456) echo "/epaper-join-api|epaper-join";;
      drill-a) echo "/drill-a|";;
      random-box) echo "/random-box|";;
      permfail-box) echo "permission denied while trying to connect to the docker API" >&2; exit 1;;
      *) echo "Error response from daemon: No such container: $t" >&2; exit 1;;
    esac;;
  *) echo "REAL-DOCKER-CALLED";;
esac
`);
chmodSync(stub, 0o755);
const guard = join(__dirname, "..", "scripts", "guard", "docker");
const verdict = (cmd: string) => {
  const r = spawnSync("bash", ["-c", `"${guard}" ${cmd}`], { env: { ...process.env, DOCKER_REAL: stub, GUARD_DRY_RUN: "1", COMPOSE_PROJECT_NAME: "" }, encoding: "utf8" });
  return (r.stdout.trim().split("\n").pop() ?? "") as "ALLOW" | "BLOCK";
};

describe("docker guard: blocked", () => {
  const blocked = [
    "system prune", "system prune -af --volumes", "volume prune", "volume prune -f", "image prune -a", "container prune", "network prune", "builder prune",
    "-H tcp://127.0.0.1:2375 system prune", "--context other volume prune",
    "compose -p epaper down", "compose -p epaper down -v", "compose down", "compose down -v", "compose -f docker-compose.yml down -v",
    "compose -p epaper -f docker-compose.yml -f docker-compose.ops.yml down --remove-orphans",
    "compose -p epaper rm -f", "compose -p epaper up -d --force-recreate", "compose -p epaper up -d --remove-orphans", "compose -p epaper up -d -V",
    "compose -p desk down", "compose --project-name epaper down -v",
    "rm -f epaper-api", "rm epaper-postgres", "container rm -f epaper-caddy", "rm -f livehash123", "rm random-box", "rm -f drill-a epaper-api",
    "volume rm epaper_pgdata", "volume rm drill-a-data epaper_pgdata", "network rm epaper_default",
    "rm -f permfail-box", "volume rm permfail-vol", "rmi epaper/api:dev", "image rm postgres:17.2-bookworm",
  ];
  for (const c of blocked) it(`blocks: docker ${c}`, () => expect(verdict(c)).toBe("BLOCK"));
});

describe("docker guard: allowed", () => {
  const allowed = [
    "ps", "ps -a", "logs epaper-api", "exec -T epaper-api ls", "build -t x .", "run --rm drill-x echo hi", "images", "inspect epaper-api",
    "compose -p epaper ps", "compose -p epaper logs api", "compose -p epaper up -d --build api", "compose -p epaper up -d demo-site", "compose -p epaper restart caddy", "compose -p epaper exec -T postgres psql -U epaper",
    "compose -p epaper-join down -v", "compose -p epaper-bk down -v --remove-orphans", "compose -p tmp-a1 down -v", "compose -p test-x up -d --force-recreate", "compose -p drill-1 rm -f",
    "rm -f drill-a", "rm -f epaper-join-api", "rm -f joinhash456", "rm -f not-there-at-all",
    "volume rm drill-a-data", "volume rm epaper-bk_pgdata", "volume rm no-such-volume", "network rm epaper-join_default",
    "volume ls", "network ls", "system df",
  ];
  for (const c of allowed) it(`allows: docker ${c}`, () => expect(verdict(c)).toBe("ALLOW"));
});

describe("docker guard: behaviour", () => {
  it("explains a block in plain words and exits 126", () => {
    const r = spawnSync("bash", ["-c", `"${guard}" system prune`], { env: { ...process.env, DOCKER_REAL: stub }, encoding: "utf8" });
    expect(r.status).toBe(126);
    expect(r.stderr).toContain("BLOCKED by the Docker guard");
    expect(r.stderr).toContain("throwaway project");
    expect(r.stdout).not.toContain("REAL-DOCKER-CALLED");
  });
  it("passes an allowed command through to the real docker", () => {
    const r = spawnSync("bash", ["-c", `"${guard}" ps`], { env: { ...process.env, DOCKER_REAL: stub }, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("REAL-DOCKER-CALLED");
  });
  it("COMPOSE_PROJECT_NAME=epaper does not unlock a down", () => {
    const r = spawnSync("bash", ["-c", `"${guard}" compose down`], { env: { ...process.env, DOCKER_REAL: stub, GUARD_DRY_RUN: "1", COMPOSE_PROJECT_NAME: "epaper" }, encoding: "utf8" });
    expect(r.stdout).toContain("BLOCK");
  });
});
