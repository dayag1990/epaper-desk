import { z } from "zod";
import { PageDocSchema, type PageDoc } from "@epaper/core";
import { prisma } from "../db.js";
import { audit, requireRole, WRITE_ROLES } from "../auth.js";
import { ApiError, notFound } from "../errors.js";
import { enqueue } from "../lib/enqueue.js";
import { templateSet, templateSets } from "../lib/templates.js";
import { publishEvent } from "../events.js";
import type { App } from "./types.js";

const Id = z.object({ id: z.string().uuid() });
const LOCK_MS = 5 * 60_000;
const day = (d: Date) => d.toISOString().slice(0, 10);

/** The lock, or null when nobody holds it or it ran out. */
async function lockOf(page: { locked_by: string | null; lock_expires_at: Date | null }) {
  if (!page.locked_by || !page.lock_expires_at || page.lock_expires_at < new Date()) return null;
  const u = await prisma.user.findUnique({ where: { id: page.locked_by } });
  return { id: page.locked_by, name: u?.name ?? "someone" };
}
const heldByOther = <T extends { id: string }>(lock: T | null, user_id: string | null): T | null => (lock && lock.id !== user_id ? lock : null);
const lockedErr = (who: { id: string; name: string }) => new ApiError(423, "locked", `This page is being edited by ${who.name}. Try again when they are done.`, { locked_by: who });

export async function pageView(page: any) {
  const lock = await lockOf(page);
  return { id: page.id, no: page.no, doc: page.doc, rev: page.rev, status: page.status, fit_pct: page.fit_pct, fit_rev: page.fit_rev, template_id: page.template_id, locked_by: lock, lock_expires_at: lock ? page.lock_expires_at : null };
}

async function reindex(paper_id: string, page_id: string, doc: PageDoc) {
  const rows = doc.items.filter((i) => i.article_id).map((i) => ({ page_id, paper_id, article_id: i.article_id!, article_rev: i.article_rev ?? 0 }));
  await prisma.$transaction([
    prisma.pageArticle.deleteMany({ where: { page_id } }),
    prisma.pageArticle.createMany({ data: rows, skipDuplicates: true }),
  ]);
}

/** Article images served from our store, once they are fetched. */
async function articlesForEditor(paper_id: string) {
  const rows = await prisma.article.findMany({ where: { paper_id, deleted_at: null }, orderBy: { published_at: "desc" }, take: 300 });
  const assets = await prisma.asset.findMany({ where: { paper_id, status: "ready" }, select: { asset_id: true } });
  const ready = new Set(assets.map((a) => a.asset_id));
  return rows.map((r) => {
    const a = r.data as any;
    return { ...a, images: (a.images ?? []).map((im: any) => (ready.has(im.asset_id) ? { ...im, src: `/v1/assets/${im.asset_id}/file` } : im)) };
  });
}

