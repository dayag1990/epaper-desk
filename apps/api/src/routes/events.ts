import { z } from "zod";
import { requireRole } from "../auth.js";
import { prisma } from "../db.js";
import { hub as defaultHub, openSse, PUBLIC_TYPES, type EventHub } from "../events.js";
import { notFound } from "../errors.js";
import type { App } from "./types.js";

/** Live updates (Server-Sent Events). The people who are signed in get their paper's events; the public reader only gets "an edition was published". */
export function eventRoutes(app: App, hub: EventHub = defaultHub) {
  app.get("/v1/events", { schema: { tags: ["events"] }, preHandler: requireRole() }, async (req, reply) => {
    const p = req.principal!;
    openSse(req, reply, { paper_id: p.paper_id, listening: hub.connected }, (send) => hub.subscribe(p.paper_id, send));
  });

  // no sign-in: the reader only learns that an edition changed, and re-reads the public pages route itself
  app.get("/v1/public/papers/:slug/events", { schema: { tags: ["public"], params: z.object({ slug: z.string() }) } }, async (req, reply) => {
    const paper = await prisma.paper.findFirst({ where: { slug: req.params.slug, deleted_at: null } });
    if (!paper) throw notFound("That paper");
    openSse(req, reply, { paper: paper.slug }, (send) => hub.subscribe(paper.id, send, PUBLIC_TYPES), { "access-control-allow-origin": "*" });
  });
}
