import { execFile } from "node:child_process";

export type RunState = "running" | "exited" | "restarting" | "created" | "paused" | "dead" | "missing";
export type HealthState = "healthy" | "unhealthy" | "starting" | "none";

export interface ContainerInfo {
  name: string; // container name, e.g. epaper-api
  service: string; // compose service, e.g. api
  state: RunState;
  health: HealthState;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  image: string;
}

/** Everything the desk does to Docker. Real = socket proxy; fake = tests. Only the `epaper` project is ever touched. */
export interface DockerDriver {
  list(): Promise<ContainerInfo[]>;
  restart(container: string, stopTimeoutS?: number): Promise<void>;
  start(container: string): Promise<void>;
  logs(container: string, tail: number): Promise<string>;
  /** compose up -d (no build). `env` carries EPAPER_RELEASE. */
  up(opts: { services?: string[]; env: Record<string, string> }): Promise<void>;
  /** image tags like "epaper/api:2026-11-21.3" */
  imageTags(): Promise<string[]>;
  pruneBuildCache(): Promise<{ freedBytes: number }>;
  pruneImages(): Promise<{ freedBytes: number }>;
}

export class DockerError extends Error {}

type Exec = (file: string, args: string[], env: Record<string, string>) => Promise<{ stdout: string; stderr: string }>;
const realExec: Exec = (file, args, env) =>
  new Promise((resolve, reject) =>
    execFile(file, args, { env: { ...process.env, ...env }, timeout: 300_000, maxBuffer: 8e6 }, (e, stdout, stderr) =>
      e ? reject(new DockerError(String(stderr || e.message).slice(-600))) : resolve({ stdout, stderr })));

function demux(buf: Buffer): string {
  // Docker log stream: 8-byte header (type, 0,0,0, size BE) per frame. A TTY container sends plain text.
  const out: string[] = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    const t = buf[i]!;
    if (t > 2 || buf[i + 1] !== 0 || buf[i + 2] !== 0 || buf[i + 3] !== 0) return buf.toString("utf8");
    const n = buf.readUInt32BE(i + 4);
    out.push(buf.subarray(i + 8, i + 8 + n).toString("utf8"));
    i += 8 + n;
  }
  return out.join("");
}

export class SocketProxyDocker implements DockerDriver {
  constructor(private o: { host: string; project: string; composeFiles: string[]; exec?: Exec }) {}

  private async call(method: string, path: string): Promise<Response> {
    let r: Response;
    try {
      r = await fetch(`${this.o.host}${path}`, { method, signal: AbortSignal.timeout(120_000) });
    } catch {
      throw new DockerError("The desk cannot reach Docker (the socket proxy is not answering). Check that the 'dockerproxy' container is running.");
    }
    if (r.status === 403) throw new DockerError("Docker refused this: the socket proxy does not allow it.");
    return r;
  }

  async list(): Promise<ContainerInfo[]> {
    const f = encodeURIComponent(JSON.stringify({ label: [`com.docker.compose.project=${this.o.project}`] }));
    const r = await this.call("GET", `/containers/json?all=1&filters=${f}`);
    if (!r.ok) throw new DockerError(`Docker answered ${r.status} when listing containers.`);
    const rows = (await r.json()) as { Id: string; Names: string[]; Labels: Record<string, string> }[];
    const out: ContainerInfo[] = [];
    for (const row of rows) {
      const ir = await this.call("GET", `/containers/${row.Id}/json`);
      if (!ir.ok) continue;
      const j = (await ir.json()) as { Name: string; Config: { Image: string }; State: { Status: string; StartedAt?: string; FinishedAt?: string; ExitCode?: number; Health?: { Status: string } } };
      out.push({
        name: j.Name.replace(/^\//, ""),
        service: row.Labels["com.docker.compose.service"] ?? j.Name.replace(/^\//, ""),
        state: (j.State.Status as RunState) ?? "dead",
        health: (j.State.Health?.Status as HealthState) ?? "none",
        startedAt: j.State.StartedAt?.startsWith("0001") ? undefined : j.State.StartedAt,
        finishedAt: j.State.FinishedAt?.startsWith("0001") ? undefined : j.State.FinishedAt,
        exitCode: j.State.ExitCode,
        image: j.Config.Image,
      });
    }
    return out;
  }

  private async ownContainer(name: string): Promise<string> {
    const c = (await this.list()).find((x) => x.name === name);
    if (!c) throw new DockerError(`'${name}' is not part of the ${this.o.project} project, so the desk will not touch it.`);
    return c.name;
  }

  async restart(container: string, t = 10): Promise<void> {
    const n = await this.ownContainer(container);
    const r = await this.call("POST", `/containers/${encodeURIComponent(n)}/restart?t=${t}`);
    if (!r.ok && r.status !== 204) throw new DockerError(`Docker could not restart ${n} (answer ${r.status}).`);
  }
  async start(container: string): Promise<void> {
    const n = await this.ownContainer(container);
    const r = await this.call("POST", `/containers/${encodeURIComponent(n)}/start`);
    if (!r.ok && r.status !== 304) throw new DockerError(`Docker could not start ${n} (answer ${r.status}).`);
  }
  async logs(container: string, tail: number): Promise<string> {
    const n = await this.ownContainer(container);
    const r = await this.call("GET", `/containers/${encodeURIComponent(n)}/logs?stdout=1&stderr=1&timestamps=1&tail=${Math.min(Math.max(1, tail), 2000)}`);
    if (!r.ok) throw new DockerError(`Docker could not read the logs of ${n} (answer ${r.status}).`);
    return demux(Buffer.from(await r.arrayBuffer()));
  }
  async up(opts: { services?: string[]; env: Record<string, string> }): Promise<void> {
    const args = ["compose", "-p", this.o.project, ...this.o.composeFiles.flatMap((f) => ["-f", f]), "up", "-d", "--no-build", ...(opts.services ?? [])];
    try {
      await (this.o.exec ?? realExec)("docker", args, { ...opts.env, DOCKER_HOST: this.o.host.replace(/^http/, "tcp") });
    } catch (e) {
      throw new DockerError(`Docker could not bring the services up: ${(e as Error).message}`);
    }
  }
  async imageTags(): Promise<string[]> {
    const r = await this.call("GET", "/images/json");
    if (!r.ok) throw new DockerError(`Docker answered ${r.status} when listing images.`);
    const rows = (await r.json()) as { RepoTags: string[] | null }[];
    return rows.flatMap((x) => x.RepoTags ?? []);
  }
  async pruneBuildCache(): Promise<{ freedBytes: number }> {
    const r = await this.call("POST", "/build/prune");
    if (!r.ok) throw new DockerError(`Docker could not clear its build cache (answer ${r.status}).`);
    return { freedBytes: ((await r.json()) as { SpaceReclaimed?: number }).SpaceReclaimed ?? 0 };
  }
  async pruneImages(): Promise<{ freedBytes: number }> {
    const f = encodeURIComponent(JSON.stringify({ dangling: ["true"], label: [`com.docker.compose.project=${this.o.project}`] }));
    const r = await this.call("POST", `/images/prune?filters=${f}`);
    if (!r.ok) throw new DockerError(`Docker could not clear old images (answer ${r.status}).`);
    return { freedBytes: ((await r.json()) as { SpaceReclaimed?: number }).SpaceReclaimed ?? 0 };
  }
}
