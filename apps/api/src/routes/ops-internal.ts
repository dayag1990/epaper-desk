// Queue controls for the ops desk (apps/ops/src/api-client.ts lists this contract).
//   GET  /internal/ops/queues                 -> { queues: [{ name, depth, paused }], dead }
//   POST /internal/ops/jobs/retry             { queue?, ids? } -> { retried }
//   POST /internal/ops/queues/:name/pause     and /resume
// Bearer OPS_API_TOKEN only. With no token configured these routes answer 404, as if they did not exist.
// "Paused" is a small JSON file in the files folder that the worker reads every few seconds (apps/worker/src/pause.ts).
import { timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { config } from "../env.js";
import { deadName, getBoss, QUEUES, retryOptions } from "../queue.js";
import type { App } from "./types.js";

export interface OpsInternalDeps {
  token: string | undefined;
  pausedFile: string;
  counts(): Promise<{ waiting: Record<string, number>; dead: number }>;
  retryDead(opts: { queue?: string; ids?: string[] }): Promise<number>;
}

export const pausedFilePath = (root = config.filesRoot) => path.join(root, "_ops", "paused-queues.json");
export function readPaused(file: string): string[] {
  try { const v = JSON.parse(readFileSync(file, "utf8")); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; }
}
function writePaused(file: string, names: string[]) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify([...new Set(names)].sort()));
  renameSync(tmp, file);
}

const defaultDeps = (): OpsInternalDeps => ({
  token: process.env.OPS_API_TOKEN || undefined,
  pausedFile: pausedFilePath(),
  async counts() {
    const rows = await prisma.$queryRaw<{ name: string; n: bigint }[]>`
      select name, count(*)::bigint as n from pgboss.job where state in ('created','retry') group by name`;
    const by = Object.fromEntries(rows.map((r) => [r.name, Number(r.n)]));
    const waiting = Object.fromEntries(QUEUES.map((q) => [q, by[q] ?? 0]));
    return { waiting, dead: QUEUES.reduce((a, q) => a + (by[deadName(q)] ?? 0), 0) };
  },
  async retryDead({ queue, ids }) {
    const boss = await getBoss();
    const names = (queue ? [queue] : [...QUEUES]).filter((q) => (QUEUES as readonly string[]).includes(q));
    let n = 0;
    for (const q of names) {
      const only = ids?.length ? Prisma.sql`and id = any(${ids}::uuid[])` : Prisma.empty;
      const rows = await prisma.$queryRaw<{ id: string; data: unknown }[]>`
        select id::text as id, data from pgboss.job where name = ${deadName(q)} and state in ('created','retry') ${only} limit 500`;
      for (const r of rows) {
        // a new singleton key: the old one is still held by the failed job
        const id = await boss.send(q, r.data as object, { ...retryOptions(), singletonKey: `ops-retry:${r.id}` });
        if (id) { await boss.complete(deadName(q), r.id); n++; }
      }
    }
    return n;
  },
});

export function opsInternalRoutes(app: App, deps: OpsInternalDeps = defaultDeps()) {
  const ok = (header: unknown): boolean => {
    if (!deps.token || typeof header !== "string") return false;
    const m = /^Bearer (.+)$/.exec(header); if (!m) return false;
    const a = Buffer.from(m[1]), b = Buffer.from(deps.token);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const gate = async (req: any, reply: any) => {
    if (!deps.token) return reply.status(404).send({ code: "not_found", message: "There is nothing at this address.", details: {} });
    if (!ok(req.headers.authorization)) return reply.status(401).send({ code: "unauthorized", message: "The desk's key is wrong or missing.", details: {} });
  };
  app.get("/internal/ops/queues", { schema: { hide: true }, preHandler: gate }, async () => {
    const { waiting, dead } = await deps.counts();
    const paused = new Set(readPaused(deps.pausedFile));
    return { queues: QUEUES.map((name) => ({ name, depth: waiting[name] ?? 0, paused: paused.has(name) })), dead };
  });
  app.post("/internal/ops/jobs/retry", { schema: { hide: true }, preHandler: gate }, async (req) => {
    const b = (req.body ?? {}) as { queue?: string; ids?: string[] };
    return { retried: await deps.retryDead({ queue: typeof b.queue === "string" ? b.queue : undefined, ids: Array.isArray(b.ids) ? b.ids.filter((x) => typeof x === "string") : undefined }) };
  });
  for (const act of ["pause", "resume"] as const)
    app.post(`/internal/ops/queues/:name/${act}`, { schema: { hide: true }, preHandler: gate }, async (req, reply) => {
      const name = String((req.params as any).name);
      if (!(QUEUES as readonly string[]).includes(name)) return reply.status(404).send({ code: "not_found", message: `There is no queue called ${name}.`, details: {} });
      const cur = new Set(readPaused(deps.pausedFile));
      if (act === "pause") cur.add(name); else cur.delete(name);
      writePaused(deps.pausedFile, [...cur]);
      return { ok: true, paused: [...cur].sort() };
    });
}
