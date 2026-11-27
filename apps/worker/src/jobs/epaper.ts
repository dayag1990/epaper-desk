import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildEdition, type EditionResult } from "@epaper/epaper";
import { LayoutSnapshotSchema, PageDocSchema, type Zone } from "@epaper/core";
import { prisma } from "../db.js";
import { publishEvent } from "../events.js";
import { day, driver, emitWebhook, loadArticles, storeFile, type JobCtx } from "../ctx.js";
import type { Envelope } from "../main.js";


async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "epaper-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

/** One built page -> files store (write-once) + a row (version v) + its zones. */
async function savePage(paper_id: string, ep_edition_id: string, no: number, version: number, corrected: boolean, p: EditionResult["pages"][number], src_hash: string | null = null) {
  const files = p.files;
  const img_keys: Record<string, string> = {};
  for (const name of Object.keys(files)) {
    const m = /^w(\d+)\.(webp|jpeg|jpg)$/.exec(name);
    if (m) img_keys[m[1]!] = (await storeFile(paper_id, "eimg", m[2] === "jpeg" ? "jpg" : m[2]!, await readFile(path.join(p.dir, name)))).key;
  }
  const pdf = await storeFile(paper_id, "epage", "pdf", await readFile(path.join(p.dir, "page.pdf")));
  const textJson = JSON.parse(await readFile(path.join(p.dir, "text.json"), "utf8")) as { lines: { text: string }[] };
  const text = textJson.lines.map((l) => l.text).join("\n");
  const row = await prisma.epPage.create({
    data: { paper_id, ep_edition_id, no, version, corrected, pdf_key: pdf.key, img_keys, img_w: p.zones.image.w, img_h: p.zones.image.h, text, zoned_by: p.zonedBy, src_hash },
  });
  await prisma.epZone.createMany({ data: p.zones.zones.map((z: Zone) => ({ paper_id, ep_page_id: row.id, zone_id: z.id, article_id: z.article_id, rects: z.rects, title: z.title, url: z.url, confidence: z.confidence, source: z.source })) });
}

/** Build the tappable edition from a final PDF: page images at three sizes, text, and tap zones. Re-running replaces the half-built rows, never doubles them. */
export async function epaperBuild(e: Envelope, job: JobCtx) {
  const ep = await prisma.epEdition.findFirst({ where: { id: e.payload.ep_edition_id, paper_id: e.paper_id } });
  if (!ep || !ep.pdf_key || ["ready", "published", "scheduled"].includes(ep.status)) return;
  try {
    const articles = await loadArticles(e.paper_id);
    let snapshot: ReturnType<typeof LayoutSnapshotSchema.parse> | undefined;
    let itemArticles: Record<string, string> | undefined;
    if (ep.export_id) {
      const ex = await prisma.export.findUnique({ where: { id: ep.export_id } });
      if (ex?.snapshot_key) snapshot = LayoutSnapshotSchema.parse(JSON.parse((await driver.get(ex.snapshot_key)).toString("utf8")));
      if (ep.edition_id) {
        itemArticles = {};
        for (const pg of await prisma.page.findMany({ where: { edition_id: ep.edition_id, deleted_at: null } }))
          for (const it of PageDocSchema.parse(pg.doc).items) if (it.article_id) itemArticles[it.id] = it.article_id;
      }
    }
    const res = await withTmp(async (dir) => {
      const pdfPath = path.join(dir, "in.pdf");
      await writeFile(pdfPath, await driver.get(ep.pdf_key!));
      const r = await buildEdition(pdfPath, { outDir: path.join(dir, "out"), articles: articles.map((a) => ({ id: a.id, headline: a.headline, url: a.url })), snapshot, itemArticles, concurrency: 4, version: 1 });
      await prisma.$transaction([
        prisma.epZone.deleteMany({ where: { page: { ep_edition_id: ep.id } } }),
        prisma.epPage.deleteMany({ where: { ep_edition_id: ep.id } }),
      ]);
      for (const p of r.pages) await savePage(e.paper_id, ep.id, p.page, 1, false, p);
      return r;
    });
    await prisma.epEdition.update({ where: { id: ep.id }, data: { status: "ready", error: null, pdf_hash: res.sha256, misses: res.misses as any } });
    await publishEvent({ type: "edition.exported", paper_id: ep.paper_id, export_id: ep.export_id ?? ep.id, edition_id: ep.edition_id ?? null, format: "epaper", status: "done" });
  } catch (err) {
    await prisma.epEdition.update({ where: { id: ep.id }, data: { status: job.final ? "failed" : "building", error: (err as Error).message } }).catch(() => {});
    throw err;
  }
}

