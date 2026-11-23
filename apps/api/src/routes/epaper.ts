import { z } from "zod";
import { randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { audit, requireRole, WRITE_ROLES } from "../auth.js";
import { ApiError, notFound } from "../errors.js";
import type { FileDriver } from "../files/index.js";
import { emitWebhook, enqueue } from "../lib/enqueue.js";
import { storeFile } from "../lib/store.js";
import type { App } from "./types.js";

const Id = z.object({ id: z.string().uuid() });
const day = (d: Date) => d.toISOString().slice(0, 10);
const PUBLISH_ROLES = ["owner", "editor"] as const;

/** Newest page version that has not been rolled back, one per page number. */
export async function currentPages(ep_edition_id: string) {
  const rows = await prisma.epPage.findMany({ where: { ep_edition_id, rolled_back: false }, orderBy: [{ no: "asc" }, { version: "desc" }] });
  const seen = new Set<number>();
  return rows.filter((r) => (seen.has(r.no) ? false : (seen.add(r.no), true)));
}

const hostOf = (req: any) => `${req.protocol}://${req.headers["x-forwarded-host"] ?? req.headers.host}`;

export function epaperRoutes(app: App, driver: FileDriver) {
  const loadEd = async (id: string, paper_id: string) => {
    const e = await prisma.epEdition.findFirst({ where: { id, paper_id } });
    if (!e) throw notFound("That e-paper edition");
    return e;
  };

  // PDF upload (wire 11) or {edition_id} (wire 12: our own screen PDF + snapshot)
  app.post("/v1/epaper/editions", {
    schema: { tags: ["epaper"], querystring: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), body: z.any() },
    preHandler: requireRole(...WRITE_ROLES),
  }, async (req, reply) => {
    const p = req.principal!;
    const ct = String(req.headers["content-type"] ?? "");
    if (ct.startsWith("application/json")) {
      const b = z.object({ edition_id: z.string().uuid(), export_id: z.string().uuid().optional() }).safeParse(req.body);
      if (!b.success) throw new ApiError(400, "bad_request", "Send {edition_id} or upload a PDF.");
      const ex = await prisma.export.findFirst({
        where: { paper_id: p.paper_id, edition_id: b.data.edition_id, format: "pdf_screen", status: "done", ...(b.data.export_id ? { id: b.data.export_id } : {}) },
        orderBy: { created_at: "desc" },
      });
      if (!ex) throw new ApiError(409, "no_pdf", "This edition has no finished PDF yet. Export the screen PDF first.");
      const ed = await prisma.edition.findUnique({ where: { id: ex.edition_id } });
      let ep = await prisma.epEdition.findFirst({ where: { paper_id: p.paper_id, export_id: ex.id } });
      if (!ep) ep = await prisma.epEdition.create({ data: { paper_id: p.paper_id, date: ed!.date, source: "export", export_id: ex.id, edition_id: ex.edition_id, pdf_key: ex.file_key, status: "building" } });
      if (ep.status === "building" || ep.status === "failed") await enqueue("epaper.build", p.paper_id, { ep_edition_id: ep.id }, `build:${ep.id}`);
      return reply.status(202).send({ id: ep.id, status: ep.status });
    }
    const data = req.body as Buffer;
    if (!Buffer.isBuffer(data) || data.length < 8 || data.subarray(0, 5).toString() !== "%PDF-") throw new ApiError(400, "not_a_pdf", "Send the final PDF as the request body (application/octet-stream).");
    const date = req.query.date ?? day(new Date());
    const f = await storeFile(driver, p.paper_id, "pdf", "pdf", data, p.user_id);
    let ep = await prisma.epEdition.findFirst({ where: { paper_id: p.paper_id, date: new Date(date), source: "upload", pdf_key: f.key } });
    if (!ep) ep = await prisma.epEdition.create({ data: { paper_id: p.paper_id, date: new Date(date), source: "upload", pdf_key: f.key, pdf_hash: f.hash, status: "building" } });
    if (ep.status === "building" || ep.status === "failed") await enqueue("epaper.build", p.paper_id, { ep_edition_id: ep.id }, `build:${ep.id}`);
    await audit(p.paper_id, p.user_id, "upload", "ep_edition", ep.id, null, { date });
    return reply.status(202).send({ id: ep.id, status: ep.status });
  });

  app.get("/v1/epaper/editions", { schema: { tags: ["epaper"] }, preHandler: requireRole() }, async (req) => {
    const rows = await prisma.epEdition.findMany({ where: { paper_id: req.principal!.paper_id }, orderBy: { created_at: "desc" }, take: 100 });
    return { items: rows.map((e) => ({ id: e.id, date: day(e.date), status: e.status, version: e.version, source: e.source, publish_at: e.publish_at })) };
  });

  app.get("/v1/epaper/editions/:id", { schema: { tags: ["epaper"], params: Id }, preHandler: requireRole() }, async (req) => {
    const e = await loadEd(req.params.id, req.principal!.paper_id);
    const pages = await currentPages(e.id);
    return { id: e.id, date: day(e.date), status: e.status, error: e.error, version: e.version, source: e.source, publish_at: e.publish_at, misses: e.misses, pages: pages.map((pg) => ({ id: pg.id, no: pg.no, version: pg.version, corrected: pg.corrected, zoned_by: pg.zoned_by })) };
  });

  app.put("/v1/epaper/editions/:id/pages/:no", {
    schema: { tags: ["epaper"], params: z.object({ id: z.string().uuid(), no: z.coerce.number().int().min(1) }), body: z.any() },
    preHandler: requireRole(...PUBLISH_ROLES),
  }, async (req, reply) => {
    const p = req.principal!;
    const e = await loadEd(req.params.id, p.paper_id);
    const data = req.body as Buffer;
    if (!Buffer.isBuffer(data) || data.subarray(0, 5).toString() !== "%PDF-") throw new ApiError(400, "not_a_pdf", "Send the corrected page as a one-page PDF.");
    const f = await storeFile(driver, p.paper_id, "pdf", "pdf", data, p.user_id);
    await enqueue("epaper.replace_page", p.paper_id, { ep_edition_id: e.id, no: req.params.no, pdf_key: f.key }, `replace:${e.id}:${req.params.no}:${f.hash}`);
    await audit(p.paper_id, p.user_id, "replace", "ep_page", e.id, null, { no: req.params.no });
    return reply.status(202).send({ ok: true });
  });

  app.patch("/v1/epaper/pages/:id/zones", {
    schema: {
      tags: ["epaper"], params: Id,
      body: z.object({ zones: z.array(z.object({
        id: z.string().optional(), article_id: z.string().nullable(), title: z.string(), url: z.string().url().nullable(),
        rects: z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)])).min(1),
      })) }),
    },
    preHandler: requireRole(...PUBLISH_ROLES),
  }, async (req) => {
    const p = req.principal!;
    const pg = await prisma.epPage.findFirst({ where: { id: req.params.id, paper_id: p.paper_id } });
    if (!pg) throw notFound("That page");
    for (const z of req.body.zones) for (const [x, y, w, h] of z.rects) if (x + w > 1.000001 || y + h > 1.000001) throw new ApiError(400, "rect_outside", "A tap area runs past the edge of the page.");
    await prisma.$transaction([
      prisma.epZone.deleteMany({ where: { ep_page_id: pg.id } }),
      prisma.epZone.createMany({ data: req.body.zones.map((z, i) => ({ paper_id: p.paper_id, ep_page_id: pg.id, zone_id: z.id ?? `z_MANUAL${Date.now().toString(36).toUpperCase()}${i}`, article_id: z.article_id, rects: z.rects, title: z.title, url: z.url, confidence: 1, source: "manual" })) }),
    ]);
    await audit(p.paper_id, p.user_id, "zones", "ep_page", pg.id, null, { count: req.body.zones.length });
    return { ok: true, count: req.body.zones.length };
  });

  app.post("/v1/epaper/editions/:id/publish", {
    schema: { tags: ["epaper"], params: Id, body: z.object({ at: z.string().datetime({ offset: true }).optional() }).default({}) },
    preHandler: requireRole(...PUBLISH_ROLES),
  }, async (req) => {
    const p = req.principal!;
    const e = await loadEd(req.params.id, p.paper_id);
    if (e.status === "building" || e.status === "failed") throw new ApiError(409, "not_ready", "The e-paper is not built yet. Wait for it to finish.");
    const at = req.body.at ? new Date(req.body.at) : new Date();
    if (at.getTime() > Date.now() + 1000) {
      await prisma.epEdition.update({ where: { id: e.id }, data: { status: "scheduled", publish_at: at } });
      await enqueue("epaper.publish", p.paper_id, { ep_edition_id: e.id }, `publish:${e.id}:${at.getTime()}`, Math.ceil((at.getTime() - Date.now()) / 1000));
      return { status: "scheduled", publish_at: at };
    }
    await prisma.epEdition.update({ where: { id: e.id }, data: { status: "published", publish_at: at, published_at: new Date() } });
    const paper = await prisma.paper.findUnique({ where: { id: p.paper_id } });
    const pages = await currentPages(e.id);
    await emitWebhook(p.paper_id, e.published_at ? "edition.updated" : "edition.published", {
      event: e.published_at ? "edition.updated" : "edition.published", paper: paper!.slug, edition: day(e.date), pages: pages.length,
      url: `${hostOf(req)}/v1/public/editions/${e.id}/pages`,
    });
    await audit(p.paper_id, p.user_id, "publish", "ep_edition", e.id, null, null);
    return { status: "published", publish_at: at };
  });

  // rollback: undo the newest corrected page; with no corrected page, take the edition back to draft
  app.post("/v1/epaper/editions/:id/rollback", { schema: { tags: ["epaper"], params: Id }, preHandler: requireRole(...PUBLISH_ROLES) }, async (req) => {
    const p = req.principal!;
    const e = await loadEd(req.params.id, p.paper_id);
    const latest = await prisma.epPage.findFirst({ where: { ep_edition_id: e.id, rolled_back: false, version: { gt: 1 } }, orderBy: [{ version: "desc" }, { no: "asc" }] });
    if (latest) {
      await prisma.epPage.update({ where: { id: latest.id }, data: { rolled_back: true } });
      await prisma.epEdition.update({ where: { id: e.id }, data: { version: { increment: 1 } } });
      await audit(p.paper_id, p.user_id, "rollback", "ep_page", latest.id, null, { no: latest.no });
      return { rolled_back: "page", no: latest.no };
    }
    await prisma.epEdition.update({ where: { id: e.id }, data: { status: "ready", published_at: null } });
    await audit(p.paper_id, p.user_id, "rollback", "ep_edition", e.id, null, null);
    return { rolled_back: "edition" };
  });

  // ---- webhooks (D6) ----
  app.post("/v1/webhooks", {
    schema: { tags: ["webhooks"], body: z.object({ url: z.string().url(), events: z.array(z.string()).default(["edition.published", "edition.updated", "page.replaced", "export.ready"]) }) },
    preHandler: requireRole("owner"),
  }, async (req, reply) => {
    const p = req.principal!;
    const secret = `whsec_${randomBytes(24).toString("base64url")}`;
    const row = await prisma.webhook.create({ data: { paper_id: p.paper_id, url: req.body.url, secret, events: req.body.events } });
    return reply.status(201).send({ id: row.id, url: row.url, events: row.events, secret, note: "Copy the secret now. It is shown once." });
  });
  app.get("/v1/webhooks", { schema: { tags: ["webhooks"] }, preHandler: requireRole("owner") }, async (req) => {
    const rows = await prisma.webhook.findMany({ where: { paper_id: req.principal!.paper_id, deleted_at: null } });
    return { items: rows.map((w) => ({ id: w.id, url: w.url, events: w.events, active: w.active })) };
  });
  app.get("/v1/webhooks/:id/deliveries", { schema: { tags: ["webhooks"], params: Id }, preHandler: requireRole("owner") }, async (req) => {
    const rows = await prisma.webhookDelivery.findMany({ where: { webhook_id: req.params.id, paper_id: req.principal!.paper_id }, orderBy: { at: "desc" }, take: 50 });
    return { items: rows.map((d) => ({ id: d.id, event: d.event, status: d.status, attempts: d.attempts, last_error: d.last_error, payload: d.payload })) };
  });
}
