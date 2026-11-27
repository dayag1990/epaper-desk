import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { makeFake, type Fake } from "./fake-prisma.js";

const h = vi.hoisted(() => ({ db: undefined as any, jobs: [] as any[] }));
vi.mock("../src/db.js", () => ({ prisma: new Proxy({}, { get: (_t, k) => h.db[k as string] }) }));
vi.mock("../src/lib/enqueue.js", () => ({ enqueue: async (type: string, paper: string, payload: any) => (h.jobs.push({ type, paper, payload }), { id: "j1", queue: "q" }), emitWebhook: async () => {} }));

import { editionRoutes } from "../src/routes/editions.js";
import { hashToken } from "../src/auth.js";
import { ApiError } from "../src/errors.js";

let db: Fake;
const P = "aaaaaaaa-0000-4000-8000-000000000001";
const as = (n: string) => ({ cookie: `epaper_session=tok-${n}` });
async function user(n: string, role: string) {
  const id = randomUUID();
  await db.user.create({ data: { id, email: `${n}@x.test`, name: n, pw_hash: "x" } });
  await db.membership.create({ data: { user_id: id, paper_id: P, role } });
  await db.session.create({ data: { token_hash: hashToken(`tok-${n}`), user_id: id, paper_id: P, expires_at: new Date(Date.now() + 1e7), revoked_at: null } });
  return id;
}
async function app() {
  const a = Fastify();
  a.setValidatorCompiler(validatorCompiler); a.setSerializerCompiler(serializerCompiler);
  await a.register(cookie);
  a.setErrorHandler((err: any, _q, reply) => {
    if (err instanceof ApiError) return reply.status(err.status).send({ code: err.code, message: err.message });
    return reply.status(err.statusCode ?? 500).send({ code: "bad_request", message: String(err.message) });
  });
  await a.register(async (s) => editionRoutes(s.withTypeProvider<ZodTypeProvider>() as any));
  await a.ready();
  return a;
}
let a: Awaited<ReturnType<typeof app>>;
let ed: any; let pages: any[];
const mkPage = (no: number, extra: any = {}) => db.page.create({ data: { paper_id: P, edition_id: ed.id, no, template_id: "t", doc: { page: { no, body_pt: 9 }, items: [{ article_id: `art-${no}` }] }, rev: 3, status: "draft", fit_pct: 90, locked_by: null, lock_expires_at: null, ...extra } });

beforeEach(async () => {
  db = makeFake(); h.db = db; h.jobs = [];
  await db.paper.create({ data: { id: P, slug: "a", name: "Paper", lang: "en", script: "Latn", page_w_mm: 300, page_h_mm: 450, tz: "UTC" } });
  ed = await db.edition.create({ data: { paper_id: P, date: new Date("2026-11-24"), name: "", template_set: "broadsheet-en", status: "draft" } });
  pages = [];
  for (const n of [1, 2, 3, 4, 5]) { const r = await mkPage(n); pages.push(r); await db.pageArticle.create({ data: { page_id: r.id, paper_id: P, article_id: `art-${n}`, article_rev: 1 } }); }
  a = await app();
});

