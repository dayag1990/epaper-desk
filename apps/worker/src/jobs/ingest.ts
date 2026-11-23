import { createHtmlConnector, createRssConnector, createWordpressConnector, cxmlConnector, pushConnector, PoliteFetcher, syncSource, plainError, type Adapter, type ArticleStore } from "@epaper/connectors";
import type { Article } from "@epaper/core";
import { prisma } from "../db.js";
import { enqueue, paperRef, sourceRef, stripRef, type JobCtx } from "../ctx.js";
import type { Envelope } from "../main.js";

export function adapterFor(kind: string): Adapter<any> | null {
  const f = new PoliteFetcher();
  switch (kind) {
    case "rss": return createRssConnector(f);
    case "wordpress": return createWordpressConnector(f);
    case "scrape": case "html": return createHtmlConnector(f);
    case "cxml": return cxmlConnector as Adapter<any>;
    case "push": return pushConnector;
    default: return null;
  }
}

class DbArticleStore implements ArticleStore {
  async get(p: string, s: string, ext: string) {
    const r = await prisma.article.findFirst({ where: { paper_id: stripRef(p), source_id: stripRef(s), external_id: ext } });
    return r ? (r.data as unknown as Article) : undefined;
  }
  async put(a: Article) {
    const paper_id = stripRef(a.paper_id), source_id = stripRef(a.source_id);
    const cols = { url: a.url, lang: a.lang, section: a.section, priority: a.priority, headline: a.headline, content_hash: a.content_hash, rev: a.rev, data: a as any, published_at: new Date(a.published_at) };
    await prisma.article.upsert({
      where: { paper_id_source_id_external_id: { paper_id, source_id, external_id: a.external_id } },
      create: { id: a.id, paper_id, source_id, external_id: a.external_id, ...cols, deleted_at: null },
      update: cols, // keeps deleted_at: a story an editor hid stays hidden when its source changes
    });
  }
}

/** Pull one source now. Safe to run twice: articles are upserted by (paper, source, external id) and the content hash decides if anything changed. */
export async function sourceSync(e: Envelope, job: JobCtx) {
  const src = await prisma.source.findFirst({ where: { id: e.payload.source_id, paper_id: e.paper_id, deleted_at: null } });
  if (!src) return;
  const adapter = adapterFor(src.kind);
  try {
    if (!adapter) throw new Error(`We do not know a source kind called "${src.kind}".`);
    const r = await syncSource(adapter, src.config, (src.mapping as any) ?? undefined, { paperId: paperRef(e.paper_id), sourceId: sourceRef(src.id) }, new DbArticleStore());
    for (const a of r.events.map((x) => x.article))
      for (const im of a.images)
        await enqueue("asset.fetch", e.paper_id, { article_id: a.id, asset_id: im.asset_id, src: im.src, caption: im.caption ?? null, credit: im.credit ?? null }, `asset:${im.asset_id}`);
    await prisma.source.update({ where: { id: src.id }, data: { status: `ok: ${r.created} new, ${r.updated} changed, ${r.unchanged} same${r.rejected.length ? `, ${r.rejected.length} rejected` : ""}`, last_sync_at: new Date() } });
    if (r.rejected.length) console.log(`source ${src.id}: rejected`, JSON.stringify(r.rejected.slice(0, 3)));
  } catch (err) {
    if (job.final) await prisma.source.update({ where: { id: src.id }, data: { status: `error: ${plainError(err)}` } }).catch(() => {});
    throw err;
  }
}
