/**
 * Live streams for every app: a Server-Sent-Events client that reconnects by itself and falls back to polling, and the
 * alert feed (bell + toasts) that never shows the same alert twice. Plain ES2020, no framework, no DOM needed: the same
 * file runs in the React apps, in the reader, and (as /assets/theme/live.js) on the ops desk's server-rendered pages.
 */

export type StreamStatus = "connecting" | "live" | "down";

export interface StreamOpts {
  /** A string, or a function called on every (re)connect (so it can carry "everything after id N"). */
  url: string | (() => string);
  withCredentials?: boolean;
  /** Handlers by SSE event name. `data` is the parsed JSON (or the raw text when it is not JSON). */
  on: Record<string, (data: any, lastEventId: string) => void>;
  onStatus?: (s: StreamStatus) => void;
  /** Called every `pollMs` while the stream is not live (blocked, proxy buffering, server restarting). */
  poll?: () => unknown;
  pollMs?: number;
  /** Reconnect delay grows from min to max, in ms. */
  backoff?: { min: number; max: number };
  EventSourceCtor?: typeof EventSource;
}
export interface Stream { close(): void; status(): StreamStatus }

export function openStream(o: StreamOpts): Stream {
  const ES = o.EventSourceCtor ?? (typeof EventSource !== "undefined" ? EventSource : undefined);
  const min = o.backoff?.min ?? 1000, max = o.backoff?.max ?? 30_000, pollMs = o.pollMs ?? 15_000;
  let es: EventSource | undefined, closed = false, st: StreamStatus = "connecting", delay = min;
  let retry: ReturnType<typeof setTimeout> | undefined, poller: ReturnType<typeof setInterval> | undefined;
  const set = (s: StreamStatus) => { if (st !== s) { st = s; o.onStatus?.(s); } };
  const stopPoll = () => { if (poller) { clearInterval(poller); poller = undefined; } };
  const startPoll = () => {
    if (!o.poll || poller || closed) return;
    const run = () => { try { void Promise.resolve(o.poll!()).catch(() => undefined); } catch { /* polling is best effort */ } };
    run();
    poller = setInterval(run, pollMs);
  };
  const connect = () => {
    if (closed) return;
    if (!ES) { set("down"); startPoll(); return; }
    set("connecting");
    try { es = new ES(typeof o.url === "function" ? o.url() : o.url, { withCredentials: !!o.withCredentials }); }
    catch { fail(); return; }
    es.onopen = () => { delay = min; stopPoll(); set("live"); };
    es.onerror = () => fail();
    for (const [name, fn] of Object.entries(o.on)) {
      es.addEventListener(name, (e: Event) => {
        const m = e as MessageEvent;
        let d: unknown = m.data;
        try { d = JSON.parse(String(m.data)); } catch { /* keep the text */ }
        // a message proves the stream works even if onopen was missed
        if (st !== "live") { delay = min; stopPoll(); set("live"); }
        fn(d, m.lastEventId ?? "");
      });
    }
  };
  const fail = () => {
    es?.close(); es = undefined;
    if (closed) return;
    set("down");
    startPoll();
    clearTimeout(retry);
    retry = setTimeout(connect, delay);
    delay = Math.min(max, delay * 2);
  };
  connect();
  return { close() { closed = true; es?.close(); clearTimeout(retry); stopPoll(); }, status: () => st };
}

/* ---------------- alerts ---------------- */

export interface AlertEvent {
  /** One id per thing that happened: an alert starting, a reminder, the alert being fixed. The same id is never shown twice. */
  id: string;
  /** The stream position (only the ops desk sets it). */
  seq?: number;
  /** One id for the whole life of one alert (start .. fixed). */
  episode: string;
  kind: "fired" | "reminder" | "resolved" | "test";
  key: string;
  title: string;
  /** Plain words. */
  text: string;
  at: string;
  /** Where to fix it: the ops desk. */
  link?: string;
}
export interface Toast { id: string; tone: "alert" | "ok" | "info"; title?: string; text: string; href?: string; hrefLabel?: string; episode?: string }
export interface FeedSnapshot { items: AlertEvent[]; toasts: Toast[]; unread: number; lastSeq: number }

export interface FeedOpts {
  /** Remembers which alerts were read (localStorage in the browser). */
  storage?: { get(): string[]; set(v: string[]): void };
  /** Fix-it toasts ("fixed again") and info toasts go away by themselves after this; alerts stay until dismissed. */
  autoDismissMs?: number;
  maxItems?: number;
}

