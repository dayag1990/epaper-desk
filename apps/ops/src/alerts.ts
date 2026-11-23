import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { evalExpr, MissingMetric, type Metrics } from "./expr.js";
import type { Snapshot } from "./health.js";
import { JsonFile } from "./store.js";

const Rule = z.object({
  id: z.string(),
  kind: z.enum(["service_red", "metric"]).default("metric"),
  expr: z.string().optional(), // metric rules: fires while TRUE
  for_s: z.number().min(0).default(0),
  message: z.string(),
  on_missing: z.enum(["fire", "ignore"]).default("ignore"), // metric not readable: backups say fire, API-fed ones ignore
});
export type AlertRule = z.infer<typeof Rule>;
const File = z.object({ repeat_s: z.number().default(6 * 3600), rules: z.array(Rule) });

export function loadAlertRules(file: string): { repeat_s: number; rules: AlertRule[] } {
  let raw: string;
  try { raw = fs.readFileSync(file, "utf8"); } catch { throw new Error(`The alert rules (${file}) are missing, so no alerts would be sent. Put ops/alerts.yml back.`); }
  const p = File.safeParse(YAML.parse(raw));
  if (!p.success) throw new Error(`The alert rules (${file}) are not written correctly: ${p.error.issues[0]?.path.join(".")} ${p.error.issues[0]?.message}.`);
  return p.data;
}

export interface AlertChannel { name: string; send(text: string): Promise<void> }

export class FileChannel implements AlertChannel {
  name = "file";
  constructor(private file: string, private now: () => number = Date.now) {}
  async send(text: string) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, `${new Date(this.now()).toISOString()} ${text.replace(/\n/g, " | ")}\n`);
  }
}
export class TelegramChannel implements AlertChannel {
  name = "telegram";
  constructor(private token: string, private chat: string, private fetcher: typeof fetch = fetch) {}
  async send(text: string) {
    const r = await this.fetcher(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: this.chat, text }), signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`Telegram answered ${r.status}`);
  }
}
/** Telegram when configured, else the file. If Telegram fails the file still gets the line, so nothing is lost. */
export class AlertSender {
  constructor(private tg: AlertChannel | null, private file: AlertChannel) {}
  async send(text: string): Promise<{ via: string; telegram_error?: string }> {
    if (this.tg) {
      try { await this.tg.send(text); return { via: "telegram" }; } catch (e) {
        await this.file.send(`(Telegram failed: ${(e as Error).message}) ${text}`);
        return { via: "file", telegram_error: (e as Error).message };
      }
    }
    await this.file.send(text);
    return { via: "file" };
  }
  get channel() { return this.tg ? "telegram" : "file"; }
}

interface AlertMem { since: number; notified: number | null }

export class AlertEngine {
  private mem: JsonFile<Record<string, AlertMem>>;
  constructor(private o: { rules: () => { repeat_s: number; rules: AlertRule[] }; sender: AlertSender; stateDir: string; link: string; now?: () => number }) {
    this.mem = new JsonFile(path.join(o.stateDir, "alerts-state.json"), () => ({}));
  }
  private now() { return (this.o.now ?? Date.now)(); }

  private conditions(snap: Snapshot): { key: string; firing: boolean; text: string; for_s: number }[] {
    const out: { key: string; firing: boolean; text: string; for_s: number }[] = [];
    const { rules } = this.o.rules();
    for (const r of rules) {
      if (r.kind === "service_red") {
        for (const s of snap.services) {
          if (["disk", "memory", "queue-depth", "dead-letter", "backups", "last-backup-age", "last-drill", "certificate"].includes(s.name)) continue; // those have their own rules
          out.push({ key: `${r.id}:${s.name}`, firing: s.state === "red", for_s: r.for_s, text: `${r.message.replace("{service}", s.title)} ${s.last_error ?? ""}`.trim() });
        }
      } else if (r.expr) {
        let firing = false;
        try { firing = evalExpr(r.expr, snap.metrics as Metrics); } catch (e) { firing = e instanceof MissingMetric && r.on_missing === "fire"; }
        out.push({ key: r.id, firing, for_s: r.for_s, text: r.message });
      }
    }
    return out;
  }

  async tick(snap: Snapshot): Promise<{ sent: string[] }> {
    const t = this.now(), { repeat_s } = this.o.rules();
    const mem = this.mem.read();
    const sent: string[] = [];
    for (const c of this.conditions(snap)) {
      const m = mem[c.key];
      if (c.firing) {
        if (!m) { mem[c.key] = { since: t, notified: null }; }
        const cur = mem[c.key]!;
        const due = t - cur.since >= c.for_s * 1000;
        if (due && (cur.notified === null || t - cur.notified >= repeat_s * 1000)) {
          const text = `RED: ${c.text}\nOpen the ops desk and press the fix button: ${this.o.link}`;
          await this.o.sender.send(text);
          cur.notified = t; sent.push(c.key);
        }
      } else if (m) {
        if (m.notified !== null) { await this.o.sender.send(`FIXED: ${c.text.split(".")[0]} is fine again.`); sent.push(`fixed:${c.key}`); }
        delete mem[c.key];
      }
    }
    this.mem.write(mem);
    return { sent };
  }

  async test(): Promise<{ via: string; message: string }> {
    const r = await this.o.sender.send(`TEST: the ops desk can reach you. Nothing is wrong. ${this.o.link}`);
    return { via: r.via, message: r.via === "telegram" ? "A test message was sent to Telegram." : `Telegram is not set up${r.telegram_error ? ` or failed (${r.telegram_error})` : ""}, so the test line was written to the alerts file instead.` };
  }
}
