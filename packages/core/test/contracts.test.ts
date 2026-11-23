import { describe, expect, it } from "vitest";
import * as c from "../src/index.js";
import * as ex from "./examples.js";

const ok = (s: { safeParse(v: unknown): { success: boolean } }, v: unknown) => expect(s.safeParse(v).success).toBe(true);
const bad = (s: { safeParse(v: unknown): { success: boolean } }, v: unknown) => expect(s.safeParse(v).success).toBe(false);
const without = (o: Record<string, unknown>, k: string) => { const { [k]: _, ...r } = o; return r; };
const rename = (o: Record<string, unknown>, a: string, b: string) => ({ ...without(o, a), [b]: o[a] });

describe("spec examples parse", () => {
  it("D1 article", () => ok(c.ArticleSchema, ex.article));
  it("D2 raw item, sources, ingest", () => {
    ok(c.RawItemSchema, ex.rawItem);
    ok(c.WordpressSourceSchema, ex.wpSource);
    ok(c.ScrapeSourceSchema, ex.scrapeSource);
    ok(c.SourceRowSchema, ex.wpSource);
    ok(c.SourceRowSchema, { kind: "cxml" });
    ok(c.IngestHeadersSchema, { "x-api-key": "k", "x-signature": "sha256=ab12" });
    const { id, paper_id, source_id, content_hash, rev, ...rest } = ex.article;
    void id; void paper_id; void source_id; void content_hash; void rev;
    ok(c.IngestBodySchema, { ...rest, images: [{ role: "lead", src: "https://site.com/a.jpg" }] });
    ok(c.IngestBodySchema, { raw: { any: 1 } });
  });
  it("D3 pagedoc", () => ok(c.PageDocSchema, ex.pageDoc));
  it("D4 snapshot", () => ok(c.LayoutSnapshotSchema, ex.snapshot));
  it("D5 zones", () => ok(c.ZoneSetSchema, ex.zones));
  it("D5 ad zone with null article", () =>
    ok(c.ZoneSetSchema, { ...ex.zones, zones: [{ ...ex.zones.zones[0], article_id: null }] }));
  it("D6 hooks, embed, token", () => {
    ok(c.EditionPublishedPayloadSchema, ex.webhook);
    ok(c.WebhookHeadersSchema, ex.webhookHeaders);
    ok(c.EmbedAttributesSchema, ex.embed);
    ok(c.SubscriberTokenClaimsSchema, ex.token);
  });
  it("D9 health and services", () => {
    ok(c.HealthzSchema, { ok: true });
    ok(c.ReadyzSchema, { ok: true, checks: { db: "ok", files: "ok" } });
    ok(c.ReadyzSchema, { ok: false, checks: { db: "timeout after 5 s" } });
    ok(c.ServiceListSchema, ex.services);
  });
  it("D10 ops", () => {
    ok(c.OpsStatusSchema, ex.opsStatus);
    ok(c.DbRestoreBodySchema, { to: "2026-11-21T01:58:00+05:30" });
    ok(c.FilesRestoreBodySchema, { scope: "file", at: "2026-11-21T01:58:00+05:30" });
    ok(c.JobsRetryBodySchema, {});
    expect(c.LogsQuerySchema.parse({}).tail).toBe(200);
  });
});

describe("missing or renamed required fields fail", () => {
  it("article", () => {
    bad(c.ArticleSchema, without(ex.article, "headline"));
    bad(c.ArticleSchema, rename(ex.article, "headline", "title"));
    bad(c.ArticleSchema, { ...ex.article, priority: 101 });
    bad(c.ArticleSchema, { ...ex.article, published_at: "2026-04-02T10:15:00" });
  });
  it("pagedoc", () => {
    bad(c.PageDocSchema, without(ex.pageDoc, "items"));
    bad(c.PageDocSchema, rename(ex.pageDoc, "rev", "revision"));
    bad(c.PageDocSchema, { ...ex.pageDoc, items: [{ ...ex.pageDoc.items[0], kind: "poster" }] });
  });
  it("snapshot", () => {
    bad(c.LayoutSnapshotSchema, rename(ex.snapshot, "edition_id", "edition"));
    bad(c.LayoutSnapshotSchema, { ...ex.snapshot, unit: "px" });
  });
  it("zones, hooks, ops", () => {
    bad(c.ZoneSetSchema, without(ex.zones, "zones"));
    bad(c.EditionPublishedPayloadSchema, rename(ex.webhook, "edition", "date"));
    bad(c.OpsStatusSchema, without(ex.opsStatus, "release"));
    bad(c.ServiceEntrySchema, without(ex.services[0]!, "name"));
    bad(c.DbRestoreBodySchema, { to: "2026-11-21T01:58:00" });
  });
});

describe("ids", () => {
  const cases = [
    ["pap", c.PaperId], ["src", c.SourceId], ["art", c.ArticleId], ["ast", c.AssetId],
    ["ed", c.EditionId], ["it", c.ItemId], ["z", c.ZoneId],
  ] as const;
  for (const [p, schema] of cases) {
    it(`${p}_ accepts its own and rejects others`, () => {
      ok(schema, c.newId(p));
      for (const [q] of cases) if (q !== p) bad(schema, c.newId(q));
      bad(schema, "nope");
      bad(schema, `${p}_`);
    });
  }
  it("article rejects a wrong-prefix paper_id", () => bad(c.ArticleSchema, { ...ex.article, paper_id: "src_01JD" }));
  it("newId is unique", () => expect(c.newId("art")).not.toBe(c.newId("art")));
});

describe("geometry", () => {
  const withRect = (r: number[]) => ({ ...ex.zones, zones: [{ ...ex.zones.zones[0], rects: [r] }] });
  it("zone rects outside 0-1 fail", () => {
    bad(c.ZoneSetSchema, withRect([-0.1, 0.1, 0.2, 0.2]));
    bad(c.ZoneSetSchema, withRect([0.1, 0.1, 1.2, 0.2]));
    bad(c.ZoneSetSchema, withRect([0.9, 0.1, 0.2, 0.2]));
    bad(c.ZoneSetSchema, withRect([0.1, 0.1, 0.2]));
    ok(c.ZoneSetSchema, withRect([0, 0, 1, 1]));
  });
  it("confidence outside 0-1 fails", () =>
    bad(c.ZoneSetSchema, { ...ex.zones, zones: [{ ...ex.zones.zones[0], confidence: 1.5 }] }));
  it("crop and focal outside 0-1 fail", () => {
    const f = ex.snapshot.pages[0]!.frames;
    bad(c.LayoutSnapshotSchema, { ...ex.snapshot, pages: [{ ...ex.snapshot.pages[0], frames: [{ ...f[1], crop: [0, 0, 2, 1] }] }] });
    bad(c.PageDocSchema, { ...ex.pageDoc, items: [{ ...ex.pageDoc.items[0], image: { ...ex.pageDoc.items[0]!.image, focal: [1.5, 0.4] } }] });
  });
});

describe("errors", () => {
  it("api error has code, message, details", () => {
    const e = c.apiError("not_found", { what: "edition" });
    ok(c.ApiErrorSchema, e);
    expect(e.message).toMatch(/could not find/);
  });
  it("zod failure becomes plain problems", () => {
    const r = c.ArticleSchema.safeParse({});
    if (r.success) throw new Error("should fail");
    const e = c.fromZodError(r.error);
    expect(e.code).toBe("bad_request");
    expect(Array.isArray((e.details as { problems: unknown[] }).problems)).toBe(true);
  });
});
