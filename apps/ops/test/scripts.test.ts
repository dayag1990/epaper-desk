import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { REPO_OPS } from "./helpers.js";

const REPO = path.resolve(REPO_OPS, "..");
const sh = (script: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync("bash", [path.join(REPO, "scripts", script), ...args], { encoding: "utf8", env: { PATH: process.env.PATH!, ...env }, timeout: 30_000 });

describe("the programs the desk calls (no Docker needed for these checks)", () => {
  it("backup-now.sh --status reads the status files and says null for a kind that does not exist", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ops-scripts-"));
    const empty = sh("backup-now.sh", ["--status"], { BACKUP_ROOT: root });
    expect(empty.status).toBe(0);
    expect(JSON.parse(empty.stdout)).toEqual({ files: null, wal: null, base: null, drill: null });
    fs.writeFileSync(path.join(root, "backup-status.json"), JSON.stringify({ files: { last_ok: "2026-11-24T03:00:00Z", size_bytes: 10 }, wal: { last_ok: "2026-11-24T03:00:30Z", size_bytes: 20 }, basebackup: { last_ok: null, size_bytes: null } }));
    fs.writeFileSync(path.join(root, "drill-status.json"), JSON.stringify({ at: "2026-11-24T02:00:00Z", result: "pass", note: "" }));
    const r = JSON.parse(sh("backup-now.sh", ["--status"], { BACKUP_ROOT: root }).stdout);
    expect(r.files).toEqual({ at: "2026-11-24T03:00:00Z", size_bytes: 10 });
    expect(r.wal).toEqual({ at: "2026-11-24T03:00:30Z", size_bytes: 20 });
    expect(r.base).toBeNull(); // no nightly base copy yet: the desk shows it as missing
    expect(r.drill).toEqual({ at: "2026-11-24T02:00:00Z", result: "pass" });
  });
  it("restore.sh db / db-switch refuse bad input in plain words before touching anything", () => {
    const future = sh("restore.sh", ["db", "--to", "2999-01-01T00:00:00Z"], { BACKUP_ROOT: os.tmpdir() });
    expect(future.status).toBe(1);
    expect(future.stderr).toMatch(/in the future.*Nothing was changed/s);
    const junk = sh("restore.sh", ["db", "--to", "last tuesday-ish"], { BACKUP_ROOT: os.tmpdir() });
    expect(junk.status).toBe(1);
    expect(junk.stderr).toMatch(/cannot read the time.*Nothing was changed/s);
    const bad = sh("restore.sh", ["db-switch", "../../etc"], { BACKUP_ROOT: os.tmpdir() });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/not the name of a restored database.*Nothing was changed/s);
  });
  it("a throwaway project never reads the live pointer files", () => {
    const script = `. ${REPO}/scripts/lib/backup-common.sh; COMPOSE_PROJECT=; PROJECT=epaper-bk; unset OPS_STATE_DIR FILES_ROOT; resolve_state_dir; echo "[$STATE_DIR]"; PROJECT=epaper; resolve_state_dir; echo "[$STATE_DIR]"`;
    const r = spawnSync("bash", ["-c", script], { encoding: "utf8", env: { PATH: process.env.PATH! } });
    expect(r.stdout.trim().split("\n")).toEqual(["[]", "[/srv/epaper/files/_ops]"]);
  });
});

describe("how the desk reaches Docker (checked in the compose files)", () => {
  const ops = YAML.parse(fs.readFileSync(path.join(REPO, "docker-compose.ops.yml"), "utf8"), { logLevel: "error" });
  const main = YAML.parse(fs.readFileSync(path.join(REPO, "docker-compose.yml"), "utf8"));
  it("the raw socket is mounted read-only into the proxy only, which has no published port and no system route", () => {
    const withSocket = Object.entries(ops.services).filter(([, s]) => JSON.stringify((s as { volumes?: unknown }).volumes ?? []).includes("docker.sock")).map(([n]) => n);
    expect(withSocket).toEqual(["dockerproxy"]);
    expect(ops.services.dockerproxy.volumes[0]).toMatch(/docker\.sock:ro$/);
    expect(ops.services.dockerproxy.ports).toBeUndefined();
    expect(ops.services.dockerguard.ports).toBeUndefined();
    expect(ops.services.dockerproxy.environment.SYSTEM).toBe("0");
    for (const k of ["EXEC", "SWARM", "SECRETS", "PLUGINS", "AUTH"]) expect(ops.services.dockerproxy.environment[k]).toBe("0");
  });
  it("the desk talks to the filter (which cuts prune and volume deletes), never to the proxy or the socket", () => {
    expect(ops.services.ops.environment.DOCKER_HOST).toBe("http://dockerguard:2375");
    expect(ops.services.ops.depends_on.dockerguard).toBeTruthy();
    const nets = ops.services.dockerguard.networks;
    expect(nets).toEqual(expect.arrayContaining(["proxyback", "opsdocker"]));
    expect(ops.services.dockerproxy.networks).toEqual(["proxyback"]);
    expect(ops.networks.proxyback.internal).toBe(true);
    expect(ops.networks.opsdocker.internal).toBe(true);
  });
  it("the database folder can be moved by the desk (restore and switch) without a code change", () => {
    expect(main.services.postgres.volumes).toContain("${PGDATA_SOURCE:-pgdata}:/var/lib/postgresql/data");
    expect(main.volumes).toHaveProperty("pgdata");
  });
  it("the desk runs the backup programs with a one-off container (its Docker door has no exec)", () => {
    expect(ops.services.ops.environment.BK_USE_RUN).toBe("1");
    expect(ops.services.dockerproxy.environment.EXEC).toBe("0");
  });
});
