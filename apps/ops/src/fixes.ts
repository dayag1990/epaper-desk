import fs from "node:fs";
import path from "node:path";
import type { ApiClient } from "./api-client.js";
import { ApiUnavailable } from "./api-client.js";
import type { BackupDriver } from "./backup.js";
import type { Config } from "./config.js";
import type { DockerDriver } from "./docker.js";
import type { Health, ServiceDef } from "./health.js";
import { maskSecrets } from "./mask.js";
import { RELEASE_RE, type Releases } from "./releases.js";
import { JsonFile, type OpsLog } from "./store.js";

/** An error the owner can read at 2 am. `status` is the HTTP code. */
export class OpsError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

export interface FixDeps {
  cfg: Config; docker: DockerDriver; backup: BackupDriver; api: ApiClient;
  health: Health; releases: Releases; log: OpsLog; services: () => ServiceDef[];
  pollMs?: number;
  /** run something just after the answer is sent (used to restart the desk itself) */
  defer?: (fn: () => void) => void;
}

const CONFIRM = { rollback: "ROLLBACK", clear: "CLEAR", restore: "RESTORE", switch: "SWITCH" } as const;
const PROTECTED_SEGMENTS = new Set(["original", "originals", "_ops", "backup", "backups", "backup-standin"]);

export interface ClearItem { path: string; bytes: number; what: string }

function dirSize(p: string): number {
  let n = 0;
  try {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const f = path.join(p, e.name);
      if (e.isSymbolicLink()) continue;
      n += e.isDirectory() ? dirSize(f) : fs.statSync(f).size;
    }
  } catch { /* gone meanwhile */ }
  return n;
}

export class Fixes {
  private inflight = new Map<string, Promise<unknown>>();
  private restores: JsonFile<{ byTo: Record<string, string>; switched: Record<string, boolean> }>;
  constructor(private d: FixDeps) {
    this.restores = new JsonFile(path.join(d.cfg.stateDir, "restores.json"), () => ({ byTo: {}, switched: {} }));
  }

  // ---- helpers ----
  private once<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const cur = this.inflight.get(key);
    if (cur) return cur as Promise<T>; // pressed twice at once: both get the same answer
    const p = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
  private def(name: string): ServiceDef {
    const s = this.d.services().find((x) => x.name === name);
    if (!s) throw new OpsError(404, `There is no service called '${name}' on this desk.`);
    return s;
  }
  private composeService(def: ServiceDef): string { return (def.container ?? def.name).replace(/^epaper-/, ""); }
  private need(given: string | undefined, word: string, what: string) {
    if ((given ?? "").trim().toUpperCase() !== word)
      throw new OpsError(400, `Nothing was changed. To ${what}, type the word ${word} in the box and press again.`, { needs_confirm: word });
  }
  private async snapshot(reason: string): Promise<string> {
    try { return (await this.d.backup.snapshot(reason)).id; } catch (e) {
      throw new OpsError(503, `Nothing was changed. A safety copy of your data could not be made first (${(e as Error).message}). Fix the backups, then press again.`, { snapshot_failed: true });
    }
  }
  private note(who: string, action: string, target: string | undefined, result: "ok" | "refused" | "failed", note?: string) {
    this.d.log.add({ who, action, target, result, note });
  }
  async run<T>(who: string, action: string, target: string | undefined, fn: () => Promise<T>): Promise<T> {
    try {
      const r = await fn();
      this.note(who, action, target, "ok");
      return r;
    } catch (e) {
      const refused = e instanceof OpsError && e.status < 500;
      this.note(who, action, target, refused ? "refused" : "failed", (e as Error).message.slice(0, 300));
      throw e;
    }
  }
  private async waitGreen(names: string[], what: string): Promise<void> {
    const end = Date.now() + this.d.cfg.healthWaitMs;
    let last = "";
    for (;;) {
      const snap = await this.d.health.snapshot();
      const bad = names.map((n) => snap.services.find((s) => s.name === n)).filter((s) => s && s.state !== "green");
      if (!bad.length) return;
      last = bad.map((s) => `${s!.title}: ${s!.last_error}`).join(" ");
      if (Date.now() >= end) break;
      await new Promise((r) => setTimeout(r, this.d.pollMs ?? 1000));
    }
    throw new OpsError(502, `${what} did not come back healthy in time. ${last} Open the log of that service to see why.`, { still_red: names });
  }

