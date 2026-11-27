import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { SSO_COOKIE, verifySso } from "@epaper/sso";
import { makeFake, type Fake } from "./fake-prisma.js";

const h = vi.hoisted(() => ({ db: undefined as any, jobs: [] as any[] }));
vi.mock("../src/db.js", () => ({ prisma: new Proxy({}, { get: (_t, k) => h.db[k as string] }) }));
vi.mock("../src/lib/enqueue.js", () => ({ enqueue: async (type: string, paper: string, payload: any) => (h.jobs.push({ type, paper, payload }), { id: "j1", queue: "q" }), emitWebhook: async () => {} }));

import { authRoutes } from "../src/routes/auth.js";
import { contentRoutes } from "../src/routes/content.js";
import { editionRoutes } from "../src/routes/editions.js";
import { eventRoutes } from "../src/routes/events.js";
import { EventHub, type ListenFactory, type WireEvent } from "../src/events.js";
import { hashPassword, hashToken } from "../src/auth.js";
import { ApiError } from "../src/errors.js";

const SECRET = "dummy-sso-secret-for-tests-only";
const P = "aaaaaaaa-0000-4000-8000-000000000001", Q = "bbbbbbbb-0000-4000-8000-000000000002";
let db: Fake;

async function build(hub: EventHub) {
  const a = Fastify();
  a.setValidatorCompiler(validatorCompiler); a.setSerializerCompiler(serializerCompiler);
  await a.register(cookie);
  a.setErrorHandler((err: any, _q, reply) => {
    if (err instanceof ApiError) return reply.status(err.status).send({ code: err.code, message: err.message });
    return reply.status(err.statusCode ?? 500).send({ code: "bad_request", message: String(err.message) });
  });
  for (const r of [authRoutes, (s: any) => contentRoutes(s, {} as any), editionRoutes, (s: any) => eventRoutes(s, hub)]) await a.register(async (s) => (r as any)(s.withTypeProvider<ZodTypeProvider>()));
  await a.ready();
  return a;
}
const hubOf = () => { const fns: Array<(e: WireEvent) => void> = []; const f: ListenFactory = async (on) => (fns.push(on), { close() {} }); const hub = new EventHub(f); return { hub, fns, f }; };

async function mkUser(name: string, role: string, paper = P) {
  const id = randomUUID();
  await db.user.create({ data: { id, email: `${name}@x.test`, name, pw_hash: await hashPassword("correct horse battery") } });
  await db.membership.create({ data: { user_id: id, paper_id: paper, role } });
  await db.session.create({ data: { token_hash: hashToken(`tok-${name}`), user_id: id, paper_id: paper, expires_at: new Date(Date.now() + 1e7), revoked_at: null } });
  return id;
}

beforeEach(async () => {
  db = makeFake(); h.db = db; h.jobs = [];
  await db.paper.create({ data: { id: P, slug: "a", name: "A", lang: "en", script: "Latn", page_w_mm: 300, page_h_mm: 450, tz: "UTC" } });
  await db.paper.create({ data: { id: Q, slug: "b", name: "B", lang: "en", script: "Latn", page_w_mm: 300, page_h_mm: 450, tz: "UTC" } });
});
afterEach(() => { delete process.env.SSO_SECRET; delete process.env.SSO_COOKIE_DOMAIN; });

const setCookies = (r: { headers: Record<string, unknown> }) => ([] as string[]).concat((r.headers["set-cookie"] as string | string[] | undefined) ?? []);

