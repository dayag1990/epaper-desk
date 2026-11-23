import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { makeFake, type Fake } from "./fake-prisma.js";

const h = vi.hoisted(() => ({ db: undefined as any, jobs: [] as any[] }));
vi.mock("../src/db.js", () => ({ prisma: new Proxy({}, { get: (_t, k) => h.db[k as string] }) }));
vi.mock("../src/lib/enqueue.js", () => ({ enqueue: async (type: string, paper: string, payload: any) => (h.jobs.push({ type, paper, payload }), { id: "j1", queue: "q" }), emitWebhook: async () => {} }));

import { adminRoutes } from "../src/routes/admin-index.js";
import { hashToken } from "../src/auth.js";
import { ApiError } from "../src/errors.js";

let db: Fake;
const ids = { A: "aaaaaaaa-0000-4000-8000-000000000001", B: "bbbbbbbb-0000-4000-8000-000000000002" };
const tok = (n: string) => `tok-${n}`;
const as = (n: string) => ({ cookie: `epaper_session=${tok(n)}` });

async function user(n: string, paper: "A" | "B", role: string) {
  const id = randomUUID();
  await db.user.create({ data: { id, email: `${n}@x.test`, name: n, pw_hash: "x" } });
  await db.membership.create({ data: { user_id: id, paper_id: ids[paper], role } });
  await db.session.create({ data: { token_hash: hashToken(tok(n)), user_id: id, paper_id: ids[paper], expires_at: new Date(Date.now() + 1e7), revoked_at: null } });
  return id;
}

async function app() {
  const a = Fastify();
  a.setValidatorCompiler(validatorCompiler);
  a.setSerializerCompiler(serializerCompiler);
  await a.register(cookie);
  a.setErrorHandler((err: any, _q, reply) => {
    if (err instanceof ApiError) return reply.status(err.status).send({ code: err.code, message: err.message });
    return reply.status(err.statusCode ?? 500).send({ code: "bad_request", message: String(err.message) });
  });
  await a.register(async (s) => adminRoutes(s.withTypeProvider<ZodTypeProvider>() as any));
  await a.ready();
  return a;
}

let a: Awaited<ReturnType<typeof app>>;
beforeEach(async () => {
  db = makeFake(); h.db = db; h.jobs = []; delete process.env.ANTHROPIC_API_KEY;
  await db.paper.create({ data: { id: ids.A, slug: "a", name: "Paper A", lang: "en", script: "Latn", page_w_mm: 300, page_h_mm: 450, tz: "UTC", domain: null, ai_enabled: false } });
  await db.paper.create({ data: { id: ids.B, slug: "b", name: "Paper B", lang: "en", script: "Latn", page_w_mm: 300, page_h_mm: 450, tz: "UTC", domain: null, ai_enabled: false } });
  a = await app();
});

describe("AI switch", () => {
  it("is off by default and cannot be turned on without a key", async () => {
    await user("own", "A", "owner");
    const g = await a.inject({ url: "/v1/admin/paper", headers: as("own") });
    expect(g.json().ai).toMatchObject({ configured: false, enabled: false });
    expect(g.json().ai.reason).toMatch(/No AI key/);
    const r = await a.inject({ method: "PUT", url: "/v1/admin/ai", headers: as("own"), payload: { enabled: true } });
    expect(r.statusCode).toBe(409);
    expect(db.paper.rows[0]!.ai_enabled).toBe(false);
  });
  it("an owner can turn it on and off once a key is present; the key is never returned", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-secret-value";
    await user("own", "A", "owner");
    const on = await a.inject({ method: "PUT", url: "/v1/admin/ai", headers: as("own"), payload: { enabled: true } });
    expect(on.json()).toMatchObject({ configured: true, enabled: true });
    expect(on.body).not.toContain("sk-secret");
    const off = await a.inject({ method: "PUT", url: "/v1/admin/ai", headers: as("own"), payload: { enabled: false } });
    expect(off.json().enabled).toBe(false);
    expect(db.auditLog.rows.map((r) => r.action)).toEqual(["ai.on", "ai.off"]);
  });
  it("only an owner may flip it", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    await user("ed", "A", "editor"); await user("vw", "A", "viewer");
    for (const n of ["ed", "vw"]) expect((await a.inject({ method: "PUT", url: "/v1/admin/ai", headers: as(n), payload: { enabled: true } })).statusCode).toBe(403);
    expect((await a.inject({ method: "PUT", url: "/v1/admin/ai", payload: { enabled: true } })).statusCode).toBe(401);
  });
});

