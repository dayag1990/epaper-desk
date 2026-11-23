import { ArticleSchema, fromZodError, newId, type Article, type Mapping, type RawItem } from "@epaper/core";
import type { Adapter, ArticleDraft, IngestContext } from "./types.js";
import { RejectError } from "./types.js";
import { detectScript, nfc, sha256, stableAssetId } from "./util.js";
import { plainError } from "./fetcher.js";
import type { Partial1 } from "./expr.js";

const isoNow = (ctx: IngestContext) => (ctx.now?.() ?? new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");

function deepNfc<T>(v: T): T {
  if (typeof v === "string") return nfc(v) as unknown as T;
  if (Array.isArray(v)) return v.map(deepNfc) as unknown as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepNfc(x)])) as T;
  return v;
}

/** Fill the gaps of a mapped partial result with safe defaults, so it can become an Article. */
export function completeDraft(p: Partial1, opts: { url?: string; ctx: IngestContext; fetchedAt?: string; section?: string }): ArticleDraft {
  const url = (p.url as string | undefined) ?? opts.url;
  const body = (p.body as ArticleDraft["body"] | undefined) ?? [];
  const headline = (p.headline as string | undefined) ?? "";
  const ext = (p.external_id as string | undefined) ?? url;
  const reasons: string[] = [];
  if (!headline) reasons.push("No headline found. Check the headline rule in the mapping.");
  if (!body.length) reasons.push("No article text found. Check the body rule in the mapping.");
  if (!url) reasons.push("No web address found for this article.");
  if (!ext) reasons.push("No stable id found for this article.");
  if (reasons.length) throw new RejectError(reasons[0], reasons);
  const sample = headline + " " + body.map((b) => b.text).join(" ");
  const det = detectScript(sample);
  const fallbackNow = opts.fetchedAt ?? isoNow(opts.ctx);
  const published = (p.published_at as string | undefined) ?? (p.updated_at as string | undefined) ?? fallbackNow;
  return {
    external_id: ext!,
    url: url!,
    lang: p.lang ? String(p.lang).split(/[-_]/)[0].toLowerCase() : det.lang,
    script: (p.script as string | undefined) ?? det.script,
    section: (p.section as string | undefined) ?? opts.section ?? "news",
    tags: (p.tags as string[] | undefined) ?? [],
    priority: (p.priority as number | undefined) ?? 50,
    kicker: (p.kicker as string | undefined) ?? null,
    headline,
    subhead: (p.subhead as string | undefined) ?? null,
    byline: (p.byline as string | undefined) ?? null,
    dateline: (p.dateline as string | undefined) ?? null,
    body,
    images: (p.images ?? []).filter((i) => i.src).map((i) => ({
      asset_id: stableAssetId(i.src!),
      role: i.role ?? "lead",
      src: i.src!,
      caption: i.caption ?? null,
      credit: i.credit ?? null,
    })),
    published_at: published,
    updated_at: (p.updated_at as string | undefined) ?? published,
  };
}

/** The hash covers what a reader sees. Dates, ids and rev are left out so a re-fetch of an unchanged story hashes the same. */
export function contentHash(d: ArticleDraft): string {
  const canon = deepNfc({
    url: d.url, lang: d.lang, script: d.script ?? null, section: d.section, tags: d.tags, priority: d.priority,
    kicker: d.kicker ?? null, headline: d.headline, subhead: d.subhead ?? null, byline: d.byline ?? null,
    dateline: d.dateline ?? null, body: d.body,
    images: d.images.map((i) => ({ role: i.role, src: i.src, caption: i.caption ?? null, credit: i.credit ?? null })),
    layout_hint: d.layout_hint ?? null,
  });
  return "sha256:" + sha256(JSON.stringify(canon));
}

export interface ArticleStore {
  get(paperId: string, sourceId: string, externalId: string): Promise<Article | undefined>;
  put(article: Article): Promise<void>;
}

export class MemoryArticleStore implements ArticleStore {
  readonly rows = new Map<string, Article>();
  private k = (p: string, s: string, e: string) => `${p}\u0000${s}\u0000${e}`;
  async get(p: string, s: string, e: string) { return this.rows.get(this.k(p, s, e)); }
  async put(a: Article) { this.rows.set(this.k(a.paper_id, a.source_id, a.external_id), a); }
  all(): Article[] { return [...this.rows.values()]; }
}

