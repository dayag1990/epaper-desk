import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { makeFake, type Fake } from "./fake-prisma.js";

const h = vi.hoisted(() => ({ db: undefined as any }));
vi.mock("../src/db.js", () => ({ prisma: new Proxy({}, { get: (_t, k) => h.db[k as string] }) }));
vi.mock("../src/lib/enqueue.js", () => ({ enqueue: async () => ({ id: "j1", queue: "q" }), emitWebhook: async () => {} }));

import { authRoutes } from "../src/routes/auth.js";
import { contentRoutes } from "../src/routes/content.js";
import { editionRoutes } from "../src/routes/editions.js";
import { adminRoutes } from "../src/routes/admin-index.js";
import { hashPassword, hashToken } from "../src/auth.js";
import { resetLimits } from "../src/lib/ratelimit.js";
import { ApiError } from "../src/errors.js";

let db: Fake;
const ids = { A: "aaaaaaaa-0000-4000-8000-000000000001", B: "bbbbbbbb-0000-4000-8000-000000000002", C: "cccccccc-0000-4000-8000-000000000003" };
const EA = "eeeeeeee-0000-4000-8000-00000000000a", EB = "eeeeeeee-0000-4000-8000-00000000000b";
const NO = "You do not have access to that paper.";
const ck = (v: string) => ({ cookie: `epaper_session=${v}` });

async function user(n: string, memberships: Array<[keyof typeof ids, string]>, sessionPaper?: keyof typeof ids, pw = "x") {
  const id = randomUUID();
  await db.user.create({ data: { id, email: `${n}@x.test`, name: n, pw_hash: pw } });
  for (const [p, role] of memberships) await db.membership.create({ data: { user_id: id, paper_id: ids[p], role } });
  if (sessionPaper) await db.session.create({ data: { token_hash: hashToken(`tok-${n}`), user_id: id, paper_id: ids[sessionPaper], expires_at: new Date(Date.now() + 1e7), revoked_at: null } });
  return id;
}

async function build() {
  const a = Fastify();
  a.setValidatorCompiler(validatorCompiler);
  a.setSerializerCompiler(serializerCompiler);
  await a.register(cookie);
  a.setErrorHandler((err: any, _q, reply) => {
    if (err instanceof ApiError) return reply.status(err.status).send({ code: err.code, message: err.message });
    return reply.status(err.statusCode ?? 500).send({ code: "bad_request", message: String(err.message) });
  });
  const t = (s: any) => s.withTypeProvider() as ZodTypeProvider as any;
  await a.register(async (s) => authRoutes(t(s)));
  await a.register(async (s) => contentRoutes(t(s), {} as any));
  await a.register(async (s) => editionRoutes(t(s)));
  await a.register(async (s) => adminRoutes(t(s)));
  await a.ready();
  return a;
}

let a: Awaited<ReturnType<typeof build>>;
const sess = (res: any) => res.cookies.find((c: any) => c.name === "epaper_session");
beforeEach(async () => {
  db = makeFake(); h.db = db; resetLimits(); delete process.env.ANTHROPIC_API_KEY;
  const mk = (id: string, slug: string, name: string, lang = "en", script = "Latn") =>
    db.paper.create({ data: { id, slug, name, lang, script, page_w_mm: 300, page_h_mm: 450, tz: "UTC", domain: null, ai_enabled: false } });
  await mk(ids.A, "a", "Paper A");
  await mk(ids.B, "b", "Paper B", "ta", "Taml");
  await mk(ids.C, "c", "Paper C");
  await db.edition.create({ data: { id: EA, paper_id: ids.A, date: new Date("2026-11-20"), name: "A-ed", status: "draft", rev: 1 } });
  await db.edition.create({ data: { id: EB, paper_id: ids.B, date: new Date("2026-11-21"), name: "B-ed", status: "draft", rev: 1 } });
  a = await build();
});