describe("members", () => {
  it("owner lists, changes a role, removes; others are refused", async () => {
    const o = await user("own", "A", "owner"); const e = await user("ed", "A", "editor");
    const l = await a.inject({ url: "/v1/admin/members", headers: as("own") });
    expect(l.json().items).toHaveLength(2);
    expect((await a.inject({ url: "/v1/admin/members", headers: as("ed") })).statusCode).toBe(403);
    expect((await a.inject({ method: "PATCH", url: `/v1/admin/members/${e}`, headers: as("own"), payload: { role: "viewer" } })).statusCode).toBe(200);
    expect((await a.inject({ method: "DELETE", url: `/v1/admin/members/${e}`, headers: as("own") })).statusCode).toBe(200);
    expect(db.session.rows.find((s) => s.user_id === e)!.revoked_at).toBeTruthy();
    expect((await a.inject({ method: "DELETE", url: `/v1/admin/members/${o}`, headers: as("own") })).json().code).toBe("remove_self");
  });
  it("never leaves a paper without an owner", async () => {
    const o = await user("own", "A", "owner");
    const r = await a.inject({ method: "PATCH", url: `/v1/admin/members/${o}`, headers: as("own"), payload: { role: "editor" } });
    expect(r.json().code).toBe("last_owner");
  });
  it("paper A owner cannot see or touch paper B people", async () => {
    await user("ownA", "A", "owner"); const b = await user("ownB", "B", "owner");
    expect((await a.inject({ url: "/v1/admin/members", headers: as("ownA") })).json().items.map((x: any) => x.name)).toEqual(["ownA"]);
    expect((await a.inject({ method: "PATCH", url: `/v1/admin/members/${b}`, headers: as("ownA"), payload: { role: "viewer" } })).statusCode).toBe(404);
    expect((await a.inject({ method: "DELETE", url: `/v1/admin/members/${b}`, headers: as("ownA") })).statusCode).toBe(404);
    expect(db.membership.rows.find((m) => m.user_id === b)!.role).toBe("owner");
  });
});

describe("api keys and webhooks", () => {
  it("lists keys without secrets, revokes, isolates papers", async () => {
    await user("ownA", "A", "owner"); await user("ownB", "B", "owner");
    const kA = await db.apiKey.create({ data: { paper_id: ids.A, source_id: null, key_hash: "HASHSECRET", label: "Feed" } });
    const kB = await db.apiKey.create({ data: { paper_id: ids.B, source_id: null, key_hash: "H2", label: "Other" } });
    const l = await a.inject({ url: "/v1/admin/keys", headers: as("ownA") });
    expect(l.json().items).toHaveLength(1);
    expect(l.body).not.toContain("HASHSECRET");
    expect((await a.inject({ method: "DELETE", url: `/v1/admin/keys/${kB.id}`, headers: as("ownA") })).statusCode).toBe(404);
    expect((await a.inject({ method: "DELETE", url: `/v1/admin/keys/${kA.id}`, headers: as("ownA") })).statusCode).toBe(200);
    expect(db.apiKey.rows.find((k) => k.id === kA.id)!.deleted_at).toBeTruthy();
  });
  it("webhook test creates a delivery and queues it; other paper is refused", async () => {
    await user("ownA", "A", "owner"); await user("ed", "A", "editor");
    const w = await db.webhook.create({ data: { paper_id: ids.A, url: "https://x.test/h", secret: "s", events: [], active: true } });
    const wb = await db.webhook.create({ data: { paper_id: ids.B, url: "https://y.test/h", secret: "s", events: [], active: true } });
    expect((await a.inject({ method: "POST", url: `/v1/admin/webhooks/${w.id}/test`, headers: as("ed") })).statusCode).toBe(403);
    expect((await a.inject({ method: "POST", url: `/v1/admin/webhooks/${wb.id}/test`, headers: as("ownA") })).statusCode).toBe(404);
    const r = await a.inject({ method: "POST", url: `/v1/admin/webhooks/${w.id}/test`, headers: as("ownA") });
    expect(r.statusCode).toBe(202);
    expect(db.webhookDelivery.rows[0]).toMatchObject({ event: "test", webhook_id: w.id });
    expect(h.jobs[0].type).toBe("webhook.deliver");
    expect((await a.inject({ method: "DELETE", url: `/v1/admin/webhooks/${w.id}`, headers: as("ownA") })).statusCode).toBe(200);
  });
});

