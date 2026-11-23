import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, chmodSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const archive = path.join(root, "ops/postgres/archive-wal.sh");
const bk = path.join(root, "ops/backup/bk");
const tmp = () => mkdtempSync(path.join(tmpdir(), "m13-"));

describe("archive_command (ops/postgres/archive-wal.sh)", () => {
  const setup = () => {
    const d = tmp(), wal = path.join(d, "wal"); mkdirSync(wal);
    const src = path.join(d, "seg"); writeFileSync(src, Buffer.alloc(1 << 20, 7));
    const run = (name: string, s = src, dir = wal) =>
      spawnSync(archive, [s, name], { env: { ...process.env, WAL_ARCHIVE_DIR: dir } });
    return { d, wal, src, run };
  };
  const NAME = "000000010000000000000001";
  it("copies a segment and the content round-trips", () => {
    const { wal, src, run } = setup();
    expect(run(NAME).status).toBe(0);
    expect(gunzipSync(readFileSync(path.join(wal, NAME + ".gz")))).toEqual(readFileSync(src));
    expect(readdirSync(wal).filter((f) => f.startsWith(".tmp"))).toEqual([]);
  });
  it("never overwrites: same content is fine, different content fails and keeps the original", () => {
    const { d, wal, src, run } = setup();
    expect(run(NAME).status).toBe(0);
    const before = readFileSync(path.join(wal, NAME + ".gz"));
    expect(run(NAME).status).toBe(0);
    const other = path.join(d, "other"); writeFileSync(other, "different");
    expect(run(NAME, other).status).not.toBe(0);
    expect(readFileSync(path.join(wal, NAME + ".gz"))).toEqual(before);
  });
  it("fails (non-zero) when the source or the folder is missing, and leaves no partial file", () => {
    const { d, wal, run } = setup();
    expect(run(NAME, path.join(d, "nope")).status).not.toBe(0);
    expect(run(NAME, undefined, path.join(d, "nofolder")).status).not.toBe(0);
    expect(readdirSync(wal)).toEqual([]);
  });
  it("a partial file is never visible under the real name (temp name is hidden, failure removes it)", () => {
    const { d, wal, src } = setup();
    chmodSync(wal, 0o555); // cannot write: must fail, nothing visible
    const r = spawnSync(archive, [src, NAME], { env: { ...process.env, WAL_ARCHIVE_DIR: wal } });
    chmodSync(wal, 0o755);
    if (process.getuid && process.getuid() !== 0) expect(r.status).not.toBe(0);
    expect(existsSync(path.join(wal, NAME + ".gz"))).toBe(false);
    expect(readdirSync(wal).filter((f) => !f.startsWith(".tmp"))).toEqual([]);
    expect(readFileSync(archive, "utf8")).toMatch(/\.tmp\./); // written under a hidden temp name, then linked
  });
});

describe("local base backup retention (bk retain)", () => {
  const mkBase = (base: string, name: string, startWal: string) => {
    mkdirSync(path.join(base, name), { recursive: true });
    writeFileSync(path.join(base, name, "manifest.json"), JSON.stringify({ name, start_wal: startWal, finished: "2026-01-01T00:00:00Z" }));
  };
  it("keeps the newest 3, drops older ones, and only deletes WAL older than the oldest kept base backup", () => {
    const d = tmp(), base = path.join(d, "base"), wal = path.join(d, "wal"); mkdirSync(base); mkdirSync(wal);
    const names = ["20260101T030000Z", "20260102T030000Z", "20260103T030000Z", "20260104T030000Z"];
    names.forEach((n, i) => mkBase(base, n, `00000001000000000000000${i + 1}`.slice(-24).padStart(24, "0")));
    mkdirSync(path.join(base, "20260105T030000Z.partial-x")); mkdirSync(path.join(base, ".partial-20260105T030000Z"));
    for (let i = 1; i <= 6; i++) writeFileSync(path.join(wal, `00000001000000000000000${i}.gz`), "x");
    writeFileSync(path.join(wal, "00000002.history.gz"), "h");
    writeFileSync(path.join(wal, ".tmp.000000010000000000000009.1"), "t");
    const r = spawnSync(bk, ["retain", "3"], { env: { ...process.env, BASE_DIR: base, WAL_DIR: wal, DATA: d, LOCKDIR: d } });
    expect(r.status).toBe(0);
    expect(existsSync(path.join(base, names[0]))).toBe(false);
    names.slice(1).forEach((n) => expect(existsSync(path.join(base, n))).toBe(true));
    expect(existsSync(path.join(base, ".partial-20260105T030000Z"))).toBe(false);
    // oldest kept starts at segment 2: segment 1 goes, 2..6 stay, history and temp files untouched
    expect(existsSync(path.join(wal, "000000010000000000000001.gz"))).toBe(false);
    for (let i = 2; i <= 6; i++) expect(existsSync(path.join(wal, `00000001000000000000000${i}.gz`))).toBe(true);
    expect(existsSync(path.join(wal, "00000002.history.gz"))).toBe(true);
    expect(existsSync(path.join(wal, ".tmp.000000010000000000000009.1"))).toBe(true);
  });
  it("deletes nothing when there is no complete base backup", () => {
    const d = tmp(), base = path.join(d, "base"), wal = path.join(d, "wal"); mkdirSync(base); mkdirSync(wal);
    writeFileSync(path.join(wal, "000000010000000000000001.gz"), "x");
    spawnSync(bk, ["retain", "3"], { env: { ...process.env, BASE_DIR: base, WAL_DIR: wal, DATA: d, LOCKDIR: d } });
    expect(existsSync(path.join(wal, "000000010000000000000001.gz"))).toBe(true);
  });
});

describe("status file shape", () => {
  it("has the keys the ops desk reads, ISO times, and plain-words last_error", () => {
    const d = tmp(), status = path.join(d, "backup-status.json");
    const script = `. ${root}/ops/backup/lib.sh
      st_set '.files.last_ok=$now | .files.size_bytes=10 | .push.last_ok=$now | .basebackup.last_ok=$now'
      st_err push "The upload stalled for 600 seconds and was stopped."`;
    execFileSync("bash", ["-c", script], { env: { ...process.env, STATUS: status, LOCKDIR: d, DATA: d } });
    const s = JSON.parse(readFileSync(status, "utf8"));
    for (const k of ["version", "updated", "healthy", "lag_seconds", "last_error", "files", "wal", "basebackup", "push", "prune"]) expect(s).toHaveProperty(k);
    expect(s.files.last_ok).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(s.files.size_bytes).toBe(10);
    expect(s.lag_seconds).toBeLessThan(5);
    expect(s.last_error).toBe("The upload stalled for 600 seconds and was stopped.");
    expect(s.healthy).toBe(false);
    execFileSync("bash", ["-c", `. ${root}/ops/backup/lib.sh; st_clear push`], { env: { ...process.env, STATUS: status, LOCKDIR: d, DATA: d } });
    const t = JSON.parse(readFileSync(status, "utf8"));
    expect(t.last_error).toBeNull();
    expect(t.healthy).toBe(true);
  });
});
