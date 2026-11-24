import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, chmodSync, utimesSync } from "node:fs";
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

describe("push to the bucket (bk push) with a fake restic and a fake Backblaze", () => {
  const setup = (mode: "cap" | "ok" | "key") => {
    const d = tmp(), bin = path.join(d, "bin"); mkdirSync(bin);
    for (const x of ["files", "walarchive", "basebackups", "snapshots", "lock"]) mkdirSync(path.join(d, x));
    const log = path.join(d, "restic.log");
    writeFileSync(path.join(bin, "restic"), `#!/bin/sh
echo "$@" >> ${log}
case "$1" in
  cat|init) [ "${mode}" = ok ] && exit 0; echo "Fatal: unable to open config file: Stat: Access Denied." >&2; exit 1;;
  backup) [ "${mode}" = ok ] && { echo "snapshot abcd1234 saved"; exit 0; }; echo "Fatal: Stat: Access Denied." >&2; exit 1;;
esac
exit 0
`);
    writeFileSync(path.join(bin, "curl"), `#!/bin/sh
if [ "${mode}" = cap ]; then echo '{"code":"transaction_cap_exceeded","message":"Transaction cap exceeded","status":403}'; else echo '{"code":"bad_auth_token","status":401}'; fi
`);
    chmodSync(path.join(bin, "restic"), 0o755); chmodSync(path.join(bin, "curl"), 0o755);
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, DATA: d, LOCKDIR: path.join(d, "lock"), RESTIC_REPOSITORY: "s3:x/y", BACKUP_S3_ENDPOINT: "https://s3.eu.backblazeb2.com", BACKUP_S3_KEY: "k", BACKUP_S3_SECRET: "s", CONFIG_COPY: path.join(d, "none") };
    const push = () => spawnSync(bk, ["push"], { env, encoding: "utf8" });
    const status = () => JSON.parse(readFileSync(path.join(d, "backup-status.json"), "utf8"));
    const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
    return { d, push, status, calls };
  };
  it("a used-up daily cap is named in plain words, and the next minute does not hammer the bucket", () => {
    const t = setup("cap");
    t.push();
    expect(t.status().errors.push.msg).toMatch(/daily usage cap .*Caps & Alerts/);
    const n = t.calls().length;
    t.push();
    expect(t.calls().length).toBe(n); // backing off: no new request
    expect(existsSync(path.join(t.d, "lock", "push-backoff"))).toBe(true);
  });
  it("a key Backblaze no longer accepts is named as such", () => {
    const t = setup("key");
    t.push();
    expect(t.status().errors.push.msg).toMatch(/does not accept the bucket key/);
  });
  it("a good push records when the safety dumps were copied, and skips the repository check next time", () => {
    const t = setup("ok");
    t.push();
    const s = t.status();
    expect(s.push.last_ok).toBeTruthy();
    expect(s.push.snapshots_ok).toBeTruthy();
    expect(s.errors.push).toBeUndefined();
    t.push();
    expect(t.calls().filter((c) => c.startsWith("cat"))).toHaveLength(1);
    expect(t.calls().filter((c) => c.startsWith("backup")).every((c) => c.includes(path.join(t.d, "snapshots")))).toBe(true);
  });
});

