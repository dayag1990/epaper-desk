import Fastify from "fastify";
import cookie from "@fastify/cookie";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  hasZodFastifySchemaValidationErrors,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma } from "./db.js";
import { config } from "./env.js";
import { ApiError } from "./errors.js";
import { HealthResponse, ReadyResponse, runChecks } from "./health-shape.js";
import { makeDriver } from "./files/index.js";
import { getBoss, ensureQueues } from "./queue.js";
import { authRoutes } from "./routes/auth.js";
import { sourceRoutes } from "./routes/sources.js";
import { fileRoutes } from "./routes/files.js";
import { jobRoutes } from "./routes/jobs.js";
import { contentRoutes } from "./routes/content.js";
import { editionRoutes } from "./routes/editions.js";
import { exportRoutes } from "./routes/exports.js";
import { epaperRoutes } from "./routes/epaper.js";
import { publicRoutes } from "./routes/public.js";
import { adminRoutes } from "./routes/admin-index.js";
import { serveEditor } from "./lib/static.js";
import { fontRoutes } from "./routes/fonts.js";
import { opsInternalRoutes } from "./routes/ops-internal.js";
import { eventRoutes } from "./routes/events.js";
import { hub } from "./events.js";

export async function buildApp() {
  const app = Fastify({ logger: { level: "info", redact: ["req.headers.cookie", "req.headers.authorization", "req.headers['x-api-key']"] }, trustProxy: true, bodyLimit: 64 * 1024 * 1024 });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(cookie);
  await app.register(swagger, {
    openapi: { info: { title: "E-Paper Desk API", version: "0.1.0" } },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_r, body, done) => done(null, body));
  app.addContentTypeParser("multipart/form-data", { parseAs: "buffer" }, (_r, body, done) => done(null, body));

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof ApiError) return reply.status(err.status).send({ code: err.code, message: err.message, details: err.details });
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(400).send({
        code: "bad_request",
        message: "Some of what you sent is missing or not in the right form.",
        details: err.validation.map((v: any) => ({ where: v.instancePath || v.params?.issue?.path?.join?.("."), problem: v.message })),
      });
    }
    if (err.statusCode && err.statusCode < 500)
      return reply.status(err.statusCode).send({ code: "bad_request", message: "That request could not be understood.", details: {} });
    app.log.error({ err: { message: err.message, name: err.name } }, "unhandled error");
    return reply.status(500).send({ code: "server_error", message: "Something went wrong on our side. Nothing was lost; please try again.", details: {} });
  });
  app.setNotFoundHandler(async (req, reply) => {
    const api = /^\/(v1|docs|healthz|readyz|fonts)(\/|$)/.test(req.url);
    if (req.method === "GET" && !api) {
      const f = await serveEditor(req.url);
      return reply.status(f.status).header("content-type", f.type).header("cache-control", f.cache).send(f.body);
    }
    return reply.status(404).send({ code: "not_found", message: "There is nothing at this address.", details: {} });
  });

  const driver = makeDriver(config.filesDriver, config.filesRoot);
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/healthz", { schema: { response: { 200: HealthResponse } } }, async () => ({ ok: true as const }));
  r.get("/readyz", { schema: { response: { 200: ReadyResponse, 503: ReadyResponse } } }, async (_q, reply) => {
    const { status, body } = await runChecks({
      db: async () => void (await prisma.$queryRaw`select 1`),
      files: () => driver.check(),
    });
    return reply.status(status).send(body);
  });

  await app.register(async (s) => authRoutes(s.withTypeProvider<ZodTypeProvider>()));
  await app.register(async (s) => sourceRoutes(s.withTypeProvider<ZodTypeProvider>()));
  await app.register(async (s) => fileRoutes(s.withTypeProvider<ZodTypeProvider>(), driver));
  await app.register(async (s) => jobRoutes(s.withTypeProvider<ZodTypeProvider>()));
  await app.register(async (s) => contentRoutes(s.withTypeProvider<ZodTypeProvider>(), driver));
  await app.register(async (s) => editionRoutes(s.withTypeProvider<ZodTypeProvider>()));
  await app.register(async (s) => exportRoutes(s.withTypeProvider<ZodTypeProvider>(), driver));
  await app.register(async (s) => epaperRoutes(s.withTypeProvider<ZodTypeProvider>(), driver));
  await app.register(async (s) => publicRoutes(s.withTypeProvider<ZodTypeProvider>(), driver));
  await app.register(async (s) => eventRoutes(s.withTypeProvider<ZodTypeProvider>()));

  await app.register(async (s) => adminRoutes(s.withTypeProvider<ZodTypeProvider>()));
  await app.register(async (s) => fontRoutes(s));
  await app.register(async (s) => opsInternalRoutes(s.withTypeProvider<ZodTypeProvider>()));

  app.addHook("onReady", async () => {
    hub.start(); // LISTEN for live updates; if Postgres is away it keeps trying and the screens poll meanwhile
    await ensureQueues(await getBoss());
  });
  app.addHook("onClose", async () => hub.stop());
  return app;
}
export type { z };
