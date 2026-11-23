import { z } from "zod";
import { prisma } from "../db.js";
import { audit, hashToken, newToken, requireRole } from "../auth.js";
import { notFound } from "../errors.js";
import type { App } from "./types.js";

const Id = z.object({ id: z.string().uuid() });

export function sourceRoutes(app: App) {
  // Every query below carries paper_id from the principal. Never from the request.
  app.get("/v1/sources", { schema: { tags: ["sources"] }, preHandler: requireRole() }, async (req) => {
    const items = await prisma.source.findMany({ where: { paper_id: req.principal!.paper_id, deleted_at: null }, orderBy: { created_at: "asc" } });
    return { items };
  });

  app.post("/v1/sources", {
    schema: { tags: ["sources"], body: z.object({ kind: z.string().min(1), name: z.string().min(1), config: z.record(z.any()).default({}), mapping: z.record(z.any()).optional(), schedule: z.string().optional() }) },
    preHandler: requireRole("owner", "editor"),
  }, async (req, reply) => {
    const p = req.principal!;
    const row = await prisma.source.create({ data: { ...req.body, paper_id: p.paper_id } });
    await audit(p.paper_id, p.user_id, "create", "source", row.id, null, row);
    return reply.status(201).send(row);
  });

  app.get("/v1/sources/:id", { schema: { tags: ["sources"], params: Id }, preHandler: requireRole() }, async (req) => {
    const row = await prisma.source.findFirst({ where: { id: req.params.id, paper_id: req.principal!.paper_id, deleted_at: null } });
    if (!row) throw notFound("That source");
    return row;
  });

  app.delete("/v1/sources/:id", { schema: { tags: ["sources"], params: Id }, preHandler: requireRole("owner", "editor") }, async (req) => {
    const p = req.principal!;
    const row = await prisma.source.findFirst({ where: { id: req.params.id, paper_id: p.paper_id, deleted_at: null } });
    if (!row) throw notFound("That source");
    await prisma.source.update({ where: { id: row.id }, data: { deleted_at: new Date() } }); // soft delete, kept 30 days
    await audit(p.paper_id, p.user_id, "delete", "source", row.id, row, null);
    return { ok: true };
  });

  app.post("/v1/sources/:id/keys", { schema: { tags: ["sources"], params: Id }, preHandler: requireRole("owner") }, async (req, reply) => {
    const p = req.principal!;
    const src = await prisma.source.findFirst({ where: { id: req.params.id, paper_id: p.paper_id, deleted_at: null } });
    if (!src) throw notFound("That source");
    const key = `epk_${newToken()}`;
    const row = await prisma.apiKey.create({ data: { paper_id: p.paper_id, source_id: src.id, key_hash: hashToken(key), label: src.name } });
    await audit(p.paper_id, p.user_id, "create", "api_key", row.id, null, { source_id: src.id });
    return reply.status(201).send({ id: row.id, key, note: "Copy this key now. It is shown once." });
  });
}