describe("one login: the sign-in cookie", () => {
  it("login sets a signed HttpOnly SameSite=Lax cookie with the owner flag (12 h), next to the session cookie", async () => {
    process.env.SSO_SECRET = SECRET;
    await mkUser("olga", "owner"); await mkUser("eddie", "editor");
    const a = await build(hubOf().hub);
    const r = await a.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "olga@x.test", password: "correct horse battery" } });
    expect(r.statusCode).toBe(200);
    const lines = setCookies(r);
    expect(lines.some((l) => l.startsWith("epaper_session="))).toBe(true);
    const sso = lines.find((l) => l.startsWith(`${SSO_COOKIE}=`))!;
    expect(sso).toMatch(/HttpOnly/); expect(sso).toMatch(/SameSite=Lax/); expect(sso).toMatch(/Max-Age=43200/);
    const claims = verifySso(SECRET, sso.split(";")[0]!.slice(SSO_COOKIE.length + 1));
    expect(claims).toMatchObject({ email: "olga@x.test", owner: true });
    const e = await a.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "eddie@x.test", password: "correct horse battery" } });
    const ec = verifySso(SECRET, setCookies(e).find((l) => l.startsWith(`${SSO_COOKIE}=`))!.split(";")[0]!.slice(SSO_COOKIE.length + 1));
    expect(ec).toMatchObject({ owner: false });
  });
  it("sets nothing without SSO_SECRET, and a wrong password sets nothing", async () => {
    await mkUser("olga", "owner");
    const a = await build(hubOf().hub);
    const ok = await a.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "olga@x.test", password: "correct horse battery" } });
    expect(setCookies(ok).some((l) => l.startsWith(SSO_COOKIE))).toBe(false);
    process.env.SSO_SECRET = SECRET;
    const bad = await a.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "olga@x.test", password: "nope nope nope nope" } });
    expect(bad.statusCode).toBe(401);
    expect(setCookies(bad)).toEqual([]);
  });
  it("sign out clears the sign-in cookie and the ops desk session cookie as well", async () => {
    process.env.SSO_SECRET = SECRET;
    await mkUser("olga", "owner");
    const a = await build(hubOf().hub);
    const r = await a.inject({ method: "POST", url: "/v1/auth/logout", headers: { cookie: "epaper_session=tok-olga" } });
    const lines = setCookies(r);
    expect(lines.find((l) => l.startsWith("epaper_session="))).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
    expect(lines.find((l) => l.startsWith(`${SSO_COOKIE}=`))).toMatch(/Max-Age=0/);
    expect(lines.find((l) => l.startsWith("ops_session="))).toMatch(/Max-Age=0/);
    expect(db.session.rows[0]!.revoked_at).toBeTruthy();
  });
  it("/v1/me hands out a fresh cookie when it is missing or about to run out, and leaves a good one alone", async () => {
    process.env.SSO_SECRET = SECRET;
    const id = await mkUser("olga", "owner");
    const a = await build(hubOf().hub);
    const first = await a.inject({ method: "GET", url: "/v1/me", headers: { cookie: "epaper_session=tok-olga" } });
    expect(setCookies(first).some((l) => l.startsWith(SSO_COOKIE))).toBe(true);
    const { signSso } = await import("@epaper/sso");
    const good = signSso(SECRET, { uid: id, email: "olga@x.test", owner: true });
    const again = await a.inject({ method: "GET", url: "/v1/me", headers: { cookie: `epaper_session=tok-olga; ${SSO_COOKIE}=${good}` } });
    expect(setCookies(again).some((l) => l.startsWith(SSO_COOKIE))).toBe(false);
    const old = signSso(SECRET, { uid: id, email: "olga@x.test", owner: true, exp: Math.floor(Date.now() / 1000) + 3600 });
    const near = await a.inject({ method: "GET", url: "/v1/me", headers: { cookie: `epaper_session=tok-olga; ${SSO_COOKIE}=${old}` } });
    expect(setCookies(near).some((l) => l.startsWith(SSO_COOKIE))).toBe(true);
  });
  it("a cookie domain can be set for papers on sub-domains", async () => {
    process.env.SSO_SECRET = SECRET; process.env.SSO_COOKIE_DOMAIN = "example.test";
    await mkUser("olga", "owner");
    const a = await build(hubOf().hub);
    const r = await a.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "olga@x.test", password: "correct horse battery" } });
    expect(setCookies(r).find((l) => l.startsWith(SSO_COOKIE))).toMatch(/Domain=example\.test/);
  });
});

describe("the event hub", () => {
  const ev = (paper_id: string, over: Partial<WireEvent> = {}): WireEvent => ({ type: "page.updated", paper_id, page_id: "p1", edition_id: "e1", rev: 2, fill: 91, status: "draft", ...over } as WireEvent);
  it("hands an event only to the papers it belongs to (and, for the public, only the public kinds)", () => {
    const { hub } = hubOf(); const mine: string[] = [], other: string[] = [], pub: string[] = [];
    hub.subscribe(P, (_i, e) => mine.push(e.type)); hub.subscribe(Q, (_i, e) => other.push(e.type)); hub.subscribe(P, (_i, e) => pub.push(e.type), new Set(["edition.published"]));
    hub.dispatch(ev(P)); hub.dispatch({ type: "edition.published", paper_id: P, ep_edition_id: "x", edition_id: null, date: "2026-11-27", version: 1 });
    expect(mine).toEqual(["page.updated", "edition.published"]); expect(other).toEqual([]); expect(pub).toEqual(["edition.published"]);
  });
  it("reconnects with backoff when Postgres goes away, and tells every screen to look again", async () => {
    vi.useFakeTimers();
    let n = 0; const downs: Array<() => void> = [];
    const f: ListenFactory = async (_on, down) => { n++; if (n === 2) throw new Error("db down"); downs.push(down); return { close() {} }; };
    const hub = new EventHub(f); const got: string[] = [];
    hub.subscribe(P, (_i, e) => got.push(e.type));
    hub.start(); await vi.advanceTimersByTimeAsync(0); expect(hub.connected).toBe(true);
    downs[0]!(); expect(hub.connected).toBe(false);
    await vi.advanceTimersByTimeAsync(1000); expect(n).toBe(2); expect(hub.connected).toBe(false);
    await vi.advanceTimersByTimeAsync(2000); expect(n).toBe(3); expect(hub.connected).toBe(true);
    expect(got).toContain("resync");
    hub.stop(); vi.useRealTimers();
  });
});

