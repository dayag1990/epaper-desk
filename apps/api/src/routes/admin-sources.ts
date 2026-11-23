import { z } from "zod";
import { prisma } from "../db.js";
import { audit, requireRole } from "../auth.js";
import { notFound } from "../errors.js";
import { plainSourceStatus } from "../lib/admin.js";
import type { App } from "./types.js";

const Id = z.object({ id: z.string().uuid() });

export function adminSourceRoutes(app: App) {
  app.get("/v1/admin/sources", { schema: { tags: ["admin"] }, preHandler: requireRole() }, async (req) => {
    const rows = await prisma.source.findMany({ where: { paper_id: req.principal!.paper_id, deleted_at: null }, orderBy: { created_at: "asc" } });
    return { items: rows.map((s) => ({ id: s.id, name: s.name, kind: s.kind, config: s.config, mapping: s.mapping, schedule: s.schedule, last_sync_at: s.last_sync_at, health: plainSourceStatus(s.status, s.last_sync_at) })) };
  });

  // edit the name, the mapping or the schedule; the kind and address stay as they were saved
  app.patch("/v1/admin/sources/:id", {
    schema: { tags: ["admin"], params: Id, body: z.object({ name: z.string().min(1).max(120).optional(), mapping: z.record(z.any()).optional(), schedule: z.string().max(60).nullable().optional() }) },
    preHandler: requireRole("owner", "editor"),
  }, async (req) => {
    const p = req.principal!;
    const s = await prisma.source.findFirst({ where: { id: req.params.id, paper_id: p.paper_id, deleted_at: null } });
    if (!s) throw notFound("That source");
    const row = await prisma.source.update({ where: { id: s.id }, data: req.body });
    await audit(p.paper_id, p.user_id, "update", "source", s.id, { name: s.name, mapping: s.mapping }, req.body);
    return { id: row.id, name: row.name, kind: row.kind, mapping: row.mapping, schedule: row.schedule, health: plainSourceStatus(row.status, row.last_sync_at) };
  });
}
