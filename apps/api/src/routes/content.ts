import { z } from "zod";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { type Article } from "@epaper/core";
import { acceptPush, proposeMapping, testSource, PoliteFetcher, plainError } from "@epaper/connectors";
import { prisma } from "../db.js";
import { audit, requireRole, WRITE_ROLES, resolvePrincipal } from "../auth.js";
import { config } from "../env.js";
import { ApiError, notFound, unauthorized } from "../errors.js";
import type { FileDriver } from "../files/index.js";
import { adapterFor } from "../lib/adapters.js";
import { DbArticleStore, paperRef, sourceRef } from "../lib/domain.js";
import { enqueue } from "../lib/enqueue.js";
import { firstFilePart } from "../lib/multipart.js";
import { storeFile } from "../lib/store.js";
import type { App } from "./types.js";

const Id = z.object({ id: z.string().uuid() });
const ctxFor = (paper_id: string, source_id: string) => ({ paperId: paperRef(paper_id), sourceId: sourceRef(source_id) });
const stableAssetId = (src: string) => `ast_${createHash("sha256").update(src).digest("hex").slice(0, 20).toUpperCase()}`;

/** Ask the worker to fetch the pictures of articles that are new or changed. */
export async function queueAssets(paper_id: string, articles: Article[]) {
  for (const a of articles)
    for (const im of a.images)
      await enqueue("asset.fetch", paper_id, { article_id: a.id, asset_id: im.asset_id, src: im.src, caption: im.caption ?? null, credit: im.credit ?? null }, `asset:${im.asset_id}`);
}