/** Run 3: one corrected page. Only that page is rebuilt: version + 1, marked corrected. */
export async function epaperReplacePage(e: Envelope) {
  const { ep_edition_id, no, pdf_key } = e.payload;
  const ep = await prisma.epEdition.findFirst({ where: { id: ep_edition_id, paper_id: e.paper_id } });
  if (!ep) return;
  const srcHash = pdf_key.split("/").pop()!.split(".")[0]!;
  if (await prisma.epPage.findFirst({ where: { ep_edition_id: ep.id, no, src_hash: srcHash, rolled_back: false } })) return; // this very file was already applied
  const last = await prisma.epPage.findFirst({ where: { ep_edition_id: ep.id, no }, orderBy: { version: "desc" } });
  const articles = await loadArticles(e.paper_id);
  await withTmp(async (dir) => {
    const pdfPath = path.join(dir, "in.pdf");
    await writeFile(pdfPath, await driver.get(pdf_key));
    const r = await buildEdition(pdfPath, { outDir: path.join(dir, "out"), articles: articles.map((a) => ({ id: a.id, headline: a.headline, url: a.url })), concurrency: 1, version: (last?.version ?? 0) + 1 });
    if (r.pageCount !== 1) throw new Error("The replacement must be a one-page PDF.");
    await savePage(e.paper_id, ep.id, no, (last?.version ?? 0) + 1, true, r.pages[0]!, srcHash);
  });
  await prisma.epEdition.update({ where: { id: ep.id }, data: { version: { increment: 1 } } });
  if (ep.status === "published") await publishEvent({ type: "edition.updated", paper_id: e.paper_id, ep_edition_id: ep.id, edition_id: ep.edition_id ?? null, date: day(ep.date), version: ep.version + 1 });
  if (ep.status === "published") {
    const paper = await prisma.paper.findUniqueOrThrow({ where: { id: e.paper_id } });
    await emitWebhook(e.paper_id, "page.replaced", { event: "page.replaced", paper: paper.slug, edition: day(ep.date), page: no, url: `${process.env.PUBLIC_BASE_URL ?? "http://127.0.0.1:8100"}/v1/public/editions/${ep.id}/pages` });
  }
}

/** A scheduled publish comes due. */
export async function epaperPublish(e: Envelope) {
  const ep = await prisma.epEdition.findFirst({ where: { id: e.payload.ep_edition_id, paper_id: e.paper_id } });
  if (!ep || ep.status !== "scheduled") return;
  await prisma.epEdition.update({ where: { id: ep.id }, data: { status: "published", published_at: new Date() } });
  await publishEvent({ type: "edition.published", paper_id: e.paper_id, ep_edition_id: ep.id, edition_id: ep.edition_id ?? null, date: day(ep.date), version: ep.version });
  const paper = await prisma.paper.findUniqueOrThrow({ where: { id: e.paper_id } });
  const n = await prisma.epPage.count({ where: { ep_edition_id: ep.id, rolled_back: false } });
  await emitWebhook(e.paper_id, "edition.published", { event: "edition.published", paper: paper.slug, edition: day(ep.date), pages: n, url: `${(e.payload.base as string) ?? ""}/v1/public/editions/${ep.id}/pages` });
}

/** Send one webhook, signed. Failures retry with backoff; after the last try it is marked failed and the job goes to the dead letters. */
export async function webhookDeliver(e: Envelope, job: JobCtx) {
  const d = await prisma.webhookDelivery.findFirst({ where: { id: e.payload.delivery_id, paper_id: e.paper_id } });
  if (!d || d.status === "delivered") return;
  const h = await prisma.webhook.findUnique({ where: { id: d.webhook_id } });
  if (!h || h.deleted_at || !h.active) return;
  const body = JSON.stringify(d.payload);
  const sig = "sha256=" + createHmac("sha256", h.secret).update(body).digest("hex");
  try {
    const res = await fetch(h.url, { method: "POST", headers: { "content-type": "application/json", "x-epaper-signature": sig, "x-epaper-delivery": d.id, "user-agent": "EPaperDesk/0.1" }, body, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`The receiver answered with error ${res.status}.`);
    await prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: "delivered", attempts: { increment: 1 }, delivered_at: new Date(), last_error: null } });
  } catch (err) {
    await prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: job.final ? "failed" : "pending", attempts: { increment: 1 }, last_error: (err as Error).message } });
    throw err;
  }
}