describe("GET /v1/events", () => {
  async function serve(hub: EventHub) {
    const a = await build(hub); await a.listen({ port: 0, host: "127.0.0.1" });
    return { a, url: `http://127.0.0.1:${(a.server.address() as AddressInfo).port}` };
  }
  async function readUntil(res: Response, re: RegExp, ms = 3000) {
    const rd = res.body!.getReader(); let buf = ""; const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const r = await Promise.race([rd.read(), new Promise<{ done: true; value?: undefined }>((ok) => setTimeout(() => ok({ done: true }), 300))]);
      if (r.value) buf += new TextDecoder().decode(r.value);
      if (re.test(buf)) break;
    }
    await rd.cancel().catch(() => undefined);
    return buf;
  }
  it("refuses people who are not signed in", async () => {
    const { hub } = hubOf(); const { a, url } = await serve(hub);
    expect((await fetch(`${url}/v1/events`)).status).toBe(401);
    await a.close();
  });
  it("streams this paper's events as they happen and nothing from other papers", async () => {
    await mkUser("eddie", "editor");
    const { hub } = hubOf(); const { a, url } = await serve(hub);
    const res = await fetch(`${url}/v1/events`, { headers: { cookie: "epaper_session=tok-eddie" } });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    setTimeout(() => { hub.dispatch({ type: "page.fit", paper_id: Q, page_id: "no", edition_id: "e", rev: 1, fill: 10, state: "low", overflow: false }); hub.dispatch({ type: "page.fit", paper_id: P, page_id: "p9", edition_id: "e", rev: 4, fill: 104, state: "over", overflow: true }); }, 100);
    const text = await readUntil(res, /p9/);
    expect(text).toMatch(/event: hello/); expect(text).toMatch(/event: page\.fit\ndata: .*"page_id":"p9".*"fill":104/); expect(text).not.toMatch(/"page_id":"no"/);
    await a.close();
  });
  it("the public stream needs no sign-in but carries only 'edition published/updated'", async () => {
    const { hub } = hubOf(); const { a, url } = await serve(hub);
    await db.paper.update({ where: { id: P }, data: {} });
    const res = await fetch(`${url}/v1/public/papers/a/events`);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    setTimeout(() => { hub.dispatch({ type: "page.fit", paper_id: P, page_id: "secret", edition_id: "e", rev: 1, fill: 1, state: "ok", overflow: false }); hub.dispatch({ type: "edition.published", paper_id: P, ep_edition_id: "ep1", edition_id: null, date: "2026-11-27", version: 3 }); }, 100);
    const text = await readUntil(res, /ep1/);
    expect(text).toMatch(/event: edition\.published/); expect(text).not.toMatch(/secret/);
    expect((await fetch(`${url}/v1/public/papers/nope/events`)).status).toBe(404);
    await a.close();
  });
});

describe("announcements after the database write", () => {
  it("saving a page announces page.updated with the new rev, after the write", async () => {
    const id = await mkUser("eddie", "editor");
    const ed = await db.edition.create({ data: { paper_id: P, date: new Date("2026-11-24"), name: "", template_set: "x", status: "draft" } });
    const pg = await db.page.create({ data: { paper_id: P, edition_id: ed.id, no: 1, template_id: "t", doc: {}, rev: 3, status: "draft", fit_pct: 88, locked_by: id, lock_expires_at: new Date(Date.now() + 1e6) } });
    const a = await build(hubOf().hub);
    const doc = { page: { no: 1, size: "broadsheet", template: "t", w_mm: 300, h_mm: 450, body_pt: 9 }, items: [], status: "draft", rev: 3 };
    const r = await a.inject({ method: "PUT", url: `/v1/pages/${pg.id}`, headers: { cookie: "epaper_session=tok-eddie" }, payload: { doc, rev: 3 } });
    expect(r.statusCode).toBe(200);
    expect(db.notes).toEqual([expect.objectContaining({ type: "page.updated", paper_id: P, page_id: pg.id, edition_id: ed.id, rev: 4, fill: 88, by: id })]);
    // a stale save is refused and announces nothing
    const stale = await a.inject({ method: "PUT", url: `/v1/pages/${pg.id}`, headers: { cookie: "epaper_session=tok-eddie" }, payload: { doc, rev: 3 } });
    expect(stale.statusCode).toBe(409);
    expect(db.notes.length).toBe(1);
  });
});
