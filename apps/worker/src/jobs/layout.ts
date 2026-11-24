import { PageDocSchema, type Article, type PageDoc } from "@epaper/core";
import { autoPlan, formatEditionDate, type Template } from "@epaper/layout";
import { prisma } from "../db.js";
import { articlesForRender, edRef, loadArticles, type JobCtx } from "../ctx.js";
import { pool } from "../pool.js";
import { templateSet } from "../templates.js";
import { fetchAsset } from "./assets.js";
import type { Envelope } from "../main.js";

const stripDate = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).toUpperCase();

async function reindex(paper_id: string, page_id: string, doc: PageDoc) {
  const rows = doc.items.filter((i) => i.article_id).map((i) => ({ page_id, paper_id, article_id: i.article_id!, article_rev: i.article_rev ?? 0 }));
  await prisma.$transaction([prisma.pageArticle.deleteMany({ where: { page_id } }), prisma.pageArticle.createMany({ data: rows, skipDuplicates: true })]);
}

const reportOf = (fit: { fill_pct: number; state: string; overflow: boolean; overflow_pct: number; doc: PageDoc; low_res: unknown[] }, rev: number) =>
  ({ fill_pct: fit.fill_pct, state: fit.state, overflow: fit.overflow, overflow_pct: fit.overflow_pct, body_pt: fit.doc.page.body_pt, low_res: fit.low_res, rev });

/** Plan and fit the day's pages, then store each as a PageDoc (D3) with a version and a LayoutSnapshot (D4). Run twice = pages replaced, never doubled; approved pages are left alone. */
export async function editionAutoplan(e: Envelope) {
  const ed = await prisma.edition.findFirst({ where: { id: e.payload.edition_id, paper_id: e.paper_id } });
  if (!ed) return;
  try {
    const templates = templateSet(ed.template_set);
    // the masthead is the paper's own name (papers.name), not the demo name written in the template
    const paper = await prisma.paper.findUniqueOrThrow({ where: { id: e.paper_id } });
    let articles = await loadArticles(e.paper_id, { ids: e.payload.article_ids, date: e.payload.date });
    if (!articles.length) throw new Error("There are no articles to plan. Sync a source first.");
    // make sure the pictures are in the store before laying out (idempotent)
    for (const a of articles) for (const im of a.images) await fetchAsset(e.paper_id, { article_id: a.id, asset_id: im.asset_id, src: im.src, caption: im.caption, credit: im.credit }).catch((err) => console.log("picture skipped:", (err as Error).message));
    const renderArticles = await articlesForRender(e.paper_id, articles);
    const plan = await pool.withEngine((eng) => autoPlan(eng, renderArticles, templates, { pages: e.payload.pages, masthead: paper.name, date: formatEditionDate(ed.date, templates[0]!) ?? stripDate(ed.date), sectionPages: e.payload.sections ?? templates[0]!.section_order }));
    for (const pp of plan.pages) {
      const doc = PageDocSchema.parse(pp.fit.doc);
      const snap = await pool.withEngine((eng) => eng.snapshot(edRef(ed.id), [{ doc, template: pp.template }], renderArticles));
      const existing = await prisma.page.findUnique({ where: { edition_id_no: { edition_id: ed.id, no: doc.page.no } } });
      if (existing?.status === "approved") continue;
      const rev = (existing?.rev ?? 0) + 1;
      const full = { ...doc, rev };
      const report = reportOf(pp.fit, rev);
      const data = { template_id: pp.template.id, doc: full as any, rev, fit_pct: pp.fit.fill_pct, fit_report: report as any, fit_rev: rev, snapshot: snap as any, status: "draft" };
      const page = existing
        ? await prisma.page.update({ where: { id: existing.id }, data: { ...data, locked_by: null, lock_expires_at: null } })
        : await prisma.page.create({ data: { paper_id: e.paper_id, edition_id: ed.id, no: doc.page.no, ...data } });
      await prisma.pageVersion.upsert({
        where: { page_id_rev: { page_id: page.id, rev } },
        create: { paper_id: e.paper_id, page_id: page.id, rev, doc: full as any, snapshot: snap as any, fit_pct: pp.fit.fill_pct, source: "autoplan", user_id: null },
        update: {},
      });
      await reindex(e.paper_id, page.id, full);
    }
    await prisma.edition.update({ where: { id: ed.id }, data: { status: "planned", plan: { unplaced: plan.unplaced, elapsed_ms: plan.elapsed_ms, pages: plan.pages.length } as any } });
  } catch (err) {
    await prisma.edition.update({ where: { id: ed.id }, data: { status: "draft", plan: { error: (err as Error).message } as any } }).catch(() => {});
    throw err;
  }
}

/** Measure and fit one page in Chromium, store the fit report and a snapshot for that version. If the fitted text size differs, it is saved as the next version by "system" (unless someone saved meanwhile). */
export async function pageFit(e: Envelope) {
  const page = await prisma.page.findFirst({ where: { id: e.payload.page_id, paper_id: e.paper_id }, include: { edition: true } });
  if (!page) return;
  const doc0 = PageDocSchema.parse(page.doc);
  const templates = templateSet(page.edition.template_set);
  const tpl: Template = templates.find((t) => t.id === doc0.page.template) ?? templates.find((t) => t.id === page.template_id) ?? templates[0]!;
  const ids = doc0.items.map((i) => i.article_id).filter(Boolean) as string[];
  const articles = await articlesForRender(e.paper_id, await loadArticles(e.paper_id, { ids }));
  const jobRev = page.rev;
  const fit = await pool.withEngine((eng) => eng.fit(doc0, tpl, articles, { imageSqueeze: 0 }));
  const approved = page.status === "approved";
  const changed = !approved && Math.abs(fit.doc.page.body_pt - doc0.page.body_pt) > 0.01;
  let doc = doc0, rev = jobRev;
  if (changed) {
    const newRev = jobRev + 1;
    doc = { ...fit.doc, rev: newRev };
    const cas = await prisma.page.updateMany({ where: { id: page.id, rev: jobRev }, data: { doc: doc as any, rev: newRev } });
    if (cas.count === 1) {
      rev = newRev;
      await prisma.pageVersion.create({ data: { paper_id: e.paper_id, page_id: page.id, rev: newRev, doc: doc as any, source: "fit", user_id: null, fit_pct: fit.fill_pct } });
    } else doc = doc0; // someone saved meanwhile; their save queued its own fit
  }
  const snap = await pool.withEngine((eng) => eng.snapshot(edRef(page.edition_id), [{ doc, template: tpl }], articles));
  const report = reportOf(fit, rev);
  await prisma.pageVersion.updateMany({ where: { page_id: page.id, rev }, data: { snapshot: snap as any, fit_pct: fit.fill_pct } });
  // only move fit info forward
  await prisma.page.updateMany({ where: { id: page.id, fit_rev: { lte: rev } }, data: { fit_pct: fit.fill_pct, fit_report: report as any, fit_rev: rev, ...(rev === jobRev || rev === page.rev + 1 ? { snapshot: snap as any } : {}) } });
}
