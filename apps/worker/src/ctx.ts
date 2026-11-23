import { createHash, randomUUID } from "node:crypto";
import type PgBoss from "pg-boss";
import type { Article } from "@epaper/core";
import { prisma } from "./db.js";
import { makeDriver, FileExistsError, fileKey, sha256 } from "./files.js";

export const filesRoot = () => process.env.FILES_ROOT ?? "/files";
export const driver = makeDriver(process.env.FILES_DRIVER ?? "fs", filesRoot());

export const TYPE_QUEUE: Record<string, string> = {
  "source.sync": "ingest", "asset.fetch": "assets", "edition.autoplan": "layout", "page.fit": "layout",
  "export.run": "export", "epaper.build": "epaper", "epaper.replace_page": "epaper", "epaper.publish": "epaper", "webhook.deliver": "epaper",
};

export interface JobCtx {
  /** True when a failure now means the job goes to the dead-letter queue. */
  final: boolean;
}
let bossRef: PgBoss | undefined;
export const setBoss = (b: PgBoss) => (bossRef = b);

export async function enqueue(type: string, paper_id: string, payload: Record<string, unknown>, idem?: string, delay_s?: number) {
  const key = idem ?? randomUUID();
  const retry = { retryLimit: 3, retryDelay: Number(process.env.JOB_RETRY_DELAY_S ?? 2), retryBackoff: true };
  return bossRef!.send(TYPE_QUEUE[type]!, { type, paper_id, payload, idempotency_key: key }, { ...retry, singletonKey: `${paper_id}:${type}:${key}`, ...(delay_s ? { startAfter: delay_s } : {}) });
}

export async function storeFile(paper_id: string, kind: string, ext: string, data: Buffer, date = new Date().toISOString().slice(0, 10)) {
  const hash = sha256(data);
  const dup = await prisma.file.findFirst({ where: { paper_id, hash, kind, ext, deleted_at: null } });
  if (dup) return { key: dup.key, hash, size: dup.size };
  const key = fileKey({ paper: paper_id, date, kind, hash, ext });
  try { await driver.put(key, data); } catch (e) { if (!(e instanceof FileExistsError)) throw e; }
  await prisma.file.upsert({ where: { key }, create: { paper_id, hash, kind, ext, size: data.length, key }, update: { deleted_at: null } });
  return { key, hash, size: data.length };
}

export async function emitWebhook(paper_id: string, event: string, payload: Record<string, unknown>) {
  const hooks = await prisma.webhook.findMany({ where: { paper_id, active: true, deleted_at: null } });
  for (const h of hooks) {
    if (!(h.events as string[]).includes(event)) continue;
    const d = await prisma.webhookDelivery.create({ data: { paper_id, webhook_id: h.id, event, payload: payload as any } });
    await enqueue("webhook.deliver", paper_id, { delivery_id: d.id }, `wh:${d.id}`);
  }
}

export const paperRef = (id: string) => `pap_${id}`;
export const sourceRef = (id: string) => `src_${id}`;
export const stripRef = (s: string) => s.replace(/^(pap|src)_/, "");
export const day = (d: Date) => d.toISOString().slice(0, 10);
export const edRef = (id: string) => `ed_${id}`;
export const hashStr = (s: string) => createHash("sha256").update(s).digest("hex");

/** D1 articles of a paper, from the database. */
export async function loadArticles(paper_id: string, opts: { ids?: string[]; date?: string } = {}): Promise<Article[]> {
  const where: any = { paper_id, deleted_at: null, ...(opts.ids ? { id: { in: opts.ids } } : {}) };
  if (opts.date) {
    const d0 = new Date(opts.date + "T00:00:00Z");
    const d1 = new Date(d0.getTime() + 86400_000);
    where.OR = [{ published_at: { gte: d0, lt: d1 } }, { created_at: { gte: d0, lt: d1 } }];
  }
  const rows = await prisma.article.findMany({ where, orderBy: [{ published_at: "desc" }, { id: "asc" }] });
  return rows.map((r) => r.data as unknown as Article);
}

/** For rendering: pictures we already hold are inlined, so a render never depends on the website being up. */
export async function articlesForRender(paper_id: string, articles: Article[]): Promise<Article[]> {
  const ids = [...new Set(articles.flatMap((a) => a.images.map((i) => i.asset_id)))];
  const rows = await prisma.asset.findMany({ where: { paper_id, asset_id: { in: ids }, status: "ready", orig_key: { not: null } } });
  const uri = new Map<string, string>();
  for (const r of rows) {
    try {
      const ext = r.orig_key!.split(".").pop();
      const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      uri.set(r.asset_id, `data:${mime};base64,${(await driver.get(r.orig_key!)).toString("base64")}`);
    } catch { /* keep the website address */ }
  }
  return articles.map((a) => ({ ...a, images: a.images.map((i) => (uri.has(i.asset_id) ? { ...i, src: uri.get(i.asset_id)! } : i)) }));
}
