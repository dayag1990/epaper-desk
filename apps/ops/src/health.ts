import fs from "node:fs";
import tls from "node:tls";
import { ServiceEntrySchema } from "@epaper/core";
import { z } from "zod";
import YAML from "yaml";
import type { ApiClient } from "./api-client.js";
import type { BackupDriver, BackupStatus } from "./backup.js";
import type { ContainerInfo, DockerDriver } from "./docker.js";
import { evalExpr, MissingMetric, type Metrics } from "./expr.js";
import { readHost } from "./host.js";
import { JsonFile } from "./store.js";
import path from "node:path";

// ---------- services.yml ----------
const Entry = ServiceEntrySchema.extend({
  title: z.string().optional(), // plain name shown on the desk
  warn: z.string().optional(), // amber zone while the ready rule still holds
  todo: z.string().optional(), // what to press / do when red
});
export type ServiceDef = z.infer<typeof Entry>;

export function loadServices(file: string): ServiceDef[] {
  let raw: string;
  try { raw = fs.readFileSync(file, "utf8"); } catch {
    throw new Error(`The service list (${file}) is missing, so the desk does not know what to watch. Put ops/services.yml back.`);
  }
  const parsed = z.array(Entry).safeParse(YAML.parse(raw));
  if (!parsed.success) throw new Error(`The service list (${file}) is not written correctly: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}.`);
  return parsed.data;
}

// ---------- lights ----------
export type Light = "green" | "amber" | "red";
export interface ServiceStatus {
  name: string;
  title: string;
  state: Light;
  since: string; // clock time HH:MM
  since_iso: string;
  last_error: string | null;
  plain: string; // one plain sentence: how it is now
  todo: string | null; // what to press
  fixes: string[];
  value?: string;
}

export type ReadyProbe = (url: string) => Promise<{ status: number; body: unknown } | { error: string }>;
export const realProbe: ReadyProbe = async (url) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
    let body: unknown = null;
    try { body = await r.json(); } catch { /* not json */ }
    return { status: r.status, body };
  } catch (e) {
    return { error: (e as Error).name === "TimeoutError" ? "no answer within 3 seconds" : "cannot connect" };
  }
};

const PLAIN: Record<string, (n: number) => string> = {
  disk_used_pct: (n) => `${n}% used`, disk_free_gb: (n) => `${n} GB free`, mem_available_pct: (n) => `${n}% free`,
  queue_depth: (n) => `${n} waiting`, dead_letter: (n) => `${n} failed`, last_backup_age_min: (n) => `${n} min since the last one`,
  drill_age_days: (n) => `checked ${n} days ago`, cert_days_left: (n) => `${n} days left`, backup_sets_missing: (n) => (n ? `${n} kind(s) missing` : "all there"),
  drill_pass: (n) => (n ? "passed" : "FAILED"),
};
const API_METRICS = new Set(["queue_depth", "dead_letter"]);
const DEFAULT_TODO = "Press the big button to restart it. If it stays red, look at the log.";

export interface HealthDeps {
  docker: DockerDriver; backup: BackupDriver; api: ApiClient;
  services: () => ServiceDef[];
  procDir: string; filesDir: string; stateDir: string;
  opsHost?: string; probe?: ReadyProbe; now?: () => number;
  certProbe?: (host: string) => Promise<number | null>;
}

export interface Snapshot {
  services: ServiceStatus[];
  metrics: Metrics;
  backup: BackupStatus | null;
  backupError: string | null;
  containers: ContainerInfo[];
  dockerError: string | null;
  apiOk: boolean;
}

export async function certDaysLeft(host: string): Promise<number | null> {
  return new Promise((resolve) => {
    const s = tls.connect({ host: process.env.OPS_CERT_PROBE_HOST ?? "caddy", port: 443, servername: host, rejectUnauthorized: false, timeout: 4000 }, () => {
      const c = s.getPeerCertificate();
      s.destroy();
      resolve(c?.valid_to ? Math.floor((new Date(c.valid_to).getTime() - Date.now()) / 86400_000) : null);
    });
    s.on("error", () => resolve(null));
    s.on("timeout", () => { s.destroy(); resolve(null); });
  });
}

const minutesSince = (iso: string | undefined, now: number) => (iso ? Math.max(0, (now - new Date(iso).getTime()) / 60000) : undefined);