describe("the bucket's daily request budget (owner rule 2026-11-24: each class under 2,000 a day)", () => {
  const today = () => new Date().toISOString().slice(0, 10);
  const setup = () => {
    const d = tmp(), bin = path.join(d, "bin"); mkdirSync(bin);
    for (const x of ["files", "walarchive", "basebackups", "snapshots", "lock"]) mkdirSync(path.join(d, x));
    const log = path.join(d, "restic.log");
    writeFileSync(path.join(bin, "restic"), `#!/bin/sh
echo "$@" >> ${log}
case "$1" in backup) echo "snapshot abcd1234 saved";; esac
exit 0
`);
    writeFileSync(path.join(bin, "curl"), `#!/bin/sh
echo '{"code":"transaction_cap_exceeded","status":403}'
`);
    chmodSync(path.join(bin, "restic"), 0o755); chmodSync(path.join(bin, "curl"), 0o755);
    const env: Record<string, string | undefined> = { ...process.env, PATH: `${bin}:${process.env.PATH}`, DATA: d, LOCKDIR: path.join(d, "lock"), RESTIC_REPOSITORY: "s3:x/y", BACKUP_S3_ENDPOINT: "https://s3.eu.backblazeb2.com", BACKUP_S3_KEY: "k", BACKUP_S3_SECRET: "s", CONFIG_COPY: path.join(d, "none") };
    const ledgerFile = path.join(d, "b2-ledger.json");
    const seed = (o: object) => writeFileSync(ledgerFile, JSON.stringify({ day: today(), A: 0, B: 0, C: 0, pushes: 0, prune_done: false, drill_done: false, ...o }));
    const ledger = () => JSON.parse(readFileSync(ledgerFile, "utf8"));
    const run = (...a: string[]) => spawnSync(bk, a, { env, encoding: "utf8" });
    const status = () => JSON.parse(readFileSync(path.join(d, "backup-status.json"), "utf8"));
    const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
    return { d, env, seed, ledger, run, status, calls };
  };
  it("every push books its measured cost (6/3/8 rounded up to 8/4/10, plus the empty-cache extra once)", () => {
    const t = setup();
    t.run("push"); t.run("push");
    const l = t.ledger();
    expect(l.pushes).toBe(2);
    expect([l.A, l.B, l.C]).toEqual([8 + 24 + 8, 4 + 16 + 4, 10 + 0 + 10]); // the first push also pays the cold-cache extra
  });
  it("a day's 96 pushes fit under 1,800 with the clean-up and the restore check still reserved", () => {
    const t = setup();
    t.seed({ pushes: 0 });
    // 96 pushes + the empty-cache extra, as the ledger counts them
    t.seed({ A: 8 * 95 + 32, B: 4 * 95 + 20, C: 10 * 95 + 10 });
    const r = t.run("push");
    expect(r.status).toBe(0);
    expect(t.calls().some((c) => c.startsWith("backup"))).toBe(true);
  });
  it("a push that would break the budget waits, says so in plain words, and sends no request", () => {
    const t = setup();
    t.seed({ A: 1000 });                       // 1000 + 8 + 800 reserved for the clean-up > 1,800
    t.run("push");
    expect(t.status().errors.push.msg).toMatch(/paused until 00:00 UTC.*daily request limit/);
    expect(t.calls()).toEqual([]);
    expect(t.ledger().A).toBe(1000);           // nothing was spent
  });
  it("once the clean-up and the restore check have run, their reserve is free again", () => {
    const t = setup();
    t.seed({ A: 1000, prune_done: true, drill_done: true });
    t.run("push");
    expect(t.calls().some((c) => c.startsWith("backup"))).toBe(true);
  });
  it("a new UTC day starts from zero", () => {
    const t = setup();
    writeFileSync(path.join(t.d, "b2-ledger.json"), JSON.stringify({ day: "2020-01-01", A: 1799, B: 1799, C: 1799, pushes: 99, prune_done: true, drill_done: true }));
    t.run("push");
    const l = t.ledger();
    expect(l.day).toBe(today()); expect(l.pushes).toBe(1); expect(l.A).toBeLessThan(100);
  });
  it("a used-up cap waits until 00:05 UTC, not ten minutes", () => {
    const t = setup();
    writeFileSync(path.join(t.d, "bin", "restic"), `#!/bin/sh\necho "Fatal: unable to open config file: Stat: Access Denied." >&2\nexit 1\n`);
    t.run("push");
    const until = +readFileSync(path.join(t.d, "lock", "push-backoff"), "utf8");
    const n = new Date(); const want = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1, 0, 5) / 1000;
    expect(Math.abs(until - want)).toBeLessThan(10);
  });
  it("the nightly clean-up books its full cost once, a retry only a little, and does not run while the bucket refuses", () => {
    const t = setup();
    t.run("prune");
    const a = t.ledger();
    expect(a.prune_done).toBe(true); expect(a.A).toBe(800);
    t.run("prune");
    expect(t.ledger().B).toBe(402); // 400 for the first try, 2 for the retry
    writeFileSync(path.join(t.d, "lock", "push-backoff"), String(Math.floor(Date.now() / 1000) + 3600));
    const n = t.calls().length;
    t.run("prune");
    expect(t.calls().length).toBe(n);
  });
  it("the restore drill is one a day unless asked again, and the ledger counts it", () => {
    const t = setup();
    expect(t.run("ledger", "drill").status).toBe(0);
    const again = t.run("ledger", "drill");
    expect(again.status).toBe(3); expect(again.stdout).toMatch(/already read the bucket today/);
    expect(t.run("ledger", "drill", "--again").status).toBe(0);
    expect(t.ledger().B).toBe(240);
  });
  it("the status stays 'healthy' between 15-minute pushes, and turns unhealthy when a push is missed", () => {
    const d = tmp(), status = path.join(d, "backup-status.json");
    const env = { ...process.env, STATUS: status, LOCKDIR: d, DATA: d, PUSH_INTERVAL: "900" };
    const at = (secAgo: number) => new Date(Date.now() - secAgo * 1000).toISOString().replace(/\.\d+Z$/, "Z");
    const go = (secAgo: number) => { execFileSync("bash", ["-c", `. ${root}/ops/backup/lib.sh; st_set '.push.last_ok="${at(secAgo)}" | .basebackup.last_ok=$now'; st_clear push`], { env }); return JSON.parse(readFileSync(status, "utf8")); };
    expect(go(14 * 60).healthy).toBe(true);     // 14 minutes since the last push
    expect(go(31 * 60).healthy).toBe(true);     // one push missed: still inside two intervals
    expect(go(40 * 60).healthy).toBe(false);    // two pushes missed
  });
});