export function editionRoutes(app: App) {
  app.get("/v1/editions", { schema: { tags: ["editions"] }, preHandler: requireRole() }, async (req) => {
    const rows = await prisma.edition.findMany({ where: { paper_id: req.principal!.paper_id }, orderBy: [{ date: "desc" }, { created_at: "desc" }], take: 100 });
    return { items: rows.map((e) => ({ id: e.id, name: e.name, date: day(e.date), status: e.status, rev: e.rev })) };
  });

  app.post("/v1/editions", {
    schema: { tags: ["editions"], body: z.object({ paper: z.string().optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use a date like 2026-11-24"), template_set: z.string().default("broadsheet-en"), name: z.string().max(120).default("") }) },
    preHandler: requireRole(...WRITE_ROLES),
  }, async (req, reply) => {
    const p = req.principal!;
    const { date, template_set, name } = req.body;
    if (!templateSet(template_set)) throw new ApiError(400, "unknown_template_set", "We do not have that template set.", { known: templateSets() });
    const paper = await prisma.paper.findUnique({ where: { id: p.paper_id } });
    if (req.body.paper && req.body.paper !== paper?.slug && req.body.paper !== p.paper_id) throw new ApiError(403, "wrong_paper", "You can only create editions for the paper you are signed in to.");
    const existing = await prisma.edition.findUnique({ where: { paper_id_date_name: { paper_id: p.paper_id, date: new Date(date), name } } });
    if (existing) return reply.status(200).send({ id: existing.id, date, name, template_set: existing.template_set, status: existing.status, existed: true });
    const row = await prisma.edition.create({ data: { paper_id: p.paper_id, date: new Date(date), name, template_set, created_by: p.user_id } });
    await audit(p.paper_id, p.user_id, "create", "edition", row.id, null, { date });
    return reply.status(201).send({ id: row.id, date, name, template_set, status: row.status, existed: false });
  });

  app.post("/v1/editions/:id/autoplan", {
    schema: { tags: ["editions"], params: Id, body: z.object({ pages: z.number().int().min(1).max(64).optional(), sections: z.array(z.string()).optional(), article_ids: z.array(z.string()).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).default({}) },
    preHandler: requireRole(...WRITE_ROLES),
  }, async (req, reply) => {
    const p = req.principal!;
    const ed = await prisma.edition.findFirst({ where: { id: req.params.id, paper_id: p.paper_id } });
    if (!ed) throw notFound("That edition");
    await prisma.edition.update({ where: { id: ed.id }, data: { status: "planning" } });
    const j = await enqueue("edition.autoplan", p.paper_id, { edition_id: ed.id, ...req.body, requested_by: p.user_id }, `autoplan:${ed.id}:${Date.now()}`);
    await audit(p.paper_id, p.user_id, "autoplan", "edition", ed.id, null, req.body);
    return reply.status(202).send({ job_id: j.id, queue: j.queue });
  });

  app.get("/v1/editions/:id", { schema: { tags: ["editions"], params: Id }, preHandler: requireRole() }, async (req) => {
    const p = req.principal!;
    const ed = await prisma.edition.findFirst({ where: { id: req.params.id, paper_id: p.paper_id } });
    if (!ed) throw notFound("That edition");
    const pages = await prisma.page.findMany({ where: { edition_id: ed.id, deleted_at: null }, orderBy: { no: "asc" } });
    return {
      id: ed.id, name: ed.name || `Edition ${day(ed.date)}`, date: day(ed.date), status: ed.status, rev: ed.rev, template_set: ed.template_set,
      pages: await Promise.all(pages.map(pageView)),
      templates: templateSet(ed.template_set) ?? [],
      articles: await articlesForEditor(p.paper_id),
    };
  });

  // ---- pages ----
  const loadPage = async (id: string, paper_id: string) => {
    const page = await prisma.page.findFirst({ where: { id, paper_id, deleted_at: null } });
    if (!page) throw notFound("That page");
    return page;
  };

  app.get("/v1/pages/:id", { schema: { tags: ["pages"], params: Id }, preHandler: requireRole() }, async (req) => pageView(await loadPage(req.params.id, req.principal!.paper_id)));

  // D4 LayoutSnapshot (this one page) of the current version, once the worker has laid it out
  app.get("/v1/pages/:id/snapshot", { schema: { tags: ["pages"], params: Id }, preHandler: requireRole() }, async (req) => {
    const page = await loadPage(req.params.id, req.principal!.paper_id);
    const v = await prisma.pageVersion.findUnique({ where: { page_id_rev: { page_id: page.id, rev: page.rev } } });
    if (!v?.snapshot) throw new ApiError(404, "not_ready", "The layout snapshot for this version is not ready yet.");
    return { rev: page.rev, fit_pct: v.fit_pct, snapshot: v.snapshot };
  });

  app.put("/v1/pages/:id", {
    schema: { tags: ["pages"], params: Id, body: z.object({ doc: z.any(), rev: z.number().int().min(0) }) },
    preHandler: requireRole(...WRITE_ROLES),
  }, async (req) => {
    const p = req.principal!;
    const page = await loadPage(req.params.id, p.paper_id);
    const parsed = PageDocSchema.safeParse(req.body.doc);
    if (!parsed.success) throw new ApiError(400, "bad_page", "That page could not be saved: it is not a valid page.", { problems: parsed.error.issues.slice(0, 10).map((i) => ({ where: i.path.join("."), problem: i.message })) });
    const other = heldByOther(await lockOf(page), p.user_id);
    if (other) throw lockedErr(other);
    if (page.status === "approved") throw new ApiError(423, "approved", "This page is approved and locked. Reopen it to edit.", { locked_by: { id: "-", name: "Approval" } });
    if (req.body.rev !== page.rev) throw new ApiError(409, "stale_rev", "This page changed since you opened it. Your version and the saved one are both included.", { rev: page.rev, doc: page.doc });
    const rev = page.rev + 1;
    const doc = { ...parsed.data, rev };
    const upd = await prisma.page.updateMany({
      where: { id: page.id, rev: page.rev },
      data: { doc: doc as any, rev, updated_at: new Date(), ...(page.locked_by === p.user_id ? { lock_expires_at: new Date(Date.now() + LOCK_MS) } : {}) },
    });
    if (upd.count !== 1) {
      const cur = await prisma.page.findUnique({ where: { id: page.id } });
      throw new ApiError(409, "stale_rev", "This page changed since you opened it.", { rev: cur?.rev, doc: cur?.doc });
    }
    await prisma.pageVersion.create({ data: { paper_id: p.paper_id, page_id: page.id, rev, doc: doc as any, source: "save", user_id: p.user_id } });
    await reindex(p.paper_id, page.id, doc);
    await enqueue("page.fit", p.paper_id, { page_id: page.id, rev }, `fit:${page.id}:${rev}`);
    await publishEvent({ type: "page.updated", paper_id: p.paper_id, page_id: page.id, edition_id: page.edition_id, rev, fill: page.fit_pct ?? null, status: page.status, by: p.user_id });
    return { rev, doc, fit_pct: page.fit_pct };
  });

  app.post("/v1/pages/:id/fit", { schema: { tags: ["pages"], params: Id }, preHandler: requireRole() }, async (req) => {
    const p = req.principal!;
    const page = await loadPage(req.params.id, p.paper_id);
    // the fit runs in the worker's Chromium; wait for it so the editor gets one answer
    await enqueue("page.fit", p.paper_id, { page_id: page.id, rev: page.rev }, `fit:${page.id}:${page.rev}:${Date.now()}`);
    const t0 = Date.now();
    for (;;) {
      const cur = await prisma.page.findUnique({ where: { id: page.id } });
      if (cur && cur.fit_rev >= page.rev && cur.fit_report && (cur.fit_report as any).rev >= page.rev) return cur.fit_report;
      if (Date.now() - t0 > 60_000) throw new ApiError(504, "fit_timeout", "The page is still being measured. Try again in a moment.");
      await new Promise((r) => setTimeout(r, 300));
    }
  });

  app.post("/v1/pages/:id/approve", { schema: { tags: ["pages"], params: Id, body: z.object({ approved: z.boolean().default(true) }).default({}) }, preHandler: requireRole(...WRITE_ROLES) }, async (req) => {
    const p = req.principal!;
    const page = await loadPage(req.params.id, p.paper_id);
    const other = heldByOther(await lockOf(page), p.user_id);
    if (other) throw lockedErr(other);
    const approved = req.body.approved;
    const rev = page.rev + 1;
    const status = approved ? "approved" : "draft";
    const doc = { ...(page.doc as any), status, rev };
    await prisma.page.update({ where: { id: page.id }, data: { doc, rev, status, locked_by: null, lock_expires_at: null } });
    await prisma.pageVersion.create({ data: { paper_id: p.paper_id, page_id: page.id, rev, doc, source: approved ? "approve" : "reopen", user_id: p.user_id, fit_pct: page.fit_pct } });
    await audit(p.paper_id, p.user_id, approved ? "approve" : "reopen", "page", page.id, { rev: page.rev }, { rev });
    await enqueue("page.fit", p.paper_id, { page_id: page.id, rev }, `fit:${page.id}:${rev}`);
    await publishEvent({ type: "page.updated", paper_id: p.paper_id, page_id: page.id, edition_id: page.edition_id, rev, fill: page.fit_pct ?? null, status, by: p.user_id });
    return { status, rev };
  });

  app.get("/v1/pages/:id/versions", { schema: { tags: ["pages"], params: Id }, preHandler: requireRole() }, async (req) => {
    const page = await loadPage(req.params.id, req.principal!.paper_id);
    const vs = await prisma.pageVersion.findMany({ where: { page_id: page.id }, orderBy: { rev: "desc" }, take: 200 });
    const users = await prisma.user.findMany({ where: { id: { in: vs.map((v) => v.user_id).filter(Boolean) as string[] } } });
    const name = new Map(users.map((u) => [u.id, u.name]));
    return { versions: vs.map((v) => ({ rev: v.rev, at: v.at, source: v.source, fit_pct: v.fit_pct, has_snapshot: !!v.snapshot, user: v.user_id ? { id: v.user_id, name: name.get(v.user_id) ?? "" } : { id: "system", name: v.source === "autoplan" ? "Auto-plan" : "System" }, doc: v.doc })) };
  });

  app.post("/v1/pages/:id/restore", { schema: { tags: ["pages"], params: Id, body: z.object({ rev: z.number().int() }) }, preHandler: requireRole(...WRITE_ROLES) }, async (req) => {
    const p = req.principal!;
    const page = await loadPage(req.params.id, p.paper_id);
    const other = heldByOther(await lockOf(page), p.user_id);
    if (other) throw lockedErr(other);
    if (page.status === "approved") throw new ApiError(423, "approved", "This page is approved and locked. Reopen it to edit.");
    const v = await prisma.pageVersion.findUnique({ where: { page_id_rev: { page_id: page.id, rev: req.body.rev } } });
    if (!v) throw notFound("That version");
    const rev = page.rev + 1;
    const doc = { ...(v.doc as any), rev };
    await prisma.page.update({ where: { id: page.id }, data: { doc, rev } });
    await prisma.pageVersion.create({ data: { paper_id: p.paper_id, page_id: page.id, rev, doc, source: "restore", user_id: p.user_id } });
    await reindex(p.paper_id, page.id, doc);
    await enqueue("page.fit", p.paper_id, { page_id: page.id, rev }, `fit:${page.id}:${rev}`);
    await publishEvent({ type: "page.updated", paper_id: p.paper_id, page_id: page.id, edition_id: page.edition_id, rev, fill: page.fit_pct ?? null, status: page.status, by: p.user_id });
    return { rev, doc };
  });

  // ---- delete a page: kept as a version, later pages move up one number ----
  // Nothing is destroyed: the row stays (deleted_at), its versions stay (the last one is "delete"), only the page number is
  // parked below zero so the number can be used again. Stories that were only on this page go back to "not placed".
  app.delete("/v1/pages/:id", { schema: { tags: ["pages"], params: Id }, preHandler: requireRole(...WRITE_ROLES) }, async (req) => {
    const p = req.principal!;
    const page = await loadPage(req.params.id, p.paper_id);
    const other = heldByOther(await lockOf(page), p.user_id);
    if (other) throw lockedErr(other);
    if (page.status === "approved") throw new ApiError(423, "approved", "This page is approved and locked. Reopen it before you delete it.");
    const all = await prisma.page.findMany({ where: { edition_id: page.edition_id, deleted_at: null }, orderBy: { no: "asc" } });
    if (all.length <= 1) throw new ApiError(409, "last_page", "This is the only page of the edition, so it cannot be deleted.");
    const later = all.filter((x) => x.no > page.no);
    for (const l of later) {
      if (l.status === "approved") throw new ApiError(423, "approved", `Page ${l.no} is approved and its page number would change. Reopen page ${l.no} first, then delete this page.`);
      const o = heldByOther(await lockOf(l), p.user_id);
      if (o) throw new ApiError(423, "locked", `Page ${l.no} is being edited by ${o.name}, and its page number would change. Try again when they are done.`, { locked_by: o });
    }
    const lowest = (await prisma.page.findFirst({ where: { edition_id: page.edition_id }, orderBy: { no: "asc" } }))!.no;
    const parked = Math.min(0, lowest) - 1;
    const rev = page.rev + 1;
    const ddoc = { ...(page.doc as any), rev };
    const ops: any[] = [
      prisma.pageVersion.create({ data: { paper_id: p.paper_id, page_id: page.id, rev, doc: ddoc, source: "delete", user_id: p.user_id, fit_pct: page.fit_pct } }),
      prisma.page.update({ where: { id: page.id }, data: { doc: ddoc, rev, no: parked, deleted_at: new Date(), locked_by: null, lock_expires_at: null } }),
      prisma.pageArticle.deleteMany({ where: { page_id: page.id } }),
    ];
    const moved: { id: string; no: number; rev: number }[] = [];
    for (const l of later) {
      const no = l.no - 1, lrev = l.rev + 1;
      const ldoc = { ...(l.doc as any), page: { ...(l.doc as any).page, no }, rev: lrev };
      ops.push(
        prisma.page.update({ where: { id: l.id }, data: { no, doc: ldoc, rev: lrev } }),
        prisma.pageVersion.create({ data: { paper_id: p.paper_id, page_id: l.id, rev: lrev, doc: ldoc, source: "renumber", user_id: p.user_id, fit_pct: l.fit_pct } }),
      );
      moved.push({ id: l.id, no, rev: lrev });
    }
    await prisma.$transaction(ops);
    await audit(p.paper_id, p.user_id, "delete", "page", page.id, { no: page.no, rev: page.rev }, { rev, renumbered: moved.length });
    // measure the pages whose number changed again, so the fit numbers on the desk are true
    for (const m of moved) await enqueue("page.fit", p.paper_id, { page_id: m.id, rev: m.rev }, `fit:${m.id}:${m.rev}`);
    await publishEvent({ type: "edition.changed", paper_id: p.paper_id, edition_id: page.edition_id });
    return { deleted: { id: page.id, no: page.no, rev }, pages: moved, kept_as_version: rev };
  });

  // ---- lock: holder + expiry, "being edited by ..." ----
  app.post("/v1/pages/:id/lock", { schema: { tags: ["pages"], params: Id }, preHandler: requireRole(...WRITE_ROLES) }, async (req) => {
    const p = req.principal!;
    const page = await loadPage(req.params.id, p.paper_id);
    const other = heldByOther(await lockOf(page), p.user_id);
    if (other) throw lockedErr(other);
    const expires = new Date(Date.now() + LOCK_MS);
    // only take it if still free (two editors at once: one wins)
    const r = await prisma.page.updateMany({
      where: { id: page.id, OR: [{ locked_by: null }, { locked_by: p.user_id }, { lock_expires_at: { lt: new Date() } }] },
      data: { locked_by: p.user_id, lock_expires_at: expires },
    });
    if (r.count !== 1) {
      const cur = await prisma.page.findUnique({ where: { id: page.id } });
      const who = await lockOf(cur!);
      if (who) throw lockedErr(who);
    }
    const u = await prisma.user.findUnique({ where: { id: p.user_id! } });
    return { locked_by: { id: p.user_id, name: u?.name ?? "" }, expires_at: expires.toISOString() };
  });

  app.delete("/v1/pages/:id/lock", { schema: { tags: ["pages"], params: Id }, preHandler: requireRole(...WRITE_ROLES) }, async (req, reply) => {
    const p = req.principal!;
    const page = await loadPage(req.params.id, p.paper_id);
    if (page.locked_by === p.user_id) await prisma.page.update({ where: { id: page.id }, data: { locked_by: null, lock_expires_at: null } });
    return reply.status(204).send();
  });
}