  // ---- fix buttons ----
  async restart(name: string): Promise<{ ok: true; message: string; service: string; state: string }> {
    const def = this.def(name);
    if (!def.container || !def.fixes.includes("restart")) throw new OpsError(400, `${def.title ?? name} cannot be restarted from here.`);
    if (def.name === "ops") {
      this.d.defer?.(() => void this.d.docker.restart(def.container!).catch(() => {}));
      return { ok: true, message: "The desk is restarting itself. This page will be back in about 10 seconds. Reload it.", service: name, state: "restarting" };
    }
    return this.once(`restart:${name}`, async () => {
      await this.bringUp(def);
      await this.waitGreen([def.name], def.title ?? def.name);
      return { ok: true as const, message: `${def.title ?? name} was restarted and is healthy.`, service: name, state: "green" };
    });
  }

  /** start if stopped, create if missing, restart if running. Same end state every time. */
  private async bringUp(def: ServiceDef): Promise<void> {
    const c = (await this.d.docker.list()).find((x) => x.name === def.container);
    if (!c) await this.d.docker.up({ services: [this.composeService(def)], env: this.releaseEnv() });
    else if (c.state !== "running") await this.d.docker.start(c.name);
    else await this.d.docker.restart(c.name, def.name === "postgres" ? 60 : 10); // the database gets time to close cleanly
  }
  private releaseEnv(): Record<string, string> {
    const cur = this.d.releases.current();
    return cur ? { EPAPER_RELEASE: cur } : {};
  }
  private order(): ServiceDef[] {
    const defs = this.d.services().filter((s) => s.container && s.fixes.includes("restart") && s.name !== "ops");
    const done = new Set<string>(), out: ServiceDef[] = [];
    const visit = (s: ServiceDef) => {
      if (done.has(s.name)) return;
      done.add(s.name);
      for (const n of s.needs ?? []) { const d = defs.find((x) => x.name === n); if (d) visit(d); }
      out.push(s);
    };
    defs.forEach(visit);
    return out;
  }
  async restartAll(): Promise<{ ok: true; message: string; order: string[] }> {
    return this.once("restart-all", async () => {
      const order = this.order();
      for (const s of order) { await this.bringUp(s); await this.waitGreen([s.name], s.title ?? s.name); }
      return { ok: true as const, message: "Everything was restarted, one after the other, and each one is healthy.", order: order.map((s) => s.name) };
    });
  }
  async pullUp(): Promise<{ ok: true; message: string }> {
    return this.once("pull-up", async () => {
      const order = this.order();
      await this.d.docker.up({ services: order.map((s) => this.composeService(s)), env: this.releaseEnv() });
      await this.waitGreen(order.map((s) => s.name), "The services");
      return { ok: true as const, message: "Everything that should be running is running." };
    });
  }