describe("old copies the desk may free (scripts/lib/desk-ops.sh desk_old_copies)", () => {
  const stamp = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400_000).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  function setup(opts: { pushedDaysAgo: number | null; live?: string; wasLive?: string[] }) {
    const d = tmp(), ops = path.join(d, "_ops"); mkdirSync(path.join(d, "snapshots")); mkdirSync(path.join(d, "restores")); mkdirSync(ops);
    // dumps aged 0.5, 3, 8, 9, 20 days
    const dumps = [0.5, 3, 8, 9, 20].map((a) => {
      const id = stamp(a), f = path.join(d, "snapshots", `${id}.sql.gz`);
      writeFileSync(f, "x".repeat(100)); const t = new Date(Date.now() - a * 86400_000); utimesSync(f, t, t); return { id, a };
    });
    const restores = [3, 10, 12].map((a) => { const id = "r" + stamp(a); mkdirSync(path.join(d, "restores", id, "pgdata"), { recursive: true }); return id; });
    const status = { push: { snapshots_ok: opts.pushedDaysAgo === null ? null : new Date(Date.now() - opts.pushedDaysAgo * 86400_000).toISOString() } };
    writeFileSync(path.join(d, "backup-status.json"), JSON.stringify(status));
    if (opts.live) writeFileSync(path.join(ops, "pgdata-source"), path.join(d, "restores", opts.live, "pgdata"));
    if (opts.wasLive) writeFileSync(path.join(ops, "was-live.txt"), opts.wasLive.join("\n") + "\n");
    const run = (fn: string, pre = ":") => {
      const r = spawnSync("bash", ["-c", `set -uo pipefail; . scripts/lib/backup-common.sh; . scripts/lib/desk-ops.sh; ${pre}; ${fn}`], { cwd: root, encoding: "utf8", env: { ...process.env, BACKUP_ROOT: d, OPS_STATE_DIR: ops } });
      return { out: r.stdout.trim().split("\n").pop() ?? "", err: r.stderr, status: r.status };
    };
    return { d, dumps, restores, run };
  }
  it("offers dumps older than 7 days that the bucket holds, never the newest 2, and restored copies never live", () => {
    const t = setup({ pushedDaysAgo: 0 });
    const plan = JSON.parse(t.run("desk_old_copies plan").out);
    const ids = plan.items.map((i: any) => i.id).sort();
    // 20-day and 9-day and 8-day dumps are old, but the newest 2 (0.5 d, 3 d) are always kept anyway: all three old ones qualify
    expect(ids).toEqual([`dump:${t.dumps[2].id}`, `dump:${t.dumps[3].id}`, `dump:${t.dumps[4].id}`, `restore:${t.restores[1]}`, `restore:${t.restores[2]}`].sort());
    expect(plan.kept.some((k: any) => /always kept/.test(k.reason))).toBe(true);
    expect(plan.kept.some((k: any) => k.what.includes(t.restores[0]) && /younger/.test(k.reason))).toBe(true);
  });
  it("keeps every dump the bucket does not hold yet", () => {
    const never = JSON.parse(setup({ pushedDaysAgo: null }).run("desk_old_copies plan").out);
    expect(never.items.filter((i: any) => i.id.startsWith("dump:"))).toEqual([]);
    expect(never.kept.some((k: any) => /not copied to the off-box bucket/.test(k.reason))).toBe(true);
    // pushed 10 days ago: a dump from 9 days ago is newer than the last push, so it stays; the 20-day one may go
    const t = setup({ pushedDaysAgo: 10 });
    const plan = JSON.parse(t.run("desk_old_copies plan").out);
    expect(plan.items.filter((i: any) => i.id.startsWith("dump:")).map((i: any) => i.id)).toEqual([`dump:${t.dumps[4].id}`]);
  });
  it("never offers a restored database that is live or ever was live", () => {
    const base = setup({ pushedDaysAgo: 0 });
    const t = setup({ pushedDaysAgo: 0 });
    const live = t.restores[1], was = t.restores[2];
    const t2 = setup({ pushedDaysAgo: 0, live, wasLive: [was] });
    // restores differ per setup (timestamps); read names from the second one
    const r2 = readdirSync(path.join(t2.d, "restores")).sort();
    const liveName = r2[1], wasName = r2[0];
    writeFileSync(path.join(t2.d, "_ops", "pgdata-source"), path.join(t2.d, "restores", liveName, "pgdata"));
    writeFileSync(path.join(t2.d, "_ops", "was-live.txt"), wasName + "\n");
    const plan = JSON.parse(t2.run("desk_old_copies plan").out);
    expect(plan.items.filter((i: any) => i.id.startsWith("restore:"))).toEqual([]);
    expect(plan.kept.filter((k: any) => k.what.startsWith("restored database")).length).toBe(3);
    expect(base.d).not.toBe(t.d);
  });
  it("discard deletes only what the plan lists and refuses everything else", () => {
    const t = setup({ pushedDaysAgo: 0 });
    const pre = 'rm_old_copy() { echo "RM $1" >&2; rm -f $(for x in $1; do echo "$ROOT/$x"; done); }; discard_copy() { echo "DISCARD $1" >&2; rm -rf "$ROOT/restores/$1"; }';
    const newest = t.dumps[0].id, old = t.dumps[4].id;
    const r = t.run(`desk_old_copies discard dump:${newest} dump:${old} dump:../../x restore:${t.restores[0]}`, pre);
    const res = JSON.parse(r.out);
    expect(res.removed).toEqual([`dump:${old}`]);
    expect(res.refused.sort()).toEqual([`dump:${newest}`, "dump:../../x", `restore:${t.restores[0]}`].sort());
    expect(existsSync(path.join(t.d, "snapshots", `${old}.sql.gz`))).toBe(false);
    expect(existsSync(path.join(t.d, "snapshots", `${newest}.sql.gz`))).toBe(true);
    expect(existsSync(path.join(t.d, "restores", t.restores[0]))).toBe(true);
  });
});
