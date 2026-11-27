import fs from "node:fs";
import path from "node:path";
import type { AlertEvent } from "@epaper/theme";
import type { AlertSender } from "./alerts.js";

export interface AlertRecord extends AlertEvent { seq: number }
export type EmitInput = Omit<AlertEvent, "seq" | "at" | "link"> & { /** the line for Telegram / the alerts file */ phone: string };

/**
 * THE one alerts stream. Everything that wants to tell the owner something calls emit() here, and only here:
 *   1. the line is appended to alerts.jsonl (the log, and the ops desk's own alert list reads it),
 *   2. every open screen gets it over the Server-Sent-Events stream (toasts and the bell),
 *   3. the phone channel gets it (Telegram when set up, else the alerts file).
 * One id goes through all three exactly once: emit() with an id it has already taken does nothing at all.
 * Plain JSON lines on disk: no Postgres, no API.
 */
export class AlertHub {
  private file: string;
  private ids = new Set<string>();
  private recentRows: AlertRecord[] = [];
  private seq = 0;
  private subs = new Set<(r: AlertRecord) => void>();
  constructor(private o: { stateDir: string; sender: AlertSender; link: string; now?: () => number }) {
    this.file = path.join(o.stateDir, "alerts.jsonl");
    try {
      const lines = fs.readFileSync(this.file, "utf8").split("\n").filter(Boolean);
      for (const l of lines.slice(-2000)) {
        try { const r = JSON.parse(l) as AlertRecord; this.ids.add(r.id); this.seq = Math.max(this.seq, r.seq); this.recentRows.push(r); } catch { /* a torn last line */ }
      }
      this.recentRows = this.recentRows.slice(-200);
    } catch { /* first start */ }
  }
  private now() { return (this.o.now ?? Date.now)(); }

  async emit(e: EmitInput): Promise<{ record: AlertRecord; via: string; telegram_error?: string } | null> {
    if (this.ids.has(e.id)) return null;
    const { phone, ...ev } = e;
    const record: AlertRecord = { ...ev, link: this.o.link, seq: ++this.seq, at: new Date(this.now()).toISOString() };
    this.ids.add(e.id);
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    fs.appendFileSync(this.file, JSON.stringify(record) + "\n", { mode: 0o600 });
    this.recentRows.push(record);
    if (this.recentRows.length > 200) this.recentRows.shift();
    for (const fn of this.subs) { try { fn(record); } catch { /* a closed screen */ } }
    const sent = await this.o.sender.send(phone);
    return { record, ...sent };
  }

  /** Newest first. */
  recent(n = 50, afterSeq = 0): AlertRecord[] {
    return this.recentRows.filter((r) => r.seq > afterSeq).slice(-n).reverse();
  }
  /** Alerts that started (or were repeated) and have not been fixed yet. */
  firing(): AlertRecord[] {
    const done = new Set(this.recentRows.filter((r) => r.kind === "resolved").map((r) => r.episode));
    const seen = new Set<string>();
    const out: AlertRecord[] = [];
    for (const r of [...this.recentRows].reverse()) {
      if ((r.kind !== "fired" && r.kind !== "reminder") || done.has(r.episode) || seen.has(r.episode)) continue;
      seen.add(r.episode); out.push(r);
    }
    return out;
  }
  subscribe(fn: (r: AlertRecord) => void): () => void { this.subs.add(fn); return () => void this.subs.delete(fn); }
  get lastSeq() { return this.seq; }
}