export function contentRoutes(app: App, driver: FileDriver) {
  // ---- who am I (the editor opens with this) ----
  app.get("/v1/me", { schema: { tags: ["auth"] }, preHandler: requireRole() }, async (req) => {
    const p = req.principal!;
    const u = p.user_id ? await prisma.user.findUnique({ where: { id: p.user_id } }) : null;
    return { user: { id: p.user_id ?? "", name: u?.name ?? "", email: u?.email }, role: p.role, ai_enabled: config.aiEnabled };
  });

  // ---- the mapping wizard: paste a URL, get a proposed mapping, nothing saved ----
  app.post("/v1/sources/wizard", {
    schema: { tags: ["sources"], body: z.object({ url: z.string().min(1) }) },
    preHandler: requireRole("owner", "editor"),
  }, async (req) => {
    try {
      const prop = await proposeMapping(req.body.url, { fetcher: new PoliteFetcher() });
      return prop;
    } catch (e) {
      throw new ApiError(422, "wizard_failed", plainError(e));
    }
  });

  app.post("/v1/sources/:id/test", { schema: { tags: ["sources"], params: Id }, preHandler: requireRole("owner", "editor") }, async (req) => {
    const p = req.principal!;
    const src = await prisma.source.findFirst({ where: { id: req.params.id, paper_id: p.paper_id, deleted_at: null } });
    if (!src) throw notFound("That source");
    const adapter = adapterFor(src.kind);
    if (!adapter) throw new ApiError(400, "unknown_kind", `We do not know a source kind called "${src.kind}".`);
    try {
      const r = await testSource(adapter, src.config, (src.mapping as any) ?? undefined, ctxFor(p.paper_id, src.id), 5);
      return { ok: r.errors.length === 0, count: r.articles.length, articles: r.articles, errors: r.errors, skipped: r.skipped };
    } catch (e) {
      throw new ApiError(422, "source_test_failed", plainError(e));
    }
  });

  app.post("/v1/sources/:id/sync", { schema: { tags: ["sources"], params: Id }, preHandler: requireRole("owner", "editor") }, async (req, reply) => {
    const p = req.principal!;
    const src = await prisma.source.findFirst({ where: { id: req.params.id, paper_id: p.paper_id, deleted_at: null } });
    if (!src) throw notFound("That source");
    await prisma.source.update({ where: { id: src.id }, data: { status: "syncing" } });
    const j = await enqueue("source.sync", p.paper_id, { source_id: src.id }, `sync:${src.id}:${Date.now()}`);
    await audit(p.paper_id, p.user_id, "sync", "source", src.id, null, null);
    return reply.status(202).send({ job_id: j.id, queue: j.queue });
  });

  // ---- articles ----
  app.get("/v1/articles", {
    schema: { tags: ["articles"], querystring: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), section: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }) },
    preHandler: requireRole(),
  }, async (req) => {
    const { date, section, limit } = req.query;
    const where: any = { paper_id: req.principal!.paper_id, deleted_at: null, ...(section ? { section } : {}) };
    if (date) {
      const d0 = new Date(date + "T00:00:00Z"), d1 = new Date(d0.getTime() + 86400_000);
      // "the day's stories": published that day, or arrived that day
      where.OR = [{ published_at: { gte: d0, lt: d1 } }, { created_at: { gte: d0, lt: d1 } }];
    }
    const rows = await prisma.article.findMany({ where, orderBy: [{ published_at: "desc" }, { id: "asc" }], take: limit });
    return { items: rows.map((r) => r.data) };
  });

  app.patch("/v1/articles/:id", {
    schema: { tags: ["articles"], params: z.object({ id: z.string().min(1) }), body: z.object({ priority: z.number().int().min(0).max(100).optional(), section: z.string().min(1).optional() }) },
    preHandler: requireRole("owner", "editor", "sub"),
  }, async (req) => {
    const p = req.principal!;
    const row = await prisma.article.findFirst({ where: { id: req.params.id, paper_id: p.paper_id, deleted_at: null } });
    if (!row) throw notFound("That article");
    const data = { ...(row.data as any), ...req.body };
    const out = await prisma.article.update({ where: { id: row.id }, data: { ...req.body, data } });
    await audit(p.paper_id, p.user_id, "update", "article", row.id, { priority: row.priority, section: row.section }, req.body);
    return out.data;
  });

  // ---- push door: API key + HMAC over the raw body ----
  app.register(async (s) => {
    s.addContentTypeParser("application/json", { parseAs: "string" }, (_r, body, done) => done(null, body));
    s.post("/v1/ingest/articles", { schema: { tags: ["ingest"] } }, async (req, reply) => {
      const pr = await resolvePrincipal(req);
      if (!pr || pr.kind !== "apikey") throw unauthorized();
      const key = await prisma.apiKey.findUnique({ where: { key_hash: (await import("../auth.js")).hashToken(String(req.headers["x-api-key"])) } });
      if (!key?.source_id) throw new ApiError(403, "key_has_no_source", "This key is not tied to a source.");
      const src = await prisma.source.findFirst({ where: { id: key.source_id, paper_id: pr.paper_id, deleted_at: null } });
      if (!src) throw notFound("That source");
      const secret = (src.config as any)?.secret as string | undefined;
      const r = await acceptPush(
        { body: String(req.body ?? ""), signature: req.headers["x-signature"] as string | undefined, mapping: (src.mapping as any) ?? undefined },
        { secret },
        ctxFor(pr.paper_id, src.id),
        new DbArticleStore(),
      );
      if (!r.ok) throw new ApiError(r.status, r.status === 401 ? "bad_signature" : "bad_article", r.reasons[0] ?? "That article could not be accepted.", { reasons: r.reasons });
      if (r.action !== "unchanged") await queueAssets(pr.paper_id, [r.article]);
      return reply.status(r.status).send({ action: r.action, id: r.article.id, rev: r.article.rev });
    });
  });

  // ---- assets: upload an image (multipart "file" or raw bytes) ----
  app.post("/v1/assets", { schema: { tags: ["assets"] }, preHandler: requireRole(...WRITE_ROLES) }, async (req, reply) => {
    const p = req.principal!;
    const ct = String(req.headers["content-type"] ?? "");
    let data: Buffer | undefined, name = "photo";
    if (ct.startsWith("multipart/form-data")) {
      const part = firstFilePart(req.body as Buffer, ct);
      if (part) { data = part.data; name = part.name; }
    } else if (Buffer.isBuffer(req.body)) data = req.body;
    if (!data?.length) throw new ApiError(400, "empty_file", "Send a picture as the form field 'file'.");
    let meta;
    try { meta = await sharp(data).metadata(); } catch { throw new ApiError(400, "not_an_image", "That file is not a picture we can read."); }
    const ext = meta.format === "jpeg" ? "jpg" : meta.format === "png" ? "png" : meta.format === "webp" ? "webp" : null;
    if (!ext || !meta.width || !meta.height) throw new ApiError(400, "not_an_image", "Use a JPEG, PNG or WebP picture.");
    const f = await storeFile(driver, p.paper_id, "original", ext, data, p.user_id);
    const asset_id = `ast_${f.hash.slice(0, 20).toUpperCase()}`;
    const row = await prisma.asset.upsert({
      where: { paper_id_asset_id: { paper_id: p.paper_id, asset_id } },
      create: { paper_id: p.paper_id, asset_id, kind: "photo", orig_key: f.key, w: meta.width, h: meta.height, hash: f.hash, status: "ready", caption: name },
      update: {},
    });
    await audit(p.paper_id, p.user_id, "create", "asset", row.id, null, { asset_id });
    return reply.status(201).send({ asset: { id: asset_id, src: `/v1/assets/${asset_id}/file`, w: row.w, h: row.h, parent_id: null } });
  });

  app.get("/v1/assets/:aid/file", { schema: { tags: ["assets"], params: z.object({ aid: z.string().regex(/^ast_[A-Za-z0-9_-]+$/) }) }, preHandler: requireRole() }, async (req, reply) => {
    const a = await prisma.asset.findUnique({ where: { paper_id_asset_id: { paper_id: req.principal!.paper_id, asset_id: req.params.aid } } });
    if (!a?.orig_key) throw notFound("That picture");
    const ext = a.orig_key.split(".").pop();
    return reply.header("content-type", ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg").header("cache-control", "private, max-age=86400").send(await driver.get(a.orig_key));
  });

  // cut-out: the browser model does it first; the server cut-out is not built yet (plain words, editor falls back to manual crop)
  app.post("/v1/assets/:aid/cutout", { schema: { tags: ["assets"], params: z.object({ aid: z.string() }) }, preHandler: requireRole(...WRITE_ROLES) }, async () => {
    throw new ApiError(501, "not_built", "The server cut-out is not switched on yet. Crop the photo by hand in the editor.");
  });

  // ---- AI: refused while off. When on, a rules-only option list (no model call here). ----
  app.post("/v1/ai/suggest", {
    schema: { tags: ["ai"], body: z.object({ task: z.string().default("headline"), text: z.string().min(1), max_chars: z.number().int().positive().optional(), article_id: z.string().optional() }) },
    preHandler: requireRole(...WRITE_ROLES),
  }, async (req) => {
    if (!config.aiEnabled) throw new ApiError(403, "ai_disabled", "AI help is switched off. Shorten the headline by hand; the page refits as you type.");
    const words = req.body.text.split(/\s+/).filter(Boolean);
    const cut = (n: number) => words.slice(0, Math.max(3, n)).join(" ");
    return { model: "rules", options: [cut(words.length - 2), cut(words.length - 4), cut(5)].map((text) => ({ text })) };
  });
}