export class AlertFeed {
  private items: AlertEvent[] = [];
  private toasts: Toast[] = [];
  private seen = new Set<string>();
  private read: Set<string>;
  private last = 0;
  private fns = new Set<() => void>();
  private snap: FeedSnapshot = { items: [], toasts: [], unread: 0, lastSeq: 0 };
  constructor(private o: FeedOpts = {}) { this.read = new Set(o.storage?.get() ?? []); this.rebuild(false); }

  subscribe = (fn: () => void) => { this.fns.add(fn); return () => void this.fns.delete(fn); };
  getSnapshot = () => this.snap;
  private rebuild(notify = true) {
    const unread = this.items.filter((a) => !this.read.has(a.id)).length;
    this.snap = { items: this.items, toasts: this.toasts, unread, lastSeq: this.last };
    if (notify) this.fns.forEach((f) => f());
  }

  /**
   * Take one alert. Returns false (and changes nothing) when this id was already taken. `live: false` is for history that
   * arrives when the page opens: it fills the bell but does not pop a toast.
   */
  push(a: AlertEvent, o: { live?: boolean } = {}): boolean {
    if (this.seen.has(a.id)) return false;
    this.seen.add(a.id);
    if (typeof a.seq === "number") this.last = Math.max(this.last, a.seq);
    this.items = [a, ...this.items].sort((x, y) => (y.seq ?? 0) - (x.seq ?? 0) || y.at.localeCompare(x.at)).slice(0, this.o.maxItems ?? 50);
    if (o.live !== false) {
      // "fixed again" replaces the red toast of the same alert
      if (a.kind === "resolved") this.toasts = this.toasts.filter((t) => t.episode !== a.episode);
      const tone: Toast["tone"] = a.kind === "resolved" ? "ok" : a.kind === "test" ? "info" : "alert";
      this.toasts = [...this.toasts, { id: a.id, tone, title: a.title, text: a.text, href: a.link, hrefLabel: "Open in ops desk", episode: a.episode }];
      if (tone !== "alert" && this.o.autoDismissMs) setTimeout(() => this.dismiss(a.id), this.o.autoDismissMs);
    }
    this.rebuild();
    return true;
  }
  dismiss(id: string) {
    if (!this.toasts.some((t) => t.id === id)) return;
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.rebuild();
  }
  markAllRead() {
    this.items.forEach((a) => this.read.add(a.id));
    this.o.storage?.set([...this.read].slice(-200));
    this.rebuild();
  }
}

/** The ops desk's alert stream, as the bell and the toasts need it. */
/** The desk sends "/" as the place to fix things; on another app's page that must point at the desk, not at the app. */
const aimAtDesk = (base: string, a: AlertEvent): AlertEvent => { try { return { ...a, link: new URL(a.link ?? "/", base.endsWith("/") ? base : base + "/").href }; } catch { return a; } };

export function connectAlerts(o: { base: string; feed: AlertFeed; withCredentials?: boolean; EventSourceCtor?: typeof EventSource; onStatus?: (s: StreamStatus) => void; backoff?: StreamOpts["backoff"] }): Stream {
  const url = () => `${o.base.replace(/\/$/, "")}/ops/alerts/stream?since=${o.feed.getSnapshot().lastSeq}`;
  return openStream({
    url, withCredentials: o.withCredentials ?? true, EventSourceCtor: o.EventSourceCtor, onStatus: o.onStatus, backoff: o.backoff ?? { min: 2000, max: 60_000 },
    on: {
      // what is already on the list when the page opens: fills the bell, no toast ("firing" ones do pop up, once)
      snapshot: (d: { recent?: AlertEvent[]; firing?: AlertEvent[] }) => {
        const firing = new Set((d.firing ?? []).map((a) => a.id));
        for (const a of [...(d.recent ?? [])].reverse()) o.feed.push(aimAtDesk(o.base, a), { live: firing.has(a.id) });
      },
      alert: (a: AlertEvent) => void o.feed.push(aimAtDesk(o.base, a)),
    },
  });
}

/** The bell remembers what was read in this browser only. */
export function browserStorage(key = "epaper.alerts.read"): FeedOpts["storage"] {
  return {
    get: () => { try { return JSON.parse(localStorage.getItem(key) ?? "[]") as string[]; } catch { return []; } },
    set: (v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private window */ } },
  };
}
