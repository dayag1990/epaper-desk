import { z } from "zod";
import { prisma } from "../db.js";
import { audit, requireRole } from "../auth.js";
import { notFound } from "../errors.js";
import { enqueue } from "../lib/enqueue.js";
import type { App } from "./types.js";

const Id = z.object({ id: z.string().uuid() });

/** API keys (list, revoke) and webhooks (test, remove). Creating either stays at the existing routes. */
export function adminKeyHookRoutes(app: App) {
  app.get("/v1/admin/keys", { schema: { tags: ["admin"] }, preHandler: requireRole("owner") }, async (req) => {
    const rows = await prisma.apiKey.findMany({ where: { paper_id: req.principal!.paper_id, deleted_at: null }, orderBy: { created_at: "desc" } });
    // never the key or its hash
    return { items: rows.map((k) => ({ id: k.id, source_id: k.source_id, label: k.label, last_used_at: k.last_used_at, created_at: k.created_at })) };
  });

  app.delete("/v1/admin/keys/:id", { schema: { tags: ["admin"], params: Id }, preHandler: requireRole("owner") }, async (req) => {
    const p = req.principal!;
    const k = await prisma.apiKey.findFirst({ where: { id: req.params.id, paper_id: p.paper_id, deleted_at: null } });
    if (!k) throw notFound("That key");
    await prisma.apiKey.update({ where: { id: k.id }, data: { deleted_at: new Date() } });
    await audit(p.paper_id, p.user_id, "revoke", "api_key", k.id, { source_id: k.source_id }, null);
    return { ok: true };
  });

  app.post("/v1/admin/webhooks/:id/test", { schema: { tags: ["admin"], params: Id }, preHandler: requireRole("owner") }, async (req, reply) => {
    const p = req.principal!;
    const h = await prisma.webhook.findFirst({ where: { id: req.params.id, paper_id: p.paper_id, deleted_at: null } });
    if (!h) throw notFound("That webhook");
    const d = await prisma.webhookDelivery.create({ data: { paper_id: p.paper_id, webhook_id: h.id, event: "test", payload: { event: "test", note: "This is a test from the admin console." } as any } });
    await enqueue("webhook.deliver", p.paper_id, { delivery_id: d.id }, `wh:${d.id}`);
    await audit(p.paper_id, p.user_id, "test", "webhook", h.id, null, null);
    return reply.status(202).send({ delivery_id: d.id });
  });

  app.delete("/v1/admin/webhooks/:id", { schema: { tags: ["admin"], params: Id }, preHandler: requireRole("owner") }, async (req) => {
    const p = req.principal!;
    const h = await prisma.webhook.findFirst({ where: { id: req.params.id, paper_id: p.paper_id, deleted_at: null } });
    if (!h) throw notFound("That webhook");
    await prisma.webhook.update({ where: { id: h.id }, data: { deleted_at: new Date(), active: false } });
    await audit(p.paper_id, p.user_id, "delete", "webhook", h.id, { url: h.url }, null);
    return { ok: true };
  });
}
