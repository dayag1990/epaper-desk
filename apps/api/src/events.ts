import type { FastifyReply, FastifyRequest } from "fastify";
import pg from "pg";
import { prisma } from "./db.js";
import { databaseUrl } from "./env.js";

/**
 * Live updates without Redis: whoever changes something calls publishEvent() AFTER the database write; Postgres NOTIFY carries
 * it to every API process; each API process LISTENs once and hands it to the browsers that hold a /v1/events stream.
 * Nothing here is a source of truth: a missed event only means a screen refreshes a little later (the pages also poll).
 */
export const CHANNEL = "epaper_events";

export type WireEvent =
  | { type: "page.updated"; paper_id: string; page_id: string; edition_id: string; rev: number; fill: number | null; status: string; by?: string | null }
  | { type: "page.fit"; paper_id: string; page_id: string; edition_id: string; rev: number; fill: number | null; state: "ok" | "low" | "over" | null; overflow: boolean }
  | { type: "edition.changed"; paper_id: string; edition_id: string }
  | { type: "edition.published" | "edition.updated"; paper_id: string; ep_edition_id: string; edition_id: string | null; date: string; version: number }
  | { type: "edition.exported"; paper_id: string; export_id: string; edition_id: string | null; format: string; status: string };

/** Only these may go to people who are not signed in (the public reader). They carry no private data. */
export const PUBLIC_TYPES = new Set(["edition.published", "edition.updated"]);

/** Write the event to Postgres NOTIFY. Never throws: a failed announcement must not fail the save that caused it. */
export async function publishEvent(ev: WireEvent): Promise<void> {
  try {
    await prisma.$executeRaw`select pg_notify('epaper_events', ${JSON.stringify(ev)})`;
  } catch (e) {
    console.error("event not announced:", (e as Error).message);
  }
}

interface Sub { paper_id: string; types: Set<string> | null; send(id: number, ev: WireEvent | { type: "resync" }): void }
export interface Listener { close(): void }
export type ListenFactory = (onEvent: (ev: WireEvent) => void, onDown: () => void) => Promise<Listener>;

export const pgListen: ListenFactory = async (onEvent, onDown) => {
  const c = new pg.Client({ connectionString: databaseUrl() });
  c.on("error", () => onDown());
  c.on("end", () => onDown());
  c.on("notification", (m) => {
    if (m.channel !== CHANNEL || !m.payload) return;
    try { onEvent(JSON.parse(m.payload) as WireEvent); } catch { /* ignore a payload we cannot read */ }
  });
  await c.connect();
  await c.query(`LISTEN ${CHANNEL}`);
  return { close: () => void c.end().catch(() => undefined) };
};

export class EventHub {
  private subs = new Set<Sub>();
  private seq = 0;
  private listener?: Listener;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = true;
  private delay = 1000;
  connected = false;
  constructor(private factory: ListenFactory = pgListen) {}

  subscribe(paper_id: string, send: Sub["send"], types: Set<string> | null = null): () => void {
    const s: Sub = { paper_id, types, send };
    this.subs.add(s);
    return () => void this.subs.delete(s);
  }
  get size() { return this.subs.size; }
  dispatch(ev: WireEvent) {
    const id = ++this.seq;
    for (const s of this.subs) if (s.paper_id === ev.paper_id && (!s.types || s.types.has(ev.type))) s.send(id, ev);
  }
  start() {
    this.stopped = false;
    void this.connect();
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.listener?.close();
    this.listener = undefined;
    this.connected = false;
  }
  private async connect() {
    if (this.stopped) return;
    try {
      const l = await this.factory((ev) => this.dispatch(ev), () => this.down());
      if (this.stopped) { l.close(); return; }
      this.listener = l; this.connected = true; this.delay = 1000;
      // anything announced while we were away is lost: tell every screen to look again
      if (this.seq > 0 || this.subs.size) for (const s of this.subs) s.send(++this.seq, { type: "resync" });
    } catch { this.down(); }
  }
  private down() {
    if (this.stopped) return;
    this.connected = false;
    this.listener?.close(); this.listener = undefined;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.connect(), this.delay);
    this.delay = Math.min(30_000, this.delay * 2);
  }
}

export const hub = new EventHub();

/** One Server-Sent-Events response. The headers say "do not buffer" so a proxy passes events straight on. */
export function openSse(req: FastifyRequest, reply: FastifyReply, hello: Record<string, unknown>, join: (send: Sub["send"]) => () => void, extra: Record<string, string> = {}) {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform", connection: "keep-alive", "x-accel-buffering": "no", ...extra });
  const write = (s: string) => { try { res.write(s); } catch { /* closed */ } };
  write(`retry: 3000\nevent: hello\ndata: ${JSON.stringify(hello)}\n\n`);
  const leave = join((id, ev) => write(`id: ${id}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`));
  const beat = setInterval(() => write(": ping\n\n"), 20_000);
  const done = () => { clearInterval(beat); leave(); };
  req.raw.on("close", done);
  res.on("error", done);
}
