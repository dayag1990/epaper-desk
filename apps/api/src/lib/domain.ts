import type { Article } from "@epaper/core";
import { prisma } from "../db.js";
import type { ArticleStore } from "@epaper/connectors";

export const paperRef = (id: string) => `pap_${id}`;
export const sourceRef = (id: string) => `src_${id}`;
export const stripRef = (s: string) => s.replace(/^(pap|src)_/, "");

/** Articles live in Postgres; the whole D1 JSON is in `data`, the columns are what we filter on. */
export class DbArticleStore implements ArticleStore {
  async get(paperRefId: string, sourceRefId: string, externalId: string) {
    const row = await prisma.article.findFirst({
      where: { paper_id: stripRef(paperRefId), source_id: stripRef(sourceRefId), external_id: externalId },
    });
    return row ? (row.data as unknown as Article) : undefined;
  }
  async put(a: Article) {
    const paper_id = stripRef(a.paper_id), source_id = stripRef(a.source_id);
    const cols = {
      url: a.url, lang: a.lang, section: a.section, priority: a.priority, headline: a.headline,
      content_hash: a.content_hash, rev: a.rev, data: a as any, published_at: new Date(a.published_at), deleted_at: null,
    };
    await prisma.article.upsert({
      where: { paper_id_source_id_external_id: { paper_id, source_id, external_id: a.external_id } },
      create: { id: a.id, paper_id, source_id, external_id: a.external_id, ...cols },
      update: cols,
    });
  }
}
