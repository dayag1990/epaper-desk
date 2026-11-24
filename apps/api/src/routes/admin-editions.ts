import { z } from "zod";
import { prisma } from "../db.js";
import { audit, requireRole, WRITE_ROLES } from "../auth.js";
import { notFound } from "../errors.js";
import { enqueue } from "../lib/enqueue.js";
import type { App } from "./types.js";

const Id = z.object({ id: z.string().uuid() });
const day = (d: Date) => d.toISOString().slice(0, 10);

export function adminEditionRoutes(app: App) {
  // one call for the whole edition screen: pages with fill %, newest exports, and the reader copy
  app.get("/v1/admin/editions/:id/overview", { schema: { tags: ["admin"], params: Id }, preHandler: requireRole() }, async (req) => {
    const p = req.principal!;
    const ed = await prisma.edition.findFirst({ where: { id: req.params.id, paper_id: p.paper_id } });
    if (!ed) throw notFound("That edition");
    const pages = await prisma.page.findMany({ where: { edition_id: ed.id, paper_id: p.paper_id, deleted_at: null }, orderBy: { no: "asc" } });
    const exps = await prisma.export.findMany({ where: { edition_id: ed.id, paper_id: p.paper_id }, orderBy: { created_at: "desc" }, take: 20 });
    const ep = await prisma.epEdition.findFirst({ where: { edition_id: ed.id, paper_id: p.paper_id }, orderBy: { created_at: "desc" } });
    const latest = new Map<string, (typeof exps)[number]>();
    for (const e of exps) if (!latest.has(e.format)) latest.set(e.format, e);
    return {
      id: ed.id, date: day(ed.date), name: ed.name, status: ed.status,
      pages: pages.map((g) => ({ id: g.id, no: g.no, fit_pct: g.fit_pct, status: g.status })),
      exports: [...latest.values()].map((e) => ({ id: e.id, format: e.format, status: e.status, url: e.file_key ? `/v1/exports/${e.id}/download` : null })),
      reader: ep ? { id: ep.id, status: ep.status, version: ep.version, publish_at: ep.publish_at } : null,
    };
  });

  // approve every page that is not approved yet; each page keeps its own history entry
  app.post("/v1/admin/editions/:id/approve-all", { schema: { tags: ["admin"], params: Id }, preHandler: requireRole(...WRITE_ROLES) }, async (req) => {
    const p = req.principal!;
    const ed = await prisma.edition.findFirst({ where: { id: req.params.id, paper_id: p.paper_id } });
    if (!ed) throw notFound("That edition");
    const pages = await prisma.page.findMany({ where: { edition_id: ed.id, paper_id: p.paper_id, deleted_at: null, status: { not: "approved" } } });
    let done = 0;
    for (const pg of pages) {
      if (pg.locked_by && pg.locked_by !== p.user_id && pg.lock_expires_at && pg.lock_expires_at > new Date()) continue; // someone is editing it
      const rev = pg.rev + 1;
      const doc = { ...(pg.doc as any), status: "approved", rev };
      await prisma.page.update({ where: { id: pg.id }, data: { doc, rev, status: "approved", locked_by: null, lock_expires_at: null } });
      await prisma.pageVersion.create({ data: { paper_id: p.paper_id, page_id: pg.id, rev, doc, source: "approve", user_id: p.user_id, fit_pct: pg.fit_pct } });
      await enqueue("page.fit", p.paper_id, { page_id: pg.id, rev }, `fit:${pg.id}:${rev}`);
      done++;
    }
    await audit(p.paper_id, p.user_id, "approve_all", "edition", ed.id, null, { approved: done, skipped: pages.length - done });
    return { approved: done, skipped: pages.length - done };
  });
}