describe("GET /v1/me/papers", () => {
  it("lists active papers, current first, with role, lang, script", async () => {
    await user("u", [["A", "owner"], ["B", "editor"]], "B");
    const r = await a.inject({ url: "/v1/me/papers", headers: ck("tok-u") });
    expect(r.json().items).toEqual([
      { slug: "b", name: "Paper B", lang: "ta", script: "Taml", role: "editor", current: true },
      { slug: "a", name: "Paper A", lang: "en", script: "Latn", role: "owner", current: false },
    ]);
  });
  it("leaves out deleted memberships and deleted papers", async () => {
    const id = await user("u", [["A", "owner"], ["B", "editor"], ["C", "viewer"]], "A");
    await db.membership.update({ where: { user_id_paper_id: { user_id: id, paper_id: ids.B } }, data: { deleted_at: new Date() } });
    await db.paper.update({ where: { id: ids.C }, data: { deleted_at: new Date() } });
    const r = await a.inject({ url: "/v1/me/papers", headers: ck("tok-u") });
    expect(r.json().items.map((p: any) => p.slug)).toEqual(["a"]);
  });
  it("/v1/me and /v1/auth/me carry the same list", async () => {
    await user("u", [["A", "owner"], ["B", "editor"]], "A");
    expect((await a.inject({ url: "/v1/me", headers: ck("tok-u") })).json().papers.map((p: any) => p.slug)).toEqual(["a", "b"]);
    expect((await a.inject({ url: "/v1/auth/me", headers: ck("tok-u") })).json().papers.length).toBe(2);
  });
  it("needs a sign-in", async () => {
    expect((await a.inject({ url: "/v1/me/papers" })).statusCode).toBe(401);
  });
});

