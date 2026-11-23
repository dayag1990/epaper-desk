import { z } from "zod";
import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { audit, requireRole } from "../auth.js";
import { ApiError, notFound } from "../errors.js";
import { deadName, getBoss, JOB_TYPES, retryOptions, QUEUES } from "../queue.js";
import type { App } from "./types.js";

export function jobRoutes(app: App) {
  app.post("/v1/jobs", {
    schema: { tags: ["jobs"], body: z.object({ type: z.string(), payload: z.record(z.any()).default({}), idempotency_key: z.string().min(1).max(200).optional(), delay_s: z.number().int().min(0).max(86400 * 7).optional() }) },
    preHandler: requireRole("owner", "editor"),
  }, async (req, reply) => {
    const p = req.principal!;
    const queue = JOB_TYPES[req.body.type];
    if (!queue) throw new ApiError(400, "unknown_job", "That job type is not known.", { known: Object.keys(JOB_TYPES) });
    const idem = req.body.idempotency_key ?? randomUUID();
    const envelope = { type: req.body.type, paper_id: p.paper_id, payload: req.body.payload, idempotency_key: idem };
    const boss = await getBoss();
    const id = await boss.send(queue, envelope, { ...retryOptions(), singletonKey: `${p.paper_id}:${idem}`, ...(req.body.delay_s ? { startAfter: req.body.delay_s } : {}) });
    await audit(p.paper_id, p.user_id, "enqueue", "job", id, null, { type: req.body.type, queue });
    return reply.status(202).send({ id, queue, deduplicated: id === null });
  });

  // dead-letter list: only this paper's jobs
  app.get("/v1/jobs/dead", { schema: { tags: ["jobs"] }, preHandler: requireRole("owner", "editor") }, async (req) => {
    const names = QUEUES.map(deadName);
    const rows = await prisma.$queryRaw<any[]>`
      select id::text as id, name, data, created_on as at from pgboss.job
      where name = any(${names}) and data->>'paper_id' = ${req.principal!.paper_id}
      order by created_on desc limit 200`;
    return { items: rows.map((r) => ({ id: r.id, queue: r.name.replace(/_dead$/, ""), type: r.data?.type, idempotency_key: r.data?.idempotency_key, at: r.at })) };
  });

  app.get("/v1/jobs/:id", { schema: { tags: ["jobs"], params: z.object({ id: z.string().uuid() }) }, preHandler: requireRole() }, async (req) => {
    const rows = await prisma.$queryRaw<any[]>`
      select id::text as id, name, state::text as state, retry_count as retries, data
      from pgboss.job where id = ${req.params.id}::uuid and data->>'paper_id' = ${req.principal!.paper_id}`;
    const r = rows[0];
    if (!r) throw notFound("That job");
    return { id: r.id, queue: r.name, state: r.state, retries: r.retries, type: r.data?.type };
  });
}
