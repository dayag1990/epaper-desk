import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { opsInternalRoutes, readPaused } from "../src/routes/ops-internal.js";

const TOKEN = "t".repeat(64);
async function build(token: string | undefined) {
  const dir = mkdtempSync(path.join(tmpdir(), "opsint-"));
  const file = path.join(dir, "_ops", "paused-queues.json");
  const calls: any[] = [];
  const a = Fastify();
  opsInternalRoutes(a as any, {
    token, pausedFile: file,
    counts: async () => ({ waiting: { export: 3, layout: 1 }, dead: 2 }),
    retryDead: async (o) => { calls.push(o); return 2; },
  });
  await a.ready();
  return { a, file, calls };
}
const auth = { authorization: `Bearer ${TOKEN}` };

describe("internal ops routes", () => {
  it("do not exist without a configured token", async () => {
    const { a } = await build(undefined);
    expect((await a.inject({ method: "GET", url: "/internal/ops/queues", headers: auth })).statusCode).toBe(404);
  });
  it("refuse a missing or wrong key", async () => {
    const { a } = await build(TOKEN);
    expect((await a.inject({ method: "GET", url: "/internal/ops/queues" })).statusCode).toBe(401);
    expect((await a.inject({ method: "GET", url: "/internal/ops/queues", headers: { authorization: "Bearer nope" } })).statusCode).toBe(401);
    expect((await a.inject({ method: "POST", url: "/internal/ops/queues/export/pause", headers: { authorization: `Bearer ${"x".repeat(64)}` } })).statusCode).toBe(401);
  });
  it("list queues with depth and dead letters", async () => {
    const { a } = await build(TOKEN);
    const r = (await a.inject({ method: "GET", url: "/internal/ops/queues", headers: auth })).json();
    expect(r.dead).toBe(2);
    expect(r.queues.find((q: any) => q.name === "export")).toEqual({ name: "export", depth: 3, paused: false });
    expect(r.queues.map((q: any) => q.name)).toContain("epaper");
  });
  it("pause and resume write the shared file", async () => {
    const { a, file } = await build(TOKEN);
    expect((await a.inject({ method: "POST", url: "/internal/ops/queues/export/pause", headers: auth })).statusCode).toBe(200);
    expect(readPaused(file)).toEqual(["export"]);
    const r = (await a.inject({ method: "GET", url: "/internal/ops/queues", headers: auth })).json();
    expect(r.queues.find((q: any) => q.name === "export").paused).toBe(true);
    await a.inject({ method: "POST", url: "/internal/ops/queues/export/resume", headers: auth });
    expect(readPaused(file)).toEqual([]);
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual([]);
  });
  it("refuse an unknown queue name", async () => {
    const { a } = await build(TOKEN);
    expect((await a.inject({ method: "POST", url: "/internal/ops/queues/..%2Fetc/pause", headers: auth })).statusCode).toBe(404);
    expect((await a.inject({ method: "POST", url: "/internal/ops/queues/nothing/pause", headers: auth })).statusCode).toBe(404);
  });
  it("retry passes the filters on and reports the count", async () => {
    const { a, calls } = await build(TOKEN);
    const r = await a.inject({ method: "POST", url: "/internal/ops/jobs/retry", headers: auth, payload: { queue: "export", ids: ["a"] } });
    expect(r.json()).toEqual({ retried: 2 });
    expect(calls[0]).toEqual({ queue: "export", ids: ["a"] });
  });
});
