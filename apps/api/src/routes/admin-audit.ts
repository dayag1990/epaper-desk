import { z } from "zod";
import { prisma } from "../db.js";
import { requireRole } from "../auth.js";
import type { App } from "./types.js";

export function adminAuditRoutes(app: App) {
  app.get("/v1/admin/audit", { schema: { tags: ["admin"], querystring: z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }) }, preHandler: requireRole("owner") }, async (req) => {
    const rows = await prisma.auditLog.findMany({ where: { paper_id: req.principal!.paper_id }, orderBy: { at: "desc" }, take: req.query.limit });
    const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.user_id).filter(Boolean) as string[] } } });
    const name = new Map(users.map((u) => [u.id, u.name]));
    return { items: rows.map((r) => ({ id: String(r.id), at: r.at, who: r.user_id ? name.get(r.user_id) ?? "someone" : "system", action: r.action, entity: r.entity, entity_id: r.entity_id })) };
  });
}
