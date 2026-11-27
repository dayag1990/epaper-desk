import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { SSO_COOKIE, signSso } from "@epaper/sso";
import { AlertFeed, type AlertEvent } from "@epaper/theme";
import type { AlertChannel } from "../src/alerts.js";
import { loginCookie, mkStack } from "./helpers.js";

const SECRET = "dummy-sso-secret-for-tests-only";
const fake = (): AlertChannel & { sent: string[] } => ({ name: "telegram", sent: [] as string[], async send(t: string) { this.sent.push(t); } });

/** A browser's view of the stream: reads Server-Sent Events and gives each to the same AlertFeed the editor and admin use. */
async function watch(base: string, cookie: string, feed: AlertFeed, since = 0) {
  const ac = new AbortController();
  const res = await fetch(`${base}/ops/alerts/stream?since=${since}`, { headers: { cookie, origin: "http://127.0.0.1:8100" }, signal: ac.signal });
  const rd = res.body!.getReader(); let buf = "";
  const done = (async () => {
    try {
      for (;;) {
        const { value, done: d } = await rd.read(); if (d) return;
        buf += new TextDecoder().decode(value);
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(block)?.[1], data = /^data: (.+)$/m.exec(block)?.[1];
          if (!ev || !data) continue;
          const d2 = JSON.parse(data);
          if (ev === "snapshot") { const firing = new Set((d2.firing as AlertEvent[]).map((a) => a.id)); for (const a of [...d2.recent as AlertEvent[]].reverse()) feed.push(a, { live: firing.has(a.id) }); }
          if (ev === "alert") feed.push(d2 as AlertEvent);
        }
      }
    } catch { /* aborted */ }
  })();
  return { stop: async () => { ac.abort(); await done; } };
}
const until = async (f: () => boolean, ms = 3000) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 25)); };

describe("alerts: one alert, three consumers, each exactly once", () => {
  it("a service going red reaches the toast/bell feed, Telegram and the ops alert list once, and 'fixed' once", async () => {
    const tg = fake();
    const s = mkStack({ telegram: tg, cfgOver: { SSO_SECRET: SECRET } });
    await s.app.listen({ port: 0, host: "127.0.0.1" });
    const base = `http://127.0.0.1:${(s.app.server.address() as AddressInfo).port}`;
    const cookie = `${SSO_COOKIE}=${signSso(SECRET, { uid: "u", email: "olga@paper.test", owner: true }, s.clock.now())}`;
    const feed = new AlertFeed();   // consumer 1: what the editor and admin show (toast + bell)
    const sub = await watch(base, cookie, feed);
    const tick = async () => s.alerts.tick(await s.snapshot(true));

    s.docker.stop("worker");
    await tick(); s.clock.advance(125_000);
    await tick(); await tick(); s.clock.advance(60_000); await tick();   // many looks, one alert
    await until(() => feed.getSnapshot().items.length >= 1);

    // consumer 2: Telegram
    expect(tg.sent.filter((t) => t.startsWith("RED:")).length).toBe(1);
    // consumer 3: the ops desk's own alert list (JSON and the page)
    const own = await loginCookie(s);
    const json = (await s.app.inject({ method: "GET", url: "/ops/alerts", headers: { cookie: own, accept: "application/json" } })).json();
    expect(json.alerts.filter((a: AlertEvent) => a.kind === "fired").length).toBe(1);
    const html = (await s.app.inject({ method: "GET", url: "/alerts", headers: { cookie: own } })).body;
    expect(html.match(/data-alert-id=/g)?.length).toBe(1);
    // the toast feed
    const snap = feed.getSnapshot();
    expect(snap.items.length).toBe(1); expect(snap.toasts.length).toBe(1); expect(snap.unread).toBe(1);
    expect(snap.toasts[0]!.text).toMatch(/worker/i);
    expect(snap.toasts[0]!.tone).toBe("alert");
    // one id everywhere
    const id = json.alerts[0].id as string;
    expect(snap.items[0]!.id).toBe(id);
    const lines = fs.readFileSync(path.join(s.cfg.stateDir, "alerts.jsonl"), "utf8").trim().split("\n");
    expect(lines.length).toBe(1); expect(JSON.parse(lines[0]!).id).toBe(id);
    expect(fs.existsSync(s.cfg.alertsLogFile)).toBe(false); // Telegram worked: the file is only the fallback

    // a screen that reconnects (or a second tab) gets the same alert again: still one toast, one row
    await sub.stop();
    const again = await watch(base, cookie, feed);
    await new Promise((r) => setTimeout(r, 300));
    expect(feed.getSnapshot().items.length).toBe(1); expect(feed.getSnapshot().toasts.length).toBe(1);
    // the hub itself refuses to take the same id twice
    expect(await s.hub.emit({ id, episode: "x", kind: "fired", key: "k", title: "t", text: "t", phone: "RED: again" })).toBeNull();
    expect(tg.sent.length).toBe(1);

    // fixed: one more of each, and the red toast is replaced by a plain "fixed" note
    await s.fixes.restart("worker");
    await tick(); await tick();
    await until(() => feed.getSnapshot().items.length >= 2);
    expect(tg.sent.filter((t) => t.startsWith("FIXED:")).length).toBe(1);
    expect(tg.sent.length).toBe(2);
    const after = feed.getSnapshot();
    expect(after.items.map((a) => a.kind).sort()).toEqual(["fired", "resolved"]);
    expect(after.toasts.map((t) => t.tone)).toEqual(["ok"]);
    const json2 = (await s.app.inject({ method: "GET", url: "/ops/alerts", headers: { cookie: own, accept: "application/json" } })).json();
    expect(json2.alerts.length).toBe(2); expect(json2.firing).toEqual([]);
    await again.stop();
    await s.app.close();
  });

  it("with no Telegram the phone line goes to the alerts file once, and the screens still get the alert", async () => {
    const s = mkStack({ cfgOver: { SSO_SECRET: SECRET } });
    const feedLines: string[] = [];
    s.hub.subscribe((r) => feedLines.push(r.id));
    s.docker.stop("worker");
    const tick = async () => s.alerts.tick(await s.snapshot(true));
    await tick(); s.clock.advance(125_000); await tick(); await tick();
    expect(feedLines.length).toBe(1);
    expect(fs.readFileSync(s.cfg.alertsLogFile, "utf8").match(/RED:/g)?.length).toBe(1);
  });

  it("the alert history survives a restart of the desk and is not sent again", async () => {
    const tg = fake();
    const s = mkStack({ telegram: tg });
    s.docker.stop("worker");
    const tick = async () => s.alerts.tick(await s.snapshot(true));
    await tick(); s.clock.advance(125_000); await tick();
    expect(tg.sent.length).toBe(1);
    const { AlertHub } = await import("../src/alertlog.js");
    const { AlertSender, FileChannel } = await import("../src/alerts.js");
    const hub2 = new AlertHub({ stateDir: s.cfg.stateDir, sender: new AlertSender(tg, new FileChannel(s.cfg.alertsLogFile)), link: "/" });
    expect(hub2.recent().length).toBe(1);
    expect(hub2.firing().length).toBe(1);
    const id = hub2.recent()[0]!.id;
    expect(await hub2.emit({ id, episode: "e", kind: "fired", key: "k", title: "t", text: "t", phone: "RED: again" })).toBeNull();
    expect(tg.sent.length).toBe(1);
  });
});
