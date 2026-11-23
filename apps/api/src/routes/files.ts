import { z } from "zod";
import { prisma } from "../db.js";
import { audit, requireRole, WRITE_ROLES } from "../auth.js";
import { ApiError, notFound } from "../errors.js";
import { BadFileKeyError, FileExistsError, fileKey, sha256, type FileDriver } from "../files/index.js";
import type { App } from "./types.js";

export function fileRoutes(app: App, driver: FileDriver) {
  app.post("/v1/files", {
    schema: { tags: ["files"], querystring: z.object({ kind: z.string().default("original"), ext: z.string().default("bin") }) },
    preHandler: requireRole(...WRITE_ROLES),
  }, async (req, reply) => {
    const p = req.principal!;
    const data = req.body as Buffer;
    if (!Buffer.isBuffer(data) || data.length === 0) throw new ApiError(400, "empty_file", "Send the file as the request body (application/octet-stream).");
    const { kind, ext } = req.query;
    const hash = sha256(data);
    const dup = await prisma.file.findFirst({ where: { paper_id: p.paper_id, hash, kind, ext, deleted_at: null } });
    if (dup) return reply.status(200).send({ id: dup.id, hash, key: dup.key, size: dup.size, existed: true });
    let key: string;
    try {
      key = fileKey({ paper: p.paper_id, date: new Date().toISOString().slice(0, 10), kind, hash, ext });
    } catch (e) {
      if (e instanceof BadFileKeyError) throw new ApiError(400, "bad_file_name", "Kind and extension must be short lowercase words.");
      throw e;
    }
    try {
      await driver.put(key, data);
    } catch (e) {
      if (!(e instanceof FileExistsError)) throw e; // same bytes already on disk (e.g. soft-deleted row): keep the original
    }
    const row = await prisma.file.create({ data: { paper_id: p.paper_id, hash, kind, ext, size: data.length, key, created_by: p.user_id } });
    await audit(p.paper_id, p.user_id, "create", "file", row.id, null, { key, size: data.length });
    return reply.status(201).send({ id: row.id, hash, key, size: row.size, existed: false });
  });

  app.get("/v1/files", { schema: { tags: ["files"] }, preHandler: requireRole() }, async (req) => {
    const rows = await prisma.file.findMany({ where: { paper_id: req.principal!.paper_id, deleted_at: null }, orderBy: { created_at: "asc" } });
    return { items: rows.map((r) => ({ id: r.id, hash: r.hash, kind: r.kind, ext: r.ext, size: r.size, key: r.key })) };
  });

  app.get("/v1/files/:id", { schema: { tags: ["files"], params: z.object({ id: z.string().uuid() }) }, preHandler: requireRole() }, async (req, reply) => {
    const row = await prisma.file.findFirst({ where: { id: req.params.id, paper_id: req.principal!.paper_id, deleted_at: null } });
    if (!row) throw notFound("That file");
    const buf = await driver.get(row.key);
    return reply.header("content-type", "application/octet-stream").header("cache-control", "private").send(buf);
  });
}
