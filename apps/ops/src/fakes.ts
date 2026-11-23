import type { ContainerInfo, DockerDriver } from "./docker.js";
import { DockerError } from "./docker.js";
import type { BackupDriver, BackupStatus } from "./backup.js";
import type { ApiClient, QueueStats } from "./api-client.js";

/** In-memory Docker for tests and for demos without a socket. */
export class FakeDocker implements DockerDriver {
  containers = new Map<string, ContainerInfo>();
  calls: string[] = [];
  logsText = new Map<string, string>();
  images: string[] = [];
  upCalls: { services?: string[]; env: Record<string, string> }[] = [];
  failUp: string | null = null;
  /** when set, a restarted/started container comes back unhealthy (bad release) */
  stayBroken = new Set<string>();
  constructor(services: string[] = []) { for (const s of services) this.add(s); }
  add(service: string, patch: Partial<ContainerInfo> = {}) {
    this.containers.set(`epaper-${service}`, { name: `epaper-${service}`, service, state: "running", health: "healthy", startedAt: new Date(Date.now() - 3600_000).toISOString(), image: `epaper/${service}:dev`, ...patch });
  }
  stop(service: string) {
    const c = this.containers.get(`epaper-${service}`)!;
    this.containers.set(c.name, { ...c, state: "exited", health: "none", finishedAt: new Date().toISOString(), exitCode: 137 });
  }
  async list() { return [...this.containers.values()].map((c) => ({ ...c })); }
  private get(n: string) {
    const c = this.containers.get(n);
    if (!c) throw new DockerError(`'${n}' is not part of the epaper project, so the desk will not touch it.`);
    return c;
  }
  async restart(n: string) {
    this.calls.push(`restart ${n}`);
    const c = this.get(n);
    this.containers.set(n, { ...c, state: "running", health: this.stayBroken.has(c.service) ? "unhealthy" : "healthy", startedAt: new Date().toISOString() });
  }
  async start(n: string) {
    this.calls.push(`start ${n}`);
    const c = this.get(n);
    if (c.state !== "running") this.containers.set(n, { ...c, state: "running", health: this.stayBroken.has(c.service) ? "unhealthy" : "healthy", startedAt: new Date().toISOString() });
  }
  async logs(n: string, tail: number) { this.calls.push(`logs ${n} ${tail}`); this.get(n); return (this.logsText.get(n) ?? "").split("\n").slice(-tail).join("\n"); }
  async up(o: { services?: string[]; env: Record<string, string> }) {
    this.calls.push(`up ${(o.services ?? ["*"]).join(",")}`);
    this.upCalls.push(o);
    if (this.failUp) throw new DockerError(this.failUp);
    for (const c of this.containers.values()) {
      if (!o.services || o.services.includes(c.service)) {
        const rel = o.env.EPAPER_RELEASE;
        this.containers.set(c.name, { ...c, state: "running", health: this.stayBroken.has(c.service) ? "unhealthy" : "healthy", startedAt: new Date().toISOString(), image: rel ? `epaper/${c.service}:${rel}` : c.image });
      }
    }
  }
  async imageTags() { return this.images; }
  async pruneBuildCache() { this.calls.push("prune-build"); return { freedBytes: 1000 }; }
  async pruneImages() { this.calls.push("prune-images"); return { freedBytes: 500 }; }
}

export class FakeBackup implements BackupDriver {
  calls: string[] = [];
  status_: BackupStatus = {
    files: { at: new Date().toISOString(), size_bytes: 1000 },
    wal: { at: new Date().toISOString(), size_bytes: 500 },
    base: { at: new Date().toISOString(), size_bytes: 9000 },
    drill: { at: new Date().toISOString(), result: "pass" },
  };
  failSnapshot: string | null = null;
  restores = new Map<string, { to: string; switched: boolean }>();
  async status() { return this.status_; }
  async runNow() { this.calls.push("run"); }
  async verify() { this.calls.push("verify"); }
  async snapshot(reason: string) { this.calls.push(`snapshot ${reason}`); if (this.failSnapshot) throw new Error(this.failSnapshot); return { id: `snap-${this.calls.length}` }; }
  async restoreDb(to: string) {
    this.calls.push(`restoreDb ${to}`);
    const id = `r-${to.replace(/\W/g, "")}`;
    this.restores.set(id, { to, switched: false });
    return { id, counts: [{ table: "articles", live: 120, restored: 118 }] };
  }
  async switchDb(id: string) { this.calls.push(`switch ${id}`); const r = this.restores.get(id); if (!r) throw new Error("There is no restore with that id."); r.switched = true; }
  async restoreFiles(scope: string, at: string) { this.calls.push(`restoreFiles ${scope} ${at}`); }
}

export class FakeApi implements ApiClient {
  calls: string[] = [];
  stats: QueueStats | null = { queues: [{ name: "export", depth: 2, paused: false }], dead: 3 };
  async queueStats() { return this.stats; }
  async retry(body: { queue?: string; ids?: string[] }) { this.calls.push(`retry ${JSON.stringify(body)}`); const n = this.stats?.dead ?? 0; if (this.stats) this.stats.dead = 0; return { retried: n }; }
  async setPaused(queue: string, paused: boolean) { this.calls.push(`${paused ? "pause" : "resume"} ${queue}`); const q = this.stats?.queues.find((x) => x.name === queue); if (q) q.paused = paused; }
}
