import { z } from "zod";
import { prisma } from "../db.js";
import { audit, requireRole } from "../auth.js";
import { ApiError } from "../errors.js";
import { aiKeyPresent } from "../lib/admin.js";
import type { App } from "./types.js";

/** Paper settings and the AI switch. Everything is scoped by the signed-in paper. */
export function adminSettingsRoutes(app: App) {
  const view = (p: any) => ({
    id: p.id, slug: p.slug, name: p.name, lang: p.lang, script: p.script, page_w_mm: p.page_w_mm, page_h_mm: p.page_h_mm, tz: p.tz, domain: p.domain ?? null,
    ai: aiState(p.ai_enabled),
  });
  const aiState = (enabled: boolean) => {
    const configured = aiKeyPresent();
    return {
      configured, enabled: configured && !!enabled, switch: !!enabled,
      reason: configured ? null : "No AI key has been added to the server, so AI cannot be turned on. Everything else works without it.",
    };
  };

  app.get("/v1/admin/paper", { schema: { tags: ["admin"] }, preHandler: requireRole() }, async (req) => {
    const p = await prisma.paper.findFirst({ where: { id: req.principal!.paper_id, deleted_at: null } });
    return view(p);
  });

  app.patch("/v1/admin/paper", {
    schema: { tags: ["admin"], body: z.object({
      name: z.string().min(1).max(120).optional(), lang: z.string().min(2).max(12).optional(), script: z.string().min(2).max(12).optional(),
      page_w_mm: z.number().int().min(100).max(1000).optional(), page_h_mm: z.number().int().min(100).max(1500).optional(),
      tz: z.string().min(1).max(64).optional(), domain: z.string().max(253).nullable().optional(),
    }) },
    preHandler: requireRole("owner"),
  }, async (req) => {
    const p = req.principal!;
    const before = await prisma.paper.findFirst({ where: { id: p.paper_id } });
    const row = await prisma.paper.update({ where: { id: p.paper_id }, data: req.body });
    await audit(p.paper_id, p.user_id, "update", "paper", p.paper_id, { name: before?.name, tz: before?.tz }, req.body);
    return view(row);
  });

  app.put("/v1/admin/ai", { schema: { tags: ["admin"], body: z.object({ enabled: z.boolean() }) }, preHandler: requireRole("owner") }, async (req) => {
    const p = req.principal!;
    if (req.body.enabled && !aiKeyPresent())
      throw new ApiError(409, "ai_no_key", "AI cannot be turned on: no AI key has been added to the server. Everything still works without it.");
    const row = await prisma.paper.update({ where: { id: p.paper_id }, data: { ai_enabled: req.body.enabled } });
    await audit(p.paper_id, p.user_id, req.body.enabled ? "ai.on" : "ai.off", "paper", p.paper_id, null, { enabled: req.body.enabled });
    return aiState(row.ai_enabled);
  });
}