describe("sources", () => {
  it("lists with plain-words health, edits mapping (owner/editor only), isolates papers", async () => {
    await user("ownA", "A", "owner"); await user("sub", "A", "sub"); await user("vw", "A", "viewer");
    const s = await db.source.create({ data: { paper_id: ids.A, kind: "rss", name: "Feed", config: {}, mapping: { x: 1 }, schedule: null, status: "error: site said no", last_sync_at: null } });
    const sb = await db.source.create({ data: { paper_id: ids.B, kind: "rss", name: "B feed", config: {}, mapping: null, schedule: null, status: "idle", last_sync_at: null } });
    const l = await a.inject({ url: "/v1/admin/sources", headers: as("vw") });
    expect(l.json().items).toHaveLength(1);
    expect(l.json().items[0].health).toMatchObject({ state: "error" });
    expect(l.json().items[0].health.text).toContain("site said no");
    for (const n of ["sub", "vw"]) expect((await a.inject({ method: "PATCH", url: `/v1/admin/sources/${s.id}`, headers: as(n), payload: { name: "z" } })).statusCode).toBe(403);
    expect((await a.inject({ method: "PATCH", url: `/v1/admin/sources/${sb.id}`, headers: as("ownA"), payload: { name: "z" } })).statusCode).toBe(404);
    const ok = await a.inject({ method: "PATCH", url: `/v1/admin/sources/${s.id}`, headers: as("ownA"), payload: { mapping: { headline: "h1" } } });
    expect(ok.statusCode).toBe(200);
    expect(db.source.rows.find((r) => r.id === s.id)!.mapping).toEqual({ headline: "h1" });
    expect(db.source.rows.find((r) => r.id === sb.id)!.name).toBe("B feed");
  });
});

describe("articles", () => {
  it("search, filter, hide and unhide; viewer cannot hide; paper B untouched", async () => {
    await user("ed", "A", "editor"); await user("vw", "A", "viewer");
    const mk = (paper: string, id: string, headline: string, section: string) => db.article.create({ data: { id, paper_id: paper, source_id: ids.A, headline, section, priority: 5, url: "u", lang: "en", published_at: new Date(), data: {} } });
    await mk(ids.A, "art_1", "Floods hit the coast", "news"); await mk(ids.A, "art_2", "Cup final tonight", "sport"); await mk(ids.B, "art_3", "Floods in B", "news");
    expect((await a.inject({ url: "/v1/admin/articles?q=flood", headers: as("vw") })).json().items.map((x: any) => x.id)).toEqual(["art_1"]);
    expect((await a.inject({ url: "/v1/admin/articles?section=sport", headers: as("vw") })).json().items).toHaveLength(1);
    expect((await a.inject({ method: "PATCH", url: "/v1/admin/articles/art_1/hidden", headers: as("vw"), payload: { hidden: true } })).statusCode).toBe(403);
    expect((await a.inject({ method: "PATCH", url: "/v1/admin/articles/art_3/hidden", headers: as("ed"), payload: { hidden: true } })).statusCode).toBe(404);
    expect((await a.inject({ method: "PATCH", url: "/v1/admin/articles/art_1/hidden", headers: as("ed"), payload: { hidden: true } })).statusCode).toBe(200);
    expect((await a.inject({ url: "/v1/admin/articles", headers: as("ed") })).json().items.map((x: any) => x.id)).toEqual(["art_2"]);
    expect((await a.inject({ url: "/v1/admin/articles?hidden=yes", headers: as("ed") })).json().items[0]).toMatchObject({ id: "art_1", hidden: true });
    await a.inject({ method: "PATCH", url: "/v1/admin/articles/art_1/hidden", headers: as("ed"), payload: { hidden: false } });
    expect(db.article.rows.find((r) => r.id === "art_1")!.deleted_at).toBeNull();
    expect(db.article.rows.find((r) => r.id === "art_3")!.deleted_at).toBeNull();
  });
});