export class Health {
  private lights: JsonFile<Record<string, { state: Light; since: string }>>;
  constructor(private d: HealthDeps) { this.lights = new JsonFile(path.join(d.stateDir, "lights.json"), () => ({})); }
  private now() { return (this.d.now ?? Date.now)(); }

  async metrics(): Promise<{ m: Metrics; backup: BackupStatus | null; backupError: string | null; apiOk: boolean }> {
    const host = readHost(this.d.procDir, this.d.filesDir);
    const m: Metrics = { ...host };
    let backup: BackupStatus | null = null, backupError: string | null = null;
    try {
      backup = await this.d.backup.status();
      const t = this.now();
      const fa = minutesSince(backup.files?.at, t), wa = minutesSince(backup.wal?.at, t);
      if (fa !== undefined) m.files_age_min = Math.round(fa * 10) / 10;
      if (wa !== undefined) m.wal_age_s = Math.round(wa * 60);
      if (fa !== undefined && wa !== undefined) m.last_backup_age_min = Math.round(Math.max(fa, wa) * 10) / 10;
      m.backup_sets_missing = [backup.files, backup.wal, backup.base].filter((x) => !x).length;
      if (backup.drill) { m.drill_age_days = Math.round(((minutesSince(backup.drill.at, t) ?? 0) / 1440) * 10) / 10; m.drill_pass = backup.drill.result === "pass" ? 1 : 0; }
    } catch (e) { backupError = (e as Error).message; }
    let apiOk = false;
    const qs = await this.d.api.queueStats();
    if (qs) { apiOk = true; m.queue_depth = qs.queues.reduce((a, q) => a + q.depth, 0); m.dead_letter = qs.dead; }
    if (this.d.opsHost) {
      const days = await (this.d.certProbe ?? certDaysLeft)(this.d.opsHost);
      if (days !== null) m.cert_days_left = days;
    }
    return { m, backup, backupError, apiOk };
  }

