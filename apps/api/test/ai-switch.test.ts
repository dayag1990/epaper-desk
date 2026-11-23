import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { makeFake, type Fake } from "./fake-prisma.js";

const h = vi.hoisted(() => ({ db: undefined as any }));
vi.mock("../src/db.js", () => ({ prisma: new Proxy({}, { get: (_t, k) => h.db[k as string] }) }));
vi.mock("../src/lib/enqueue.js", () => ({ enqueue: async () => ({ id: "j1", queue: "q" }), emitWebhook: async () => undefined }));

import { contentRoutes } from "../src/routes/content.js";
import { hashToken } from "../src/auth.js";
import { ApiError } from "../src/errors.js";

const PAPER = "aaaaaaaa-0000-4000-8000-000000000001";
let db: Fake;
let a: Awaited<ReturnType<typeof build>>;
const hdr = { cookie: "epaper_session=tok-ed" };

async function build() {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(cookie);
  app.setErrorHandler((err: any, _q, reply) => {
    if (err instanceof ApiError) return reply.status(err.status).send({ code: err.code, message: err.message });
    return reply.status(err.statusCode ?? 500).send({ code: "bad_request", message: String(err.message) });
  });
  await app.register(async (s) => contentRoutes(s.withTypeProvider<ZodTypeProvider>() as any, {} as any));
  await app.ready();
  return app;
}

beforeEach(async () => {
  db = makeFake(); h.db = db; delete process.env.ANTHROPIC_API_KEY;
  await db.paper.create({ data: { id: PAPER, slug: "a", name: "A", ai_enabled: false } });
  const id = randomUUID();
  await db.user.create({ data: { id, email: "ed@x.test", name: "ed", pw_hash: "x" } });
  await db.membership.create({ data: { user_id: id, paper_id: PAPER, role: "editor" } });
  await db.session.create({ data: { token_hash: hashToken("tok-ed"), user_id: id, paper_id: PAPER, expires_at: new Date(Date.now() + 1e7), revoked_at: null } });
  a = await build();
});

const suggest = () => a.inject({ method: "POST", url: "/v1/ai/suggest", headers: hdr, payload: { text: "A very long headline about the town council meeting" } });
const me = async () => (await a.inject({ method: "GET", url: "/v1/me", headers: hdr })).json().ai_enabled;

describe("AI is off unless a key exists AND the paper switch is on", () => {
  it("default: off, suggestions refused with a plain message", async () => {
    expect(await me()).toBe(false);
    const r = await suggest();
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("ai_disabled");
  });
  it("switch on but no key: still off", async () => {
    await db.paper.update({ where: { id: PAPER }, data: { ai_enabled: true } });
    expect(await me()).toBe(false);
    expect((await suggest()).statusCode).toBe(403);
  });
  it("key present but switch off: still off", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    expect(await me()).toBe(false);
    expect((await suggest()).statusCode).toBe(403);
  });
  it("key present and switch on: on", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    await db.paper.update({ where: { id: PAPER }, data: { ai_enabled: true } });
    expect(await me()).toBe(true);
    const r = await suggest();
    expect(r.statusCode).toBe(200);
    expect(r.json().options.length).toBeGreaterThan(0);
  });
});