describe("DELETE /v1/pages/:id", () => {
  it("keeps a version, renumbers the later pages, frees the stories and asks for a new fit", async () => {
    await user("ed", "editor");
    const r = await a.inject({ method: "DELETE", url: `/v1/pages/${pages[1].id}`, headers: as("ed") });
    expect(r.statusCode).toBe(200);
    expect(r.json().deleted).toMatchObject({ no: 2, rev: 4 });
    const gone = db.page.rows.find((x) => x.id === pages[1].id)!;
    expect(gone.deleted_at).toBeInstanceOf(Date);
    expect(gone.no).toBeLessThan(1);
    const v = db.pageVersion.rows.find((x) => x.page_id === gone.id && x.source === "delete")!;
    expect(v.rev).toBe(4);
    expect(v.doc.items[0].article_id).toBe("art-2");               // the content of the page is in the kept version
    expect(db.pageArticle.rows.some((x) => x.article_id === "art-2")).toBe(false);
    const live = db.page.rows.filter((x) => !x.deleted_at).sort((x, y) => x.no - y.no);
    expect(live.map((x) => x.no)).toEqual([1, 2, 3, 4]);
    expect(live[1]!.doc.items[0].article_id).toBe("art-3");        // old page 3 is now page 2, doc.page.no moved too
    expect(live[1]!.doc.page.no).toBe(2);
    expect(live[1]!.rev).toBe(4);
    expect(db.pageVersion.rows.filter((x) => x.source === "renumber").length).toBe(3);
    expect(h.jobs.filter((j) => j.type === "page.fit").length).toBe(3);
    // the deleted page is gone from the edition and cannot be opened
    const e = await a.inject({ url: `/v1/editions/${ed.id}`, headers: as("ed") });
    expect(e.json().pages.map((x: any) => x.no)).toEqual([1, 2, 3, 4]);
    expect((await a.inject({ url: `/v1/pages/${gone.id}`, headers: as("ed") })).statusCode).toBe(404);
  });

  it("deleting the last page again and again keeps the parked numbers apart", async () => {
    await user("ed", "editor");
    for (const i of [4, 3]) { // pages[4] is page 5, then pages[3] is page 4
      expect((await a.inject({ method: "DELETE", url: `/v1/pages/${pages[i].id}`, headers: as("ed") })).statusCode).toBe(200);
    }
    const parked = db.page.rows.filter((x) => x.deleted_at).map((x) => x.no);
    expect(new Set(parked).size).toBe(2);
    expect(db.page.rows.filter((x) => !x.deleted_at).length).toBe(3);
  });

  it("refuses an approved page, a later approved page, another person's lock, the only page, and a viewer", async () => {
    await user("ed", "editor"); await user("v", "viewer"); const other = await user("other", "editor");
    db.page.rows[1]!.status = "approved";
    let r = await a.inject({ method: "DELETE", url: `/v1/pages/${pages[1].id}`, headers: as("ed") });
    expect(r.statusCode).toBe(423); expect(r.json().message).toMatch(/Reopen it/);
    r = await a.inject({ method: "DELETE", url: `/v1/pages/${pages[0].id}`, headers: as("ed") });   // page 2 is approved and comes after page 1
    expect(r.statusCode).toBe(423); expect(r.json().message).toMatch(/Page 2 is approved/);
    db.page.rows[1]!.status = "draft";
    db.page.rows[3]!.locked_by = other; db.page.rows[3]!.lock_expires_at = new Date(Date.now() + 60_000);
    r = await a.inject({ method: "DELETE", url: `/v1/pages/${pages[2].id}`, headers: as("ed") });
    expect(r.statusCode).toBe(423); expect(r.json().message).toMatch(/being edited by other/);
    expect((await a.inject({ method: "DELETE", url: `/v1/pages/${pages[2].id}`, headers: as("v") })).statusCode).toBe(403);
    expect(db.page.rows.every((x) => !x.deleted_at)).toBe(true);
    // only page
    for (const i of [1, 2, 3, 4]) db.page.rows[i]!.deleted_at = new Date();
    r = await a.inject({ method: "DELETE", url: `/v1/pages/${pages[0].id}`, headers: as("ed") });
    expect(r.statusCode).toBe(409); expect(r.json().message).toMatch(/only page/);
  });

  it("keeps \"Continued on page N\" lines right: the page number follows the renumbering, and a line whose other half was on the deleted page goes", async () => {
    await user("ed", "editor");
    const doc = (no: number, items: any[]) => ({ page: { no, body_pt: 9 }, items, status: "draft", rev: 3 });
    // page 1 runs on to page 3 (it_b); page 4 runs on to page 2 (it_d), which is about to be deleted
    await db.page.update({ where: { id: pages[0].id }, data: { doc: doc(1, [{ id: "it_a", jump: { role: "to", pair: "it_b", page: 3 } }]) } });
    await db.page.update({ where: { id: pages[1].id }, data: { doc: doc(2, [{ id: "it_d", jump: { role: "from", pair: "it_c", page: 4 } }]) } });
    await db.page.update({ where: { id: pages[2].id }, data: { doc: doc(3, [{ id: "it_b", jump: { role: "from", pair: "it_a", page: 1 } }]) } });
    await db.page.update({ where: { id: pages[3].id }, data: { doc: doc(4, [{ id: "it_c", jump: { role: "to", pair: "it_d", page: 2 } }]) } });
    const r = await a.inject({ method: "DELETE", url: `/v1/pages/${pages[1].id}`, headers: as("ed") });
    expect(r.statusCode).toBe(200);
    const doc1 = db.page.rows.find((x) => x.id === pages[0].id)!.doc as any;
    expect(doc1.items[0].jump).toEqual({ role: "to", pair: "it_b", page: 2 }); // was page 3, now page 2
    const doc3 = db.page.rows.find((x) => x.id === pages[2].id)!.doc as any;
    expect(doc3.page.no).toBe(2);
    expect(doc3.items[0].jump).toEqual({ role: "from", pair: "it_a", page: 1 });
    const doc4 = db.page.rows.find((x) => x.id === pages[3].id)!.doc as any;
    expect(doc4.items[0].jump).toBeUndefined(); // its other half went back to the tray with the deleted page
    expect(db.pageVersion.rows.some((x) => x.page_id === pages[0].id && x.source === "renumber")).toBe(true);
  });
});