export type IngestAction = "created" | "updated" | "unchanged";
export interface IngestEvent { type: "article.created" | "article.updated"; article: Article; previousRev?: number }

/** Upsert one draft. Key is (paper_id, source_id, external_id); content_hash decides if it changed. Nothing is written if it is unchanged or invalid. */
export async function upsertDraft(draft: ArticleDraft, ctx: IngestContext, store: ArticleStore): Promise<{ action: IngestAction; article: Article; event?: IngestEvent }> {
  const clean = deepNfc(draft);
  const hash = contentHash(clean);
  const existing = await store.get(ctx.paperId, ctx.sourceId, clean.external_id);
  if (existing && existing.content_hash === hash) return { action: "unchanged", article: existing };
  const candidate = {
    ...clean,
    id: existing?.id ?? newId("art"),
    paper_id: ctx.paperId,
    source_id: ctx.sourceId,
    content_hash: hash,
    rev: existing ? existing.rev + 1 : 1,
    // the first publish time stays; a later edit moves updated_at only
    published_at: existing ? existing.published_at : clean.published_at,
  };
  if (existing && candidate.updated_at === existing.updated_at) candidate.updated_at = isoNow(ctx);
  const parsed = ArticleSchema.safeParse(candidate);
  if (!parsed.success) {
    const problems = fromZodError(parsed.error).details.problems as { field: string; problem: string }[];
    throw new RejectError("This article is not valid: " + problems.map((p) => `${p.field}: ${p.problem}`).join("; "), problems.map((p) => `${p.field}: ${p.problem}`));
  }
  await store.put(parsed.data);
  return {
    action: existing ? "updated" : "created",
    article: parsed.data,
    event: { type: existing ? "article.updated" : "article.created", article: parsed.data, previousRev: existing?.rev },
  };
}

export interface SyncReport {
  created: number; updated: number; unchanged: number; skipped: number;
  rejected: { ref: unknown; reasons: string[] }[];
  events: IngestEvent[];
  articles: Article[];
}

export interface SyncOptions { since?: Date; limit?: number }

/** discover -> fetch -> normalize -> validate -> upsert. A bad item is rejected with reasons; the rest carry on. */
export async function syncSource<C>(adapter: Adapter<C>, cfgIn: unknown, mapping: Mapping | undefined, ctx: IngestContext, store: ArticleStore, opts: SyncOptions = {}): Promise<SyncReport> {
  const cfgRes = adapter.configSchema.safeParse(cfgIn);
  if (!cfgRes.success) {
    const problems = fromZodError(cfgRes.error as never).details.problems as { field: string; problem: string }[];
    throw new RejectError("The source settings are not right: " + problems.map((p) => `${p.field}: ${p.problem}`).join("; "));
  }
  const cfg = cfgRes.data;
  const rep: SyncReport = { created: 0, updated: 0, unchanged: 0, skipped: 0, rejected: [], events: [], articles: [] };
  let n = 0;
  for await (const ref of adapter.discover(cfg, opts.since ?? new Date(0))) {
    if (opts.limit && n >= opts.limit) break;
    n++;
    try {
      const raw: RawItem = await adapter.fetch(cfg, ref);
      const draft = adapter.normalize(raw, mapping ?? adapter.defaultMapping, ctx);
      if (!draft) { rep.skipped++; continue; }
      const r = await upsertDraft(draft, ctx, store);
      rep[r.action]++;
      rep.articles.push(r.article);
      if (r.event) rep.events.push(r.event);
    } catch (e) {
      rep.rejected.push({ ref, reasons: e instanceof RejectError ? e.reasons : [plainError(e)] });
    }
  }
  return rep;
}

/** Dry run for the wizard's TEST button: parse up to 5 items, write nothing, return every error. */
export async function testSource<C>(adapter: Adapter<C>, cfgIn: unknown, mapping: Mapping | undefined, ctx: IngestContext, limit = 5) {
  const scratch = new MemoryArticleStore();
  const rep = await syncSource(adapter, cfgIn, mapping, ctx, scratch, { limit });
  return { articles: rep.articles, errors: rep.rejected, skipped: rep.skipped };
}