describe("editions overview and approve-all", () => {
  it("shows pages, fill and the reader copy; approve-all needs a write role; paper isolation", async () => {
    await user("ed", "A", "editor"); await user("vw", "A", "viewer"); await user("edB", "B", "editor");
    const e = await db.edition.create({ data: { paper_id: ids.A, date: new Date("2026-11-24"), name: "", status: "draft" } });
    await db.page.create({ data: { paper_id: ids.A, edition_id: e.id, no: 1, fit_pct: 92, status: "draft", doc: {}, rev: 1, locked_by: null, lock_expires_at: null } });
    await db.page.create({ data: { paper_id: ids.A, edition_id: e.id, no: 2, fit_pct: 80, status: "approved", doc: {}, rev: 1, locked_by: null, lock_expires_at: null } });
    await db.epEdition.create({ data: { paper_id: ids.A, edition_id: e.id, date: new Date("2026-11-24"), status: "ready", version: 1, publish_at: null } });
    const o = await a.inject({ url: `/v1/admin/editions/${e.id}/overview`, headers: as("vw") });
    expect(o.json()).toMatchObject({ date: "2026-11-24", reader: { status: "ready" } });
    expect(o.json().pages.map((p: any) => p.fit_pct)).toEqual([92, 80]);
    expect((await a.inject({ url: `/v1/admin/editions/${e.id}/overview`, headers: as("edB") })).statusCode).toBe(404);
    expect((await a.inject({ method: "POST", url: `/v1/admin/editions/${e.id}/approve-all`, headers: as("vw") })).statusCode).toBe(403);
    expect((await a.inject({ method: "POST", url: `/v1/admin/editions/${e.id}/approve-all`, headers: as("edB") })).statusCode).toBe(404);
    const r = await a.inject({ method: "POST", url: `/v1/admin/editions/${e.id}/approve-all`, headers: as("ed") });
    expect(r.json()).toEqual({ approved: 1, skipped: 0 });
    expect(db.page.rows.every((p) => p.status === "approved")).toBe(true);
    expect(db.pageVersion.rows).toHaveLength(1);
  });
});

describe("audit and paper settings", () => {
  it("only an owner reads the audit log, of their own paper", async () => {
    await user("ownA", "A", "owner"); await user("ed", "A", "editor");
    await db.auditLog.create({ data: { id: 1, paper_id: ids.A, user_id: null, action: "login", entity: "session", at: new Date() } });
    await db.auditLog.create({ data: { id: 2, paper_id: ids.B, user_id: null, action: "secret", entity: "x", at: new Date() } });
    expect((await a.inject({ url: "/v1/admin/audit", headers: as("ed") })).statusCode).toBe(403);
    const r = await a.inject({ url: "/v1/admin/audit", headers: as("ownA") });
    expect(r.json().items.map((x: any) => x.action)).toEqual(["login"]);
  });
  it("owner edits the paper; editors cannot; only their paper changes", async () => {
    await user("ownA", "A", "owner"); await user("ed", "A", "editor");
    expect((await a.inject({ method: "PATCH", url: "/v1/admin/paper", headers: as("ed"), payload: { name: "X" } })).statusCode).toBe(403);
    const r = await a.inject({ method: "PATCH", url: "/v1/admin/paper", headers: as("ownA"), payload: { name: "Daily A", tz: "Asia/Kolkata" } });
    expect(r.json()).toMatchObject({ name: "Daily A", tz: "Asia/Kolkata" });
    expect(db.paper.rows.find((p) => p.id === ids.B)!.name).toBe("Paper B");
  });
});
