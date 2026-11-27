import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { allTokens, contrast, contrastTable, forbidden, pairs, palette } from "../src/tokens.js";
import { resolveLinks } from "../src/links.js";
import { AlertFeed, openStream, connectAlerts, type AlertEvent } from "../src/live.js";
import { topBarHtml } from "../src/html.js";

const css = fs.readFileSync(new URL("../theme.css", import.meta.url), "utf8");

describe("tokens", () => {
  it("theme.css and tokens.ts carry the same colours", () => {
    const names: Record<string, string> = { press: "--press", cream: "--cream", proof: "--proof", plate: "--plate", grey: "--grey", brass: "--brass", paper: "--paper", cream2: "--cream-2", stage: "--stage", line: "--line", ok: "--ok" };
    for (const [k, v] of Object.entries(allTokens)) {
      const m = new RegExp(`${names[k]}:\\s*(#[0-9A-Fa-f]{6})`).exec(css);
      expect(m?.[1]?.toUpperCase(), k).toBe(v.toUpperCase());
    }
  });
  it("uses exactly the agreed palette", () => {
    expect(palette).toEqual({ press: "#111111", cream: "#F4EFE6", proof: "#E63B2E", plate: "#1F4FFF", grey: "#5C5C5C", brass: "#B08D3C" });
  });
  it("every pair the chrome uses passes WCAG AA for its kind", () => {
    for (const r of contrastTable()) expect(r.pass, `${r.use}: ${r.ratio} < ${r.need}`).toBe(true);
    expect(pairs.length).toBeGreaterThan(15);
  });
  it("the forbidden pairs really are bad (so nobody 'fixes' the rule by accident)", () => {
    for (const r of contrastTable(forbidden)) expect(r.pass, r.use).toBe(false);
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
  });
  it("css has no hard-coded text colours outside the tokens (only var() and the transparent/hover tints)", () => {
    const hex = [...css.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((m) => m[0].toUpperCase());
    const allowed = new Set([...Object.values(allTokens).map((v) => v.toUpperCase()), "#EE5A4E"]);
    for (const h of hex) expect(allowed.has(h), h).toBe(true);
    expect(contrast("#EE5A4E", palette.press)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("links", () => {
  it("same host and standard ports locally, swapped names on a domain, overrides win", () => {
    expect(resolveLinks({ protocol: "http:", hostname: "127.0.0.1", port: "8100" })).toEqual({ editor: "http://127.0.0.1:8100/", admin: "http://127.0.0.1:8100/admin/", reader: "http://127.0.0.1:8102/", ops: "http://127.0.0.1:8101/" });
    const p = resolveLinks({ protocol: "https:", hostname: "ops.example.test", port: "" });
    expect(p.editor).toBe("https://app.example.test/");
    expect(p.reader).toBe("https://epaper.example.test/");
    expect(resolveLinks({ protocol: "https:", hostname: "app.example.test", port: "" }, { ops: "https://x.test/" }).ops).toBe("https://x.test/");
  });
});

describe("top bar (HTML version)", () => {
  const links = resolveLinks({ protocol: "http:", hostname: "127.0.0.1", port: "8101" });
  it("shows the ops link to owners only, marks the current app, escapes names", () => {
    const o = topBarHtml({ app: "admin", links, user: { name: "<b>Ana</b>" }, isOwner: false, signOutHref: "/logout" });
    expect(o).not.toContain(">Ops desk<");
    expect(o).toContain('aria-current="page">Admin');
    expect(o).toContain("&lt;b&gt;Ana&lt;/b&gt;");
    expect(topBarHtml({ app: "ops", links, user: { name: "Owner" }, isOwner: true, bell: true })).toContain(">Ops desk<");
    expect(topBarHtml({ app: "ops", links, isOwner: true, bell: true })).toContain('id="ep-bell-count"');
  });
});

const ev = (id: string, over: Partial<AlertEvent> = {}): AlertEvent => ({ id, episode: id.split(":")[0]!, kind: "fired", key: "k", title: "The worker stopped", text: "Press fix.", at: "2026-11-27T10:00:00Z", seq: 1, ...over });

describe("alert feed", () => {
  it("takes one id once: one toast, one row, one unread", () => {
    const f = new AlertFeed();
    expect(f.push(ev("a:fired"))).toBe(true);
    expect(f.push(ev("a:fired"))).toBe(false);
    const s = f.getSnapshot();
    expect([s.items.length, s.toasts.length, s.unread]).toEqual([1, 1, 1]);
    f.markAllRead();
    expect(f.getSnapshot().unread).toBe(0);
  });
  it("fixed again replaces the red toast of the same alert; history does not pop toasts; dismiss removes", () => {
    const f = new AlertFeed();
    f.push(ev("a:fired", { seq: 1 }));
    f.push(ev("a:resolved", { kind: "resolved", seq: 2, title: "Fixed" }));
    expect(f.getSnapshot().toasts.map((t) => t.tone)).toEqual(["ok"]);
    f.dismiss("a:resolved");
    expect(f.getSnapshot().toasts).toEqual([]);
    f.push(ev("old:fired", { seq: 0 }), { live: false });
    expect(f.getSnapshot().toasts).toEqual([]);
    expect(f.getSnapshot().lastSeq).toBe(2);
  });
  it("remembers what was read", () => {
    let mem: string[] = [];
    const st = { get: () => mem, set: (v: string[]) => { mem = v; } };
    const a = new AlertFeed({ storage: st }); a.push(ev("x:fired")); a.markAllRead();
    const b = new AlertFeed({ storage: st }); b.push(ev("x:fired"), { live: false });
    expect(b.getSnapshot().unread).toBe(0);
  });
});

class FakeES {
  static all: FakeES[] = [];
  onopen: (() => void) | null = null; onerror: (() => void) | null = null; closed = false;
  handlers: Record<string, (e: unknown) => void> = {};
  constructor(public url: string, public init?: { withCredentials?: boolean }) { FakeES.all.push(this); }
  addEventListener(n: string, f: (e: unknown) => void) { this.handlers[n] = f; }
  close() { this.closed = true; }
  emit(n: string, data: unknown, id = "") { this.handlers[n]?.({ data: JSON.stringify(data), lastEventId: id }); }
}

describe("openStream", () => {
  it("reconnects with a growing delay, polls every 15 s while down, stops polling when live again", () => {
    vi.useFakeTimers(); FakeES.all = [];
    const poll = vi.fn(), status: string[] = [];
    const s = openStream({ url: "/v1/events", EventSourceCtor: FakeES as never, on: { x: () => undefined }, poll, onStatus: (x) => status.push(x), backoff: { min: 1000, max: 4000 } });
    expect(FakeES.all.length).toBe(1);
    FakeES.all[0]!.onerror!();
    expect(poll).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000); expect(FakeES.all.length).toBe(2);
    FakeES.all[1]!.onerror!();
    vi.advanceTimersByTime(2000); expect(FakeES.all.length).toBe(3);
    FakeES.all[2]!.onerror!();
    vi.advanceTimersByTime(4000); expect(FakeES.all.length).toBe(4);
    vi.advanceTimersByTime(15_000); expect(poll.mock.calls.length).toBeGreaterThanOrEqual(2);
    const n = poll.mock.calls.length;
    FakeES.all[3]!.onopen!();
    vi.advanceTimersByTime(60_000); expect(poll.mock.calls.length).toBe(n);
    expect(status).toEqual(["down", "connecting", "down", "connecting", "down", "connecting", "live"]);
    s.close(); vi.advanceTimersByTime(60_000); expect(FakeES.all.length).toBe(4);
    vi.useRealTimers();
  });
  it("without EventSource at all it still polls", () => {
    vi.useFakeTimers();
    const poll = vi.fn();
    const old = (globalThis as { EventSource?: unknown }).EventSource; delete (globalThis as { EventSource?: unknown }).EventSource;
    const s = openStream({ url: "/x", on: {}, poll, pollMs: 15_000 });
    vi.advanceTimersByTime(31_000);
    expect(poll.mock.calls.length).toBe(3);
    s.close(); (globalThis as { EventSource?: unknown }).EventSource = old; vi.useRealTimers();
  });
  it("connectAlerts: the same alert arriving by snapshot and by live event shows once; reconnect asks for 'since'", () => {
    vi.useFakeTimers(); FakeES.all = [];
    const feed = new AlertFeed();
    const st = connectAlerts({ base: "http://ops.test/", feed, EventSourceCtor: FakeES as never, backoff: { min: 10, max: 10 } });
    const a = ev("z:fired", { seq: 5 });
    FakeES.all[0]!.emit("snapshot", { recent: [a], firing: [a] });
    FakeES.all[0]!.emit("alert", a);
    expect(feed.getSnapshot().toasts.length).toBe(1);
    expect(feed.getSnapshot().items.length).toBe(1);
    expect(FakeES.all[0]!.init?.withCredentials).toBe(true);
    FakeES.all[0]!.onerror!(); vi.advanceTimersByTime(20);
    expect(FakeES.all[1]!.url).toBe("http://ops.test/ops/alerts/stream?since=5");
    st.close(); vi.useRealTimers();
  });
});
