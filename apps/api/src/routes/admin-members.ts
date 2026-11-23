import { z } from "zod";
import { prisma } from "../db.js";
import { audit, requireRole } from "../auth.js";
import { ApiError, notFound } from "../errors.js";
import { ROLES } from "../lib/admin.js";
import type { App } from "./types.js";

const UserId = z.object({ user_id: z.string().uuid() });

/** Users and roles of the signed-in paper. Adding a person stays at POST /v1/members. */
export function adminMemberRoutes(app: App) {
  const ownerCount = (paper_id: string) => prisma.membership.count({ where: { paper_id, role: "owner", deleted_at: null } });

  app.get("/v1/admin/members", { schema: { tags: ["admin"] }, preHandler: requireRole("owner") }, async (req) => {
    const ms = await prisma.membership.findMany({ where: { paper_id: req.principal!.paper_id, deleted_at: null }, orderBy: { created_at: "asc" } });
    const users = await prisma.user.findMany({ where: { id: { in: ms.map((m) => m.user_id) } } });
    const by = new Map(users.map((u) => [u.id, u]));
    return { items: ms.map((m) => ({ user_id: m.user_id, role: m.role, name: by.get(m.user_id)?.name ?? "", email: by.get(m.user_id)?.email ?? "", you: m.user_id === req.principal!.user_id })) };
  });

  app.patch("/v1/admin/members/:user_id", { schema: { tags: ["admin"], params: UserId, body: z.object({ role: z.enum(ROLES) }) }, preHandler: requireRole("owner") }, async (req) => {
    const p = req.principal!;
    const m = await prisma.membership.findFirst({ where: { user_id: req.params.user_id, paper_id: p.paper_id, deleted_at: null } });
    if (!m) throw notFound("That person");
    if (m.role === "owner" && req.body.role !== "owner" && (await ownerCount(p.paper_id)) <= 1)
      throw new ApiError(409, "last_owner", "A paper needs at least one owner. Make someone else an owner first.");
    await prisma.membership.update({ where: { user_id_paper_id: { user_id: m.user_id, paper_id: p.paper_id } }, data: { role: req.body.role } });
    await audit(p.paper_id, p.user_id, "member.role", "membership", m.user_id, { role: m.role }, { role: req.body.role });
    return { user_id: m.user_id, role: req.body.role };
  });

  app.delete("/v1/admin/members/:user_id", { schema: { tags: ["admin"], params: UserId }, preHandler: requireRole("owner") }, async (req) => {
    const p = req.principal!;
    const m = await prisma.membership.findFirst({ where: { user_id: req.params.user_id, paper_id: p.paper_id, deleted_at: null } });
    if (!m) throw notFound("That person");
    if (m.user_id === p.user_id) throw new ApiError(409, "remove_self", "You cannot remove yourself. Ask another owner.");
    if (m.role === "owner" && (await ownerCount(p.paper_id)) <= 1) throw new ApiError(409, "last_owner", "A paper needs at least one owner.");
    await prisma.membership.update({ where: { user_id_paper_id: { user_id: m.user_id, paper_id: p.paper_id } }, data: { deleted_at: new Date() } });
    await prisma.session.updateMany({ where: { user_id: m.user_id, paper_id: p.paper_id, revoked_at: null }, data: { revoked_at: new Date() } });
    await audit(p.paper_id, p.user_id, "member.remove", "membership", m.user_id, { role: m.role }, null);
    return { ok: true };
  });
}
