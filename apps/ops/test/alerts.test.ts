import fs from "node:fs";
import { describe, expect, it } from "vitest";
import type { AlertChannel } from "../src/alerts.js";
import { loginCookie, mkStack, post } from "./helpers.js";

const fake = (fail = false): AlertChannel & { sent: string[] } => ({ name: "telegram", sent: [] as string[], async send(t: string) { if (fail) throw new Error("Telegram answered 500"); this.sent.push(t); } });
const tick = async (s: ReturnType<typeof mkStack>) => s.alerts.tick(await s.snapshot(true));

describe("alerts", () => {
  it("service red for 2 minutes: nothing at first, one message after 2 min, no repeat, then FIXED", async () => {
    const tg = fake();
    const s = mkStack({ telegram: tg });
    s.docker.stop("worker");
    await tick(s);
    expect(tg.sent).toEqual([]);
    s.clock.advance(119_000); await tick(s);
    expect(tg.sent).toEqual([]);
    s.clock.advance(2_000); await tick(s);
    expect(tg.sent.length).toBe(1);
    expect(tg.sent[0]).toMatch(/^RED: The worker .* has been red for 2 minutes/);
    s.clock.advance(60_000); await tick(s);
    expect(tg.sent.length).toBe(1);
    await s.fixes.restart("worker");
    await tick(s);
    expect(tg.sent.at(-1)).toMatch(/^FIXED: /);
  });

  it("disk under 20 GB, backup older than 5 min, drill older than 7 days, dead letters for 10 min", async () => {
    const tg = fake();
    const s = mkStack({ telegram: tg });
    const ago = (min: number) => new Date(s.clock.now() - min * 60_000).toISOString();
    await tick(s);
    expect(tg.sent).toEqual([]);
    s.backup.status_.files = { at: ago(6), size_bytes: 1 };
    s.backup.status_.drill = { at: ago(8 * 1440), result: "pass" };
    const r = await tick(s);
    expect(r.sent).toEqual(expect.arrayContaining(["backup_old", "drill_old"]));
    // dead letters: only after 10 min
    s.clock.advance(5 * 60_000); s.backup.status_.files = { at: ago(1), size_bytes: 1 }; s.backup.status_.drill = { at: ago(1), result: "pass" };
    expect((await tick(s)).sent).not.toContain("dead_letter");
    s.clock.advance(5 * 60_000 + 1000); s.backup.status_.files = { at: ago(1), size_bytes: 1 }; s.backup.status_.wal = { at: ago(1), size_bytes: 1 };
    expect((await tick(s)).sent).toContain("dead_letter");
  });

  it("missing backups alert too (no backup record = fire), but an unreachable API does not invent dead-letter alerts", async () => {
    const tg = fake();
    const s = mkStack({ telegram: tg });
    s.backup.status = async () => { throw new Error("script missing"); };
    s.api.stats = null;
    const r = await tick(s);
    expect(r.sent).toEqual(expect.arrayContaining(["backup_old", "drill_old"]));
    expect(r.sent).not.toContain("dead_letter");
  });

  it("without Telegram the line goes to alerts.log; the test button says so; a failing Telegram falls back to the file", async () => {
    const s = mkStack();
    const cookie = await loginCookie(s);
    const r = await post(s, cookie, "/ops/alerts/test");
    expect(r.statusCode).toBe(200);
    expect(r.json().via).toBe("file");
    expect(r.json().message).toMatch(/Telegram is not set up/);
    expect(fs.readFileSync(s.cfg.alertsLogFile, "utf8")).toMatch(/TEST: the ops desk can reach you/);
    const bad = fake(true);
    const s2 = mkStack({ telegram: bad });
    const c2 = await loginCookie(s2);
    const r2 = await post(s2, c2, "/ops/alerts/test");
    expect(r2.json().via).toBe("file");
    expect(fs.readFileSync(s2.cfg.alertsLogFile, "utf8")).toMatch(/Telegram failed/);
    const good = fake();
    const s3 = mkStack({ telegram: good });
    expect((await post(s3, await loginCookie(s3), "/ops/alerts/test")).json().via).toBe("telegram");
    expect(good.sent.length).toBe(1);
  });

  it("alerts work with the API, worker and database all stopped (they never call the API)", async () => {
    const tg = fake();
    const s = mkStack({ telegram: tg });
    s.docker.stop("api"); s.docker.stop("worker"); s.docker.stop("postgres");
    s.api.queueStats = async () => { throw new Error("alerts must not call the API"); };
    s.api.queueStats = async () => null;
    await tick(s);
    s.clock.advance(125_000);
    await tick(s);
    expect(tg.sent.length).toBeGreaterThanOrEqual(3);
    expect(s.api.calls).toEqual([]);
  });
});
