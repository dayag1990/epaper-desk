import { z } from "zod";
import { prisma } from "../db.js";
import { audit, requireRole, WRITE_ROLES } from "../auth.js";
import { ApiError, notFound } from "../errors.js";
import type { FileDriver } from "../files/index.js";
import { enqueue } from "../lib/enqueue.js";
import type { App } from "./types.js";

const Id = z.object({ id: z.string().uuid() });
const FORMATS = ["pdf_screen", "cxml", "idml", "pdf_press"] as const;
const MIME: Record<string, string> = { pdf: "application/pdf", xml: "application/xml", json: "application/json", zip: "application/zip" };

export function exportRoutes(app: App, driver: FileDriver) {
  app.post("/v1/editions/:id/exports", {
    schema: { tags: ["exports"], params: Id, body: z.object({ format: z.enum(FORMATS), build_epaper: z.boolean().default(true) }) },
    preHandler: requireRole(...WRITE_ROLES),
  }, async (req, reply) => {
    const p = req.principal!;
    const ed = await prisma.edition.findFirst({ where: { id: req.params.id, paper_id: p.paper_id } });
    if (!ed) throw notFound("That edition");
    const { format } = req.body;
    if (format === "idml") throw new ApiError(501, "not_built", "The InDesign (IDML) export is not part of this release yet.");
    if (format === "pdf_press") throw new ApiError(501, "not_built", "Press PDF needs the client's press profile and is phase 2. Use the screen PDF.");
    const pages = await prisma.page.count({ where: { edition_id: ed.id } });
    if (!pages) throw new ApiError(409, "no_pages", "This edition has no pages yet. Run auto-plan first.");
    const row = await prisma.export.create({ data: { paper_id: p.paper_id, edition_id: ed.id, format, created_by: p.user_id, log: [] } });
    const j = await enqueue("export.run", p.paper_id, { export_id: row.id, build_epaper: req.body.build_epaper }, `export:${row.id}`);
    await audit(p.paper_id, p.user_id, "create", "export", row.id, null, { format });
    return reply.status(202).send({ id: row.id, status: row.status, job_id: j.id });
  });

  app.get("/v1/editions/:id/exports", { schema: { tags: ["exports"], params: Id }, preHandler: requireRole() }, async (req) => {
    const rows = await prisma.export.findMany({ where: { edition_id: req.params.id, paper_id: req.principal!.paper_id }, orderBy: { created_at: "desc" }, take: 50 });
    return { items: rows.map((r) => ({ id: r.id, format: r.format, status: r.status, url: r.file_key ? `/v1/exports/${r.id}/download` : null, at: r.created_at })) };
  });

  app.get("/v1/exports/:id", { schema: { tags: ["exports"], params: Id }, preHandler: requireRole() }, async (req) => {
    const r = await prisma.export.findFirst({ where: { id: req.params.id, paper_id: req.principal!.paper_id } });
    if (!r) throw notFound("That export");
    return { id: r.id, format: r.format, status: r.status, url: r.file_key ? `/v1/exports/${r.id}/download` : null, snapshot_url: r.snapshot_key ? `/v1/exports/${r.id}/snapshot` : null, log: r.log };
  });

  const send = async (key: string, name: string, reply: any, inline = false) => {
    const ext = key.split(".").pop()!;
    return reply.header("content-type", MIME[ext] ?? "application/octet-stream").header("content-disposition", `${inline ? "inline" : "attachment"}; filename="${name}"`).header("cache-control", "private").send(await driver.get(key));
  };
  app.get("/v1/exports/:id/download", { schema: { tags: ["exports"], params: Id }, preHandler: requireRole() }, async (req, reply) => {
    const r = await prisma.export.findFirst({ where: { id: req.params.id, paper_id: req.principal!.paper_id } });
    if (!r?.file_key) throw notFound("That file");
    return send(r.file_key, r.file_name ?? `export.${r.file_key.split(".").pop()}`, reply);
  });
  app.get("/v1/exports/:id/snapshot", { schema: { tags: ["exports"], params: Id }, preHandler: requireRole() }, async (req, reply) => {
    const r = await prisma.export.findFirst({ where: { id: req.params.id, paper_id: req.principal!.paper_id } });
    if (!r?.snapshot_key) throw notFound("That snapshot");
    return send(r.snapshot_key, "layout-snapshot.json", reply, true);
  });
}
