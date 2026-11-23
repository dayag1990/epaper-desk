import { z } from "zod";
import { prisma } from "../db.js";
import { ApiError, notFound } from "../errors.js";
import type { FileDriver } from "../files/index.js";
import { currentPages } from "./epaper.js";
import type { App } from "./types.js";

const day = (d: Date) => d.toISOString().slice(0, 10);

/** The reader's read API. No sign-in; only published editions; CORS open. */
export function publicRoutes(app: App, driver: FileDriver) {
  app.addHook("onSend", async (req, reply) => {
    if (req.url.startsWith("/v1/public/")) {
      reply.header("access-control-allow-origin", "*");
      reply.header("access-control-allow-headers", "content-type");
    }
  });
  app.options("/v1/public/*", async (_r, reply) => reply.status(204).header("access-control-allow-methods", "GET,POST,OPTIONS").send());

  const publishedEdition = async (id: string) => {
    const e = await prisma.epEdition.findFirst({ where: { id, status: "published" } });
    if (!e) throw notFound("That edition");
    return e;
  };

  app.get("/v1/public/papers/:slug/editions", {
    schema: { tags: ["public"], params: z.object({ slug: z.string() }), querystring: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }) },
  }, async (req) => {
    const paper = await prisma.paper.findFirst({ where: { slug: req.params.slug, deleted_at: null } });
    if (!paper) throw notFound("That paper");
    const rows = await prisma.epEdition.findMany({
      where: { paper_id: paper.id, status: "published", ...(req.query.date ? { date: new Date(req.query.date) } : {}) },
      orderBy: [{ date: "desc" }, { published_at: "desc" }], take: 60,
    });
    return { paper: { slug: paper.slug, name: paper.name, lang: paper.lang }, items: rows.map((e) => ({ id: e.id, date: day(e.date), version: e.version, published_at: e.published_at })) };
  });

  app.get("/v1/public/editions/:id/pages", { schema: { tags: ["public"], params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const e = await publishedEdition(req.params.id);
    const pages = await currentPages(e.id);
    return {
      id: e.id, date: day(e.date), version: e.version,
      pages: pages.map((p) => ({
        id: p.id, no: p.no, version: p.version, corrected: p.corrected, w: p.img_w, h: p.img_h,
        images: Object.keys(p.img_keys as object).map(Number).sort((a, b) => a - b).map((w) => ({ w, url: `/v1/public/pages/${p.id}/image/${w}` })),
      })),
    };
  });

  app.get("/v1/public/pages/:id/zones", { schema: { tags: ["public"], params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const pg = await prisma.epPage.findUnique({ where: { id: req.params.id }, include: { zones: true } });
    if (!pg) throw notFound("That page");
    await publishedEdition(pg.ep_edition_id);
    // D5 ZoneSet
    return { page: pg.no, image: { w: pg.img_w, h: pg.img_h }, version: pg.version, zones: pg.zones.map((z) => ({ id: z.zone_id, article_id: z.article_id, title: z.title, url: z.url, rects: z.rects, confidence: z.confidence, source: z.source })) };
  });

  app.get("/v1/public/pages/:id/image/:w", { schema: { tags: ["public"], params: z.object({ id: z.string().uuid(), w: z.coerce.number().int() }) } }, async (req, reply) => {
    const pg = await prisma.epPage.findUnique({ where: { id: req.params.id } });
    if (!pg) throw notFound("That page");
    await publishedEdition(pg.ep_edition_id);
    const key = (pg.img_keys as Record<string, string>)[String(req.params.w)];
    if (!key) throw notFound("That image size");
    return reply.header("content-type", key.endsWith(".webp") ? "image/webp" : "image/jpeg").header("cache-control", "public, max-age=31536000, immutable").send(await driver.get(key));
  });

  app.get("/v1/public/pages/:id/pdf", { schema: { tags: ["public"], params: z.object({ id: z.string().uuid() }) } }, async (req, reply) => {
    const pg = await prisma.epPage.findUnique({ where: { id: req.params.id } });
    if (!pg?.pdf_key) throw notFound("That page");
    await publishedEdition(pg.ep_edition_id);
    return reply.header("content-type", "application/pdf").send(await driver.get(pg.pdf_key));
  });

  app.get("/v1/public/search", {
    schema: { tags: ["public"], querystring: z.object({ q: z.string().min(2), paper: z.string().optional(), from: z.string().optional(), to: z.string().optional() }) },
  }, async (req) => {
    const { q, paper, from, to } = req.query;
    const rows = await prisma.epPage.findMany({
      where: {
        rolled_back: false, text: { contains: q, mode: "insensitive" },
        edition: { status: "published", ...(paper ? { paper: { slug: paper } } : {}), ...(from || to ? { date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}) },
      },
      include: { edition: true }, take: 50,
    });
    return {
      items: rows.map((p) => {
        const i = p.text.toLowerCase().indexOf(q.toLowerCase());
        return { edition_id: p.ep_edition_id, date: day(p.edition.date), page_id: p.id, no: p.no, snippet: p.text.slice(Math.max(0, i - 60), i + q.length + 60).replace(/\s+/g, " ") };
      }),
    };
  });

  app.post("/v1/public/events", {
    schema: { tags: ["public"], body: z.object({ paper: z.string(), type: z.string().min(1).max(40), ep_page_id: z.string().uuid().optional(), zone_id: z.string().max(80).optional() }) },
  }, async (req, reply) => {
    const paper = await prisma.paper.findFirst({ where: { slug: req.body.paper, deleted_at: null } });
    if (!paper) throw new ApiError(404, "not_found", "That paper was not found.");
    await prisma.event.create({ data: { paper_id: paper.id, type: req.body.type, ep_page_id: req.body.ep_page_id, zone_id: req.body.zone_id } });
    return reply.status(204).send();
  });
}