  async rollback(tag: string, confirm: string | undefined): Promise<{ ok: true; message: string; release: string; already?: boolean }> {
    if (!RELEASE_RE.test(tag)) throw new OpsError(400, `'${tag}' is not a release name. Release names look like 2026-11-21.3.`);
    return this.once(`rollback:${tag}`, async () => {
      const kept = await this.d.releases.list();
      if (!kept.includes(tag)) throw new OpsError(404, `Release ${tag} is not kept on this box. The last ${this.d.cfg.keepReleases} are: ${kept.join(", ") || "none"}.`, { releases: kept });
      const prev = this.d.releases.current();
      if (prev === tag) {
        const run = (await this.d.docker.list()).filter((c) => /^epaper-(api|worker)$/.test(c.name));
        if (run.length && run.every((c) => c.image.endsWith(`:${tag}`) && c.state === "running")) return { ok: true as const, already: true, release: tag, message: `Already on release ${tag}. Nothing to do.` };
      }
      this.need(confirm, CONFIRM.rollback, `go back to release ${tag}`);
      const snap = await this.snapshot(`before rollback to ${tag}`);
      const names = ["api", "worker"];
      this.d.releases.setCurrent(tag);
      try {
        await this.d.docker.up({ services: names, env: { EPAPER_RELEASE: tag } });
        await this.waitGreen(names, "The old release");
      } catch (e) {
        // back out: put the pointer back and bring the previous one up again
        if (prev) { this.d.releases.setCurrent(prev); await this.d.docker.up({ services: names, env: { EPAPER_RELEASE: prev } }).catch(() => {}); }
        throw new OpsError(502, `Release ${tag} did not start cleanly, so the desk went back to ${prev ?? "the previous build"}. Your data is untouched (safety copy ${snap}). ${(e as Error).message}`, { rolled_back_to: prev });
      }
      return { ok: true as const, release: tag, message: `Now running release ${tag}. A safety copy was taken first (${snap}).` };
    });
  }