  async snapshot(): Promise<Snapshot> {
    const probe = this.d.probe ?? realProbe;
    let containers: ContainerInfo[] = [], dockerError: string | null = null;
    try { containers = await this.d.docker.list(); } catch (e) { dockerError = (e as Error).message; }
    const { m, backup, backupError, apiOk } = await this.metrics();
    let defs: ServiceDef[] = [];
    let listError: string | null = null;
    try { defs = this.d.services(); } catch (e) { listError = (e as Error).message; }
    const out: ServiceStatus[] = [];
    const byName = new Map<string, ServiceStatus>();
    const now = this.now();

    for (const def of defs) {
      const title = def.title ?? def.name;
      let state = "green" as Light, err: string | null = null, plain = `${title} is fine.`, todo: string | null = null, value: string | undefined;
      const red = (e: string, t?: string) => { state = "red"; err = e; plain = e; todo = t ?? def.todo ?? DEFAULT_TODO; };
      const amber = (e: string, t?: string) => { state = "amber"; err = e; plain = e; todo = t ?? null; };

      if (def.container) {
        const c = containers.find((x) => x.name === def.container);
        if (dockerError) red(`${title}: the desk cannot ask Docker (${dockerError})`, "Check that the 'dockerproxy' container is running. If it is not, the box needs a restart by the host provider.");
        else if (!c) red(`${title} does not exist: its container was never created or was removed.`, "Press 'Bring everything up'.");
        else if (c.state !== "running") red(`${title} is stopped${c.exitCode ? ` (it crashed with code ${c.exitCode})` : ""}.`, "Press 'Fix it' to start it again. Nothing saved is lost.");
        else if (c.state === "running" && (def.ready === "pg_isready" || def.ready === "container_health")) {
          if (c.health === "healthy") plain = `${title} is running and answering.`;
          else if (c.health === "starting") amber(`${title} is starting up. Wait a minute.`);
          else if (c.health === "unhealthy") red(`${title} is running but not answering.`, "Press 'Fix it'. Your data is safe on disk.");
          else amber(`${title} is running but has no health check, so the desk cannot be sure.`);
        }
      }
      if (state === "green" && /^https?:\/\//.test(def.ready)) {
        const c = def.container ? containers.find((x) => x.name === def.container) : undefined;
        const young = c?.startedAt ? now - new Date(c.startedAt).getTime() < 20_000 : false;
        const r = await probe(def.ready);
        if ("error" in r) {
          if (young) amber(`${title} has just started. Wait a moment.`); else red(`${title} is running but does not answer (${r.error}).`);
        } else if (r.status === 200 && (r.body as { ok?: boolean } | null)?.ok !== false) {
          plain = `${title} is answering.`;
        } else {
          const checks = (r.body as { checks?: Record<string, string> } | null)?.checks ?? {};
          const bad = Object.entries(checks).filter(([, v]) => v !== "ok").map(([k, v]) => `${k}: ${v}`);
          if (young) amber(`${title} is starting up.`); else red(`${title} answers but says it is not ready${bad.length ? ` (${bad.join("; ")})` : ""}.`);
        }
      } else if (state === "green" && def.ready !== "self" && def.ready !== "pg_isready" && def.ready !== "container_health" && /[<>=]/.test(def.ready)) {
        try {
          const okNow = evalExpr(def.ready, m);
          const warn = def.warn ? evalExpr(def.warn, m) : false;
          const used = Object.keys(m).filter((k) => PLAIN[k] && new RegExp(`\\b${k}\\b`).test(def.ready + " " + (def.warn ?? ""))).map((k) => PLAIN[k]!(m[k]!)).join(", ");
          value = used;
          if (!okNow) red(`${title} is out of range (${used}).`);
          else if (warn) amber(`${title} is getting close to a limit (${used}).`, def.todo);
          else plain = `${title} is fine (${used}).`;
        } catch (e) {
          if (e instanceof MissingMetric) {
            if (API_METRICS.has(e.metric)) amber(apiOk ? `${title}: the API does not report this yet.` : `${title}: unknown, because the API is not answering.`, "Fix the API first, then this clears.");
            else if (e.metric === "cert_days_left")
              red(this.d.opsHost ? `${title}: the desk cannot read the certificate.` : `${title}: no website name is set (OPS_HOST is empty), so the certificate cannot be checked.`, "Ask for OPS_HOST to be set in the server settings.");
            else if (e.metric.startsWith("backup") || e.metric.includes("age") || e.metric.startsWith("drill") || e.metric.startsWith("wal") || e.metric.startsWith("files"))
              red(backupError ? `${title}: ${backupError}` : `${title}: there is no backup record at all. Nothing is being protected.`, "Press 'Back up now'. If that fails, the backup bucket or its keys are missing: ask for them to be set.");
            else red(`${title}: the desk cannot read ${e.metric.replace(/_/g, " ")}.`, "Restart the desk. If it stays red, the host folders are not mounted.");
          } else red(`${title}: the rule for it is broken (${(e as Error).message}).`, "The service list needs fixing by a developer.");
        }
      }
      const prev = this.lights.read()[def.name];
      const since = prev && prev.state === state ? prev.since : new Date(now).toISOString();
      const clock = new Date(since);
      const hhmm = `${String(clock.getHours()).padStart(2, "0")}:${String(clock.getMinutes()).padStart(2, "0")}`;
      const s: ServiceStatus = { name: def.name, title, state, since: hhmm, since_iso: since, last_error: state === "green" ? null : err, plain, todo: state === "green" ? null : todo, fixes: def.fixes, ...(value ? { value } : {}) };
      byName.set(def.name, s);
      out.push(s);
    }
    // upstream hint (D9 `needs`): red here because a dependency is red
    for (const def of defs) {
      const s = byName.get(def.name)!;
      const badNeed = (def.needs ?? []).filter((n: string) => byName.get(n)?.state === "red");
      if (!dockerError && s.state === "red" && badNeed.length) {
        s.todo = `Fix ${badNeed.join(" and ")} first. This one probably comes back by itself.`;
        s.last_error = `${s.last_error} (waiting on ${badNeed.join(", ")})`;
      }
    }
    if (listError) out.push({ name: "service-list", title: "The list of things to watch", state: "red", since: "--:--", since_iso: new Date(now).toISOString(), last_error: listError, plain: listError, todo: "A developer must put ops/services.yml back. The desk cannot watch anything until then.", fixes: [] });
    this.lights.write(Object.fromEntries(out.map((s) => [s.name, { state: s.state, since: s.since_iso }])));
    return { services: out, metrics: m, backup, backupError, containers, dockerError, apiOk };
  }
}
