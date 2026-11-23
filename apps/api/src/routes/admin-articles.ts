import { z } from "zod";
import { prisma } from "../db.js";
import { audit, requireRole } from "../auth.js";
import { notFound } from "../errors.js";
import type { App } from "./types.js";

export function adminArticleRoutes(app: App) {
  // search and filter; includes hidden stories so they can be brought back
  app.get("/v1/admin/articles", {
    schema: { tags: ["admin"], querystring: z.object({ q: z.string().max(200).optional(), section: z.string().optional(), hidden: z.enum(["yes", "no", "all"]).default("no"), limit: z.coerce.number().int().min(1).max(500).default(100) }) },
    preHandler: requireRole(),
  }, async (req) => {
    const { q, section, hidden, limit } = req.query;
    const where: any = { paper_id: req.principal!.paper_id, ...(section ? { section } : {}), ...(q ? { headline: { contains: q, mode: "insensitive" } } : {}) };
    if (hidden === "no") where.deleted_at = null;
    if (hidden === "yes") where.deleted_at = { not: null };
    const rows = await prisma.article.findMany({ where, orderBy: [{ published_at: "desc" }, { id: "asc" }], take: limit });
    return { items: rows.map((r) => ({ id: r.id, headline: r.headline, section: r.section, priority: r.priority, url: r.url, lang: r.lang, source_id: r.source_id, published_at: r.published_at, hidden: !!r.deleted_at, data: r.data })) };
  });

  // hide = the same soft delete the editor and the planner already skip; bring back = clear it
  app.patch("/v1/admin/articles/:id/hidden", {
    schema: { tags: ["admin"], params: z.object({ id: z.string().min(1) }), body: z.object({ hidden: z.boolean() }) },
    preHandler: requireRole("owner", "editor", "sub"),
  }, async (req) => {
    const p = req.principal!;
    const a = await prisma.article.findFirst({ where: { id: req.params.id, paper_id: p.paper_id } });
    if (!a) throw notFound("That article");
    await prisma.article.update({ where: { id: a.id }, data: { deleted_at: req.body.hidden ? new Date() : null } });
    await audit(p.paper_id, p.user_id, req.body.hidden ? "hide" : "unhide", "article", a.id, null, null);
    return { id: a.id, hidden: req.body.hidden };
  });
}