  // ---- disk ----
  planClear(): { items: ClearItem[]; total_bytes: number } {
    const root = this.d.cfg.filesDir, names = new Set(this.d.cfg.clearDirNames);
    const items: ClearItem[] = [];
    const walk = (dir: string, depth: number) => {
      let ents: fs.Dirent[] = [];
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (!e.isDirectory() || e.isSymbolicLink()) continue; // never follow links
        if (PROTECTED_SEGMENTS.has(e.name)) continue;
        const p = path.join(dir, e.name);
        if (names.has(e.name) || (depth === 0 && e.name === "_cache")) items.push({ path: p, bytes: dirSize(p), what: e.name === "exports" ? "old exports (they can be made again)" : "temporary copies (they are made again when needed)" });
        else if (depth < 3) walk(p, depth + 1);
      }
    };
    walk(root, 0);
    return { items, total_bytes: items.reduce((a, i) => a + i.bytes, 0) };
  }
  async clearDisk(confirm: string | undefined): Promise<{ ok: true; message: string; freed_bytes: number; removed: string[] }> {
    return this.once("clear-disk", async () => {
      const plan = this.planClear();
      this.need(confirm, CONFIRM.clear, "free disk space");
      // no snapshot: only rebuildable copies are removed, never originals or backups; a backup may be impossible when the disk is full
      let freed = 0;
      const removed: string[] = [];
      const rootReal = fs.realpathSync(this.d.cfg.filesDir);
      for (const it of plan.items) {
        const real = fs.realpathSync(it.path);
        const rel = path.relative(rootReal, real).split(path.sep);
        if (rel[0] === ".." || rel.some((s) => PROTECTED_SEGMENTS.has(s))) continue; // belt and braces
        for (const e of fs.readdirSync(real)) fs.rmSync(path.join(real, e), { recursive: true, force: true });
        freed += it.bytes; removed.push(it.path);
      }
      for (const fn of [() => this.d.docker.pruneBuildCache(), () => this.d.docker.pruneImages()]) {
        try { freed += (await fn()).freedBytes; } catch { /* docker part is best effort */ }
      }
      return { ok: true as const, freed_bytes: freed, removed, message: freed ? `Freed ${(freed / 1e6).toFixed(1)} MB. Originals and backups were not touched.` : "Nothing to free: the safe places are already empty. Originals and backups were not touched." };
    });
  }

  // ---- queues ----
  private async apiOr(what: string): Promise<void> {
    const snap = await this.d.health.snapshot();
    const api = snap.services.find((s) => s.name === "api");
    if (api && api.state === "red") throw new OpsError(409, `Cannot ${what}: the API is down (${api.last_error}). Fix the API first, then press this again.`, { blocked_by: "api" });
  }
  async retryJobs(body: { queue?: string; ids?: string[] }): Promise<{ ok: true; message: string; retried: number }> {
    await this.apiOr("retry failed jobs");
    try {
      const r = await this.d.api.retry(body);
      return { ok: true, retried: r.retried, message: r.retried ? `${r.retried} failed job(s) were put back in the line.` : "There were no failed jobs to retry." };
    } catch (e) { throw e instanceof ApiUnavailable ? new OpsError(503, e.message) : e; }
  }
  async setPaused(queue: string, paused: boolean): Promise<{ ok: true; message: string }> {
    await this.apiOr(paused ? "pause the queue" : "resume the queue");
    try { await this.d.api.setPaused(queue, paused); } catch (e) { throw e instanceof ApiUnavailable ? new OpsError(503, e.message) : e; }
    return { ok: true, message: paused ? `Queue '${queue}' is paused. Waiting jobs stay safe and wait.` : `Queue '${queue}' is running again.` };
  }

  // ---- logs ----
  async logs(name: string, tail: number): Promise<{ service: string; tail: number; text: string }> {
    const def = this.def(name);
    if (!def.container) throw new OpsError(400, `${def.title ?? name} has no log (it is not a container).`);
    const text = await this.d.docker.logs(def.container, tail);
    return { service: name, tail, text: maskSecrets(text) };
  }

  // ---- backups ----
  async backupNow() { await this.d.backup.runNow(); return { ok: true as const, message: "A backup was made just now." }; }
  async verifyBackups() { await this.d.backup.verify(); return { ok: true as const, message: "The restore check ran. See the result in the backup panel." }; }

  async restoreDb(to: string, confirm: string | undefined) {
    return this.once(`restore-db:${to}`, async () => {
      const known = this.restores.read().byTo[to];
      if (known) return { ok: true as const, already: true, id: known, message: "This restore was already built. Compare the numbers, then switch.", counts: [] as { table: string; live: number; restored: number }[] };
      this.need(confirm, CONFIRM.restore, `build a copy of the database as it was at ${to}`);
      const snap = await this.snapshot(`before db restore to ${to}`);
      const r = await this.d.backup.restoreDb(to);
      this.restores.update((s) => ({ ...s, byTo: { ...s.byTo, [to]: r.id } }));
      return { ok: true as const, id: r.id, counts: r.counts, message: `A second database at ${to} was built beside the live one (safety copy ${snap}). The live one is untouched. Compare the row counts, then press Switch.` };
    });
  }
  async switchDb(id: string, confirm: string | undefined) {
    return this.once(`switch:${id}`, async () => {
      if (this.restores.read().switched[id]) return { ok: true as const, already: true, message: "Already switched. Nothing to do." };
      if (!Object.values(this.restores.read().byTo).includes(id)) throw new OpsError(404, "There is no restored copy with that id. Build one with Restore first.");
      this.need(confirm, CONFIRM.switch, "switch to the restored database");
      const snap = await this.snapshot(`before switching to restore ${id}`);
      await this.d.backup.switchDb(id);
      this.restores.update((s) => ({ ...s, switched: { ...s.switched, [id]: true } }));
      return { ok: true as const, message: `The restored database is now the live one. The old one is kept for 7 days (safety copy ${snap}).` };
    });
  }
  async restoreFiles(scope: "file" | "edition" | "all", at: string, confirm: string | undefined) {
    return this.once(`restore-files:${scope}:${at}`, async () => {
      this.need(confirm, CONFIRM.restore, `bring back files as they were at ${at}`);
      const snap = await this.snapshot(`before files restore (${scope}) to ${at}`);
      await this.d.backup.restoreFiles(scope, at);
      return { ok: true as const, message: `Files (${scope}) as of ${at} were brought back. Nothing was overwritten: files are written once. Safety copy ${snap}.` };
    });
  }
}
