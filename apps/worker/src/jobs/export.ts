import { PageDocSchema, type PageDoc } from "@epaper/core";
import { exportScreenPdf, pageDocsToModel, toCXML, type EditionPage } from "@epaper/export";
import { prisma } from "../db.js";
import { articlesForRender, day, edRef, emitWebhook, enqueue, loadArticles, storeFile, type JobCtx } from "../ctx.js";
import { pool } from "../pool.js";
import { templateSet } from "../templates.js";
import type { Envelope } from "../main.js";

const logLine = (msg: string) => ({ at: new Date().toISOString(), msg });

/** Make one export: screen PDF (+ its D4 snapshot) or ContentXML, written once into the files store. Done exports are never redone. */
export async function exportRun(e: Envelope, job: JobCtx) {
  const ex = await prisma.export.findFirst({ where: { id: e.payload.export_id, paper_id: e.paper_id } });
  if (!ex || ex.status === "done") return;
  const log: any[] = [...((ex.log as any[]) ?? [])];
  const save = (status: string, extra: Record<string, unknown> = {}) => prisma.export.update({ where: { id: ex.id }, data: { status, log, ...extra } });
  try {
    log.push(logLine("started"));
    await save("running");
    const ed = await prisma.edition.findUniqueOrThrow({ where: { id: ex.edition_id } });
    const paper = await prisma.paper.findUniqueOrThrow({ where: { id: e.paper_id } });
    const rows = await prisma.page.findMany({ where: { edition_id: ed.id }, orderBy: { no: "asc" } });
    if (!rows.length) throw new Error("This edition has no pages.");
    const templates = templateSet(ed.template_set);
    const docs = rows.map((r) => PageDocSchema.parse(r.doc));
    const pages: EditionPage[] = docs.map((doc, i) => ({ doc, template: templates.find((t) => t.id === doc.page.template) ?? templates.find((t) => t.id === rows[i]!.template_id) ?? templates[0]! }));
    const ids = [...new Set(docs.flatMap((d) => d.items.map((i) => i.article_id).filter(Boolean) as string[]))];
    const articles = await articlesForRender(e.paper_id, await loadArticles(e.paper_id, { ids }));

    if (ex.format === "cxml") {
      const xml = toCXML(pageDocsToModel(docs as PageDoc[], articles));
      const f = await storeFile(e.paper_id, "cxml", "xml", Buffer.from(xml, "utf8"));
      log.push(logLine(`ContentXML written (${f.size} bytes)`));
      await save("done", { file_key: f.key, file_name: `${paper.slug}_${day(ed.date)}.xml`, finished_at: new Date() });
    } else if (ex.format === "pdf_screen") {
      const r = await pool.withBrowser((browser) => exportScreenPdf({ paper: paper.slug, date: day(ed.date), pages, articles, browser }));
      const pdf = await storeFile(e.paper_id, "pdf", "pdf", r.edition.bytes);
      const snap = await pool.withEngine((eng) => eng.snapshot(edRef(ed.id), pages, articles));
      const sf = await storeFile(e.paper_id, "snapshot", "json", Buffer.from(JSON.stringify(snap)));
      log.push(logLine(`PDF written: ${pages.length} pages, ${r.w_mm}x${r.h_mm} mm, ${pdf.size} bytes, ${r.elapsed_ms} ms`));
      await save("done", { file_key: pdf.key, snapshot_key: sf.key, file_name: r.edition.name, finished_at: new Date() });
      if (e.payload.build_epaper !== false) {
        let ep = await prisma.epEdition.findFirst({ where: { paper_id: e.paper_id, export_id: ex.id } });
        if (!ep) ep = await prisma.epEdition.create({ data: { paper_id: e.paper_id, date: ed.date, source: "export", export_id: ex.id, edition_id: ed.id, pdf_key: pdf.key, pdf_hash: pdf.hash, status: "building" } });
        await enqueue("epaper.build", e.paper_id, { ep_edition_id: ep.id }, `build:${ep.id}`);
      }
    } else throw new Error(`The ${ex.format} export is not available.`);
    await emitWebhook(e.paper_id, "export.ready", { event: "export.ready", paper: paper.slug, edition: day(ed.date), format: ex.format, export_id: ex.id });
  } catch (err) {
    log.push(logLine(`failed: ${(err as Error).message}`));
    await save(job.final ? "failed" : "queued", job.final ? { finished_at: new Date() } : {}).catch(() => {});
    throw err;
  }
}
