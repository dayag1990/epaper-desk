import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import * as cheerio from "cheerio";
import { ArticleIngestSchema, IngestBodySchema, fromZodError, type Mapping, type RawItem } from "@epaper/core";
import type { Adapter, ArticleDraft, IngestContext } from "./types.js";
import { RejectError } from "./types.js";
import { applyMapping } from "./expr.js";
import { completeDraft, upsertDraft, type ArticleStore } from "./ingest.js";
import { HTML_DEFAULT_MAPPING } from "./html.js";
import { stableAssetId } from "./util.js";

export const PushConfigSchema = z.object({ secret: z.string().optional() });
export type PushConfig = z.infer<typeof PushConfigSchema>;

export function signBody(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

export function verifySignature(body: string, secret: string, header: string | undefined): boolean {
  if (!header) return false;
  const want = Buffer.from(signBody(body, secret));
  const got = Buffer.from(header);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Check an incoming body against the core ingest schema. Plain-word reasons on failure. */
export function validatePushBody(body: unknown): { ok: true; value: z.infer<typeof IngestBodySchema> } | { ok: false; reasons: string[] } {
  const r = IngestBodySchema.safeParse(body);
  if (r.success) return { ok: true, value: r.data };
  // report against the article shape: it is what people mean to send
  const art = ArticleIngestSchema.safeParse(body);
  const err = art.success ? r.error : art.error;
  const problems = fromZodError(err).details.problems as { field: string; problem: string }[];
  return { ok: false, reasons: problems.map((p) => `${p.field}: ${p.problem}`) };
}

function ingestToDraft(a: z.infer<typeof ArticleIngestSchema>): ArticleDraft {
  return {
    ...a,
    tags: a.tags ?? [],
    images: (a.images ?? []).map((i) => ({ ...i, asset_id: stableAssetId(i.src) })),
  } as ArticleDraft;
}

export interface PushInput {
  body: string | unknown;
  /** value of the X-Signature header */
  signature?: string;
  /** mapping to run when the body is {"raw": ...} */
  mapping?: Mapping;
}

/** The push door: verify, validate, map (if raw), upsert. Returns what happened, or why not. */
export async function acceptPush(input: PushInput, cfg: PushConfig, ctx: IngestContext, store: ArticleStore) {
  const text = typeof input.body === "string" ? input.body : JSON.stringify(input.body);
  if (cfg.secret && !verifySignature(text, cfg.secret, input.signature))
    return { ok: false as const, status: 401, reasons: ["The signature does not match the body. Check the shared secret."] };
  let parsed: unknown;
  try {
    parsed = typeof input.body === "string" ? JSON.parse(input.body) : input.body;
  } catch {
    return { ok: false as const, status: 400, reasons: ["The body is not valid JSON."] };
  }
  const v = validatePushBody(parsed);
  if (!v.ok) return { ok: false as const, status: 400, reasons: v.reasons };
  try {
    let draft: ArticleDraft;
    if ("raw" in v.value && !("headline" in (v.value as object))) {
      const raw = (v.value as { raw: unknown }).raw;
      const mapping = input.mapping ?? (typeof raw === "string" ? HTML_DEFAULT_MAPPING : undefined);
      if (!mapping) throw new RejectError("This source has no mapping for raw bodies. Add one, or send a finished article.");
      const p = typeof raw === "string" ? applyMapping(mapping, { $: cheerio.load(raw) }, { maps: ctx.maps }) : applyMapping(mapping, { json: raw }, { maps: ctx.maps });
      draft = completeDraft(p, { ctx });
    } else {
      draft = ingestToDraft(v.value as z.infer<typeof ArticleIngestSchema>);
    }
    const r = await upsertDraft(draft, ctx, store);
    return { ok: true as const, status: r.action === "created" ? 201 : 200, action: r.action, article: r.article, event: r.event };
  } catch (e) {
    return { ok: false as const, status: 422, reasons: e instanceof RejectError ? e.reasons : [(e as Error).message] };
  }
}

/** As a Connector the push door lists nothing: items arrive by POST, not by polling. */
export const pushConnector: Adapter<PushConfig> = {
  kind: "push",
  configSchema: PushConfigSchema as unknown as z.ZodType<PushConfig>,
  async *discover() { /* push only */ },
  async fetch(): Promise<RawItem> { throw new RejectError("The push door has nothing to fetch. Send articles to /v1/ingest/articles."); },
  normalize(raw: RawItem): ArticleDraft | null {
    const v = ArticleIngestSchema.safeParse(raw.data);
    if (!v.success) throw new RejectError("Not a valid article", (fromZodError(v.error).details.problems as any[]).map((p) => `${p.field}: ${p.problem}`));
    return ingestToDraft(v.data);
  },
};