describe("POST /v1/auth/switch", () => {
  it("moves a member to the other paper with a NEW cookie; the old cookie is dead", async () => {
    await user("u", [["A", "owner"], ["B", "editor"]], "A");
    const r = await a.inject({ method: "POST", url: "/v1/auth/switch", headers: ck("tok-u"), payload: { paper: "b" } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.paper.slug).toBe("b");
    expect(body.role).toBe("editor");
    expect(body.papers[0]).toMatchObject({ slug: "b", current: true });
    const c = sess(r);
    expect(c.httpOnly).toBe(true);
    expect(String(c.sameSite).toLowerCase()).toBe("lax");
    expect(c.value).not.toBe("tok-u");
    // old cookie: revoked, cannot be replayed
    expect((await a.inject({ url: "/v1/me", headers: ck("tok-u") })).statusCode).toBe(401);
    expect((await a.inject({ method: "POST", url: "/v1/auth/switch", headers: ck("tok-u"), payload: { paper: "a" } })).statusCode).toBe(401);
    // new cookie is paper B
    expect((await a.inject({ url: "/v1/auth/me", headers: ck(c.value) })).json().paper.slug).toBe("b");
    expect(db.session.rows.filter((s) => !s.revoked_at).length).toBe(1);
  });

  it("refuses non-member, unknown, deleted membership and deleted paper with the SAME words", async () => {
    const id = await user("u", [["A", "owner"], ["B", "editor"]], "A");
    await db.membership.update({ where: { user_id_paper_id: { user_id: id, paper_id: ids.B } }, data: { deleted_at: new Date() } });
    const out: Array<[number, string]> = [];
    for (const slug of ["c", "nope", "b"]) {
      const r = await a.inject({ method: "POST", url: "/v1/auth/switch", headers: ck("tok-u"), payload: { paper: slug } });
      out.push([r.statusCode, r.json().message]);
      expect(sess(r)).toBeUndefined();
    }
    // deleted paper (with a live membership)
    await db.membership.update({ where: { user_id_paper_id: { user_id: id, paper_id: ids.B } }, data: { deleted_at: null } });
    await db.paper.update({ where: { id: ids.B }, data: { deleted_at: new Date() } });
    const r = await a.inject({ method: "POST", url: "/v1/auth/switch", headers: ck("tok-u"), payload: { paper: "b" } });
    out.push([r.statusCode, r.json().message]);
    expect(out).toEqual([[403, NO], [403, NO], [403, NO], [403, NO]]);
    // still in paper A, same session
    expect((await a.inject({ url: "/v1/auth/me", headers: ck("tok-u") })).json().paper.slug).toBe("a");
  });

  it("API keys cannot switch", async () => {
    await db.apiKey.create({ data: { key_hash: hashToken("k1"), paper_id: ids.A, source_id: randomUUID() } });
    const r = await a.inject({ method: "POST", url: "/v1/auth/switch", headers: { "x-api-key": "k1" }, payload: { paper: "a" } });
    expect(r.statusCode).toBe(403);
    expect(r.json().message).toMatch(/API keys cannot switch/);
  });

  it("writes an audit row in BOTH papers", async () => {
    const id = await user("u", [["A", "owner"], ["B", "editor"]], "A");
    await a.inject({ method: "POST", url: "/v1/auth/switch", headers: ck("tok-u"), payload: { paper: "b" } });
    const rows = db.auditLog.rows;
    expect(rows.find((r) => r.paper_id === ids.A && r.action === "switch.away" && r.user_id === id)).toBeTruthy();
    expect(rows.find((r) => r.paper_id === ids.B && r.action === "switch.in" && r.user_id === id)).toBeTruthy();
  });

  it("after a switch every data route shows the NEW paper and the old paper's rows are unreadable", async () => {
    await user("u", [["A", "owner"], ["B", "owner"]], "A");
    const before = await a.inject({ url: "/v1/editions", headers: ck("tok-u") });
    expect(before.json().items.map((e: any) => e.id)).toEqual([EA]);
    const sw = await a.inject({ method: "POST", url: "/v1/auth/switch", headers: ck("tok-u"), payload: { paper: "b" } });
    const c = ck(sess(sw).value);
    expect((await a.inject({ url: "/v1/editions", headers: c })).json().items.map((e: any) => e.id)).toEqual([EB]);
    expect((await a.inject({ url: "/v1/admin/paper", headers: c })).json().name).toBe("Paper B");
    // paper A's edition is not there for a session now in B
    expect((await a.inject({ url: `/v1/admin/editions/${EA}/overview`, headers: c })).statusCode).toBe(404);
    expect((await a.inject({ url: `/v1/editions/${EA}`, headers: c })).statusCode).toBe(404);
    // and back again
    const back = await a.inject({ method: "POST", url: "/v1/auth/switch", headers: c, payload: { paper: "a" } });
    expect((await a.inject({ url: "/v1/editions", headers: ck(sess(back).value) })).json().items.map((e: any) => e.id)).toEqual([EA]);
  });

  it("a revoked membership kills a session even after a switch", async () => {
    const id = await user("u", [["A", "owner"], ["B", "owner"]], "A");
    const sw = await a.inject({ method: "POST", url: "/v1/auth/switch", headers: ck("tok-u"), payload: { paper: "b" } });
    await db.membership.update({ where: { user_id_paper_id: { user_id: id, paper_id: ids.B } }, data: { deleted_at: new Date() } });
    expect((await a.inject({ url: "/v1/editions", headers: ck(sess(sw).value) })).statusCode).toBe(401);
  });

  it("is rate limited", async () => {
    await user("u", [["A", "owner"]], "A");
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await a.inject({ method: "POST", url: "/v1/auth/switch", headers: ck("tok-u"), payload: { paper: "zzz" } })).statusCode;
    expect(last).toBe(429);
  });
});

describe("login with several papers", () => {
  it("one paper and no paper given: uses it; several and none given: the oldest; named paper: that one", async () => {
    const pw = await hashPassword("correct-horse-battery");
    const id = await user("m", [["A", "owner"]], undefined, pw);
    const login = (payload: any) => a.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "m@x.test", password: "correct-horse-battery", ...payload } });
    expect((await login({})).json().paper_id).toBe(ids.A);
    await db.membership.create({ data: { user_id: id, paper_id: ids.B, role: "editor", created_at: new Date(Date.now() + 5000) } });
    expect((await login({})).json().paper_id).toBe(ids.A);
    expect((await login({ paper: "b" })).json().paper_id).toBe(ids.B);
  });
  it("a failed login never says which papers exist: wrong password, unknown paper and non-member paper are the same 401", async () => {
    const pw = await hashPassword("correct-horse-battery");
    await user("m", [["A", "owner"]], undefined, pw);
    const login = (payload: any) => a.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "m@x.test", password: "correct-horse-battery", ...payload } });
    const bad = await login({ password: "wrong" });
    const other = await login({ paper: "b" });
    const unknown = await login({ paper: "nope" });
    for (const r of [bad, other, unknown]) { expect(r.statusCode).toBe(401); expect(r.json()).toEqual(bad.json()); }
  });
});
