import fs from "node:fs";
import crypto from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { DbRestoreBodySchema, FilesRestoreBodySchema, JobsRetryBodySchema, LogsQuerySchema, OpsStatusSchema, type OpsStatus } from "@epaper/core";
import { z } from "zod";
import { AlertEngine, AlertSender, FileChannel, TelegramChannel, loadAlertRules, type AlertChannel } from "./alerts.js";
import type { ApiClient } from "./api-client.js";
import { Auth, ensureSetupCode } from "./auth.js";
import { BackupError, type BackupDriver } from "./backup.js";
import { APP_CSS, APP_JS } from "./assets.js";
import type { Config } from "./config.js";
import { DockerError, type DockerDriver } from "./docker.js";
import { Fixes, OpsError } from "./fixes.js";
import { Health, loadServices, type ReadyProbe, type Snapshot } from "./health.js";
import { maskSecrets } from "./mask.js";
import { esc, mdToHtml } from "./md.js";
import { RateLimiter } from "./ratelimit.js";
import { Releases } from "./releases.js";
import { OpsLog } from "./store.js";
import * as ui from "./ui.js";

export interface AppDeps {
  cfg: Config; docker: DockerDriver; backup: BackupDriver; api: ApiClient;
  probe?: ReadyProbe; now?: () => number; telegram?: AlertChannel | null;
  certProbe?: (host: string) => Promise<number | null>; pollMs?: number;
}

const withConfirm = <T extends z.ZodRawShape>(o: z.ZodObject<T>) => o.extend({ confirm: z.string().optional() });
const parseCookie = (h: string | undefined, name: string) => h?.split(";").map((x) => x.trim()).find((x) => x.startsWith(name + "="))?.slice(name.length + 1);

export function buildApp(d: AppDeps) {
  const { cfg } = d;
  const app: FastifyInstance = Fastify({ logger: false, trustProxy: true, bodyLimit: 64 * 1024 });
  const now = d.now ?? Date.now;
  const auth = new Auth(cfg.stateDir, now);
  const log = new OpsLog(cfg.stateDir);
  const releases = new Releases(cfg.stateDir, d.docker, cfg.keepReleases, cfg.releaseRepos);
  const services = () => loadServices(cfg.servicesFile);
  const health = new Health({ docker: d.docker, backup: d.backup, api: d.api, services, procDir: cfg.procDir, filesDir: cfg.filesDir, stateDir: cfg.stateDir, opsHost: cfg.opsHost, probe: d.probe, now, certProbe: d.certProbe });
  const fixes = new Fixes({ cfg, docker: d.docker, backup: d.backup, api: d.api, health, releases, log, services, pollMs: d.pollMs, defer: (fn) => void setTimeout(fn, 800) });
  const tg = d.telegram !== undefined ? d.telegram : cfg.telegramToken && cfg.telegramChat ? new TelegramChannel(cfg.telegramToken, cfg.telegramChat) : null;
  const sender = new AlertSender(tg, new FileChannel(cfg.alertsLogFile, now));
  const alerts = new AlertEngine({ rules: () => loadAlertRules(cfg.alertsFile), sender, stateDir: cfg.stateDir, link: cfg.opsHost ? `https://${cfg.opsHost}/` : "the ops desk", now });
  const setupCode = ensureSetupCode(cfg.stateDir, cfg.setupCode);
  const loginLimit = new RateLimiter(10, 60_000, now);
  const apiLimit = new RateLimiter(600, 60_000, now);
  const setupSessions = new Map<string, number>(); // setup cookie -> expiry

  // Short memo: a phone refreshing every 10 s must not hammer Docker.
  let memo: { at: number; p: Promise<Snapshot> } | null = null;
  const snapshot = (fresh = false) => {
    if (!fresh && memo && now() - memo.at < 2000) return memo.p;
    memo = { at: now(), p: health.snapshot() };
    return memo.p;
  };

  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_r, body, done) => done(null, Object.fromEntries(new URLSearchParams(body as string))));
  app.addHook("onSend", async (_req, reply) => {
    reply.header("cache-control", "no-store");
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("content-security-policy", "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  });

  const OPEN = new Set(["/healthz", "/assets/app.css", "/assets/app.js", "/login", "/setup", "/setup/confirm"]);
  const token = (req: FastifyRequest) => parseCookie(req.headers.cookie, "ops_session");
  const isApiPath = (u: string) => u.startsWith("/ops/");

  app.addHook("onRequest", async (req, reply) => {
    const p = req.url.split("?")[0]!;
    if (OPEN.has(p)) return;
    if (!auth.verifySession(token(req))) {
      if (isApiPath(p)) return reply.code(401).send({ ok: false, error: "Please log in first. Open the desk in your browser and log in with your password and 6-digit code." });
      return reply.redirect("/login");
    }
    if (!apiLimit.take(`ip:${req.ip}`)) return reply.code(429).header("retry-after", "30").send({ ok: false, error: "Too many presses too fast. Wait half a minute." });
    if (req.method === "POST" && p !== "/logout" && req.headers["x-ops"] !== "1") return reply.code(403).send({ ok: false, error: "This request did not come from the desk page. Reload the desk and press the button again." });
  });

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, req, reply) => {
    let status = 500, msg: string, extra: Record<string, unknown> = {};
    if (err instanceof OpsError) { status = err.status; msg = err.message; extra = err.extra; }
    else if (err instanceof BackupError) { status = 503; msg = err.message; }
    else if (err instanceof DockerError) { status = 502; msg = err.message; }
    else if (err instanceof z.ZodError) { status = 400; msg = `That was not filled in correctly: ${err.issues[0]?.path.join(".") || "value"} ${err.issues[0]?.message}. Nothing was changed.`; }
    else if (err.statusCode && err.statusCode < 500) { status = err.statusCode; msg = "The desk did not understand that request. Reload the page and try again."; }
    else msg = `The desk hit a problem it did not expect (${maskSecrets(err.message).slice(0, 200)}). Press the button once more; if it fails again, look at History.`;
    if (isApiPath(req.url) || req.headers.accept?.includes("json")) return reply.code(status).send({ ok: false, error: msg, ...extra });
    return reply.code(status).type("text/html").send(ui.errorPage(msg));
  });

  const html = (reply: FastifyReply, body: string, code = 200) => reply.code(code).type("text/html; charset=utf-8").send(body);
  const who = () => "owner";
  const act = <T>(req: FastifyRequest, name: string, target: string | undefined, fn: () => Promise<T>) => fixes.run(who(), name, target, fn);

  // ---------- open ----------
  app.get("/healthz", async () => ({ ok: true }));
  app.get("/assets/app.css", async (_q, r) => r.type("text/css").send(APP_CSS));
  app.get("/assets/app.js", async (_q, r) => r.type("application/javascript").send(APP_JS));

  app.get("/login", async (req, reply) => {
    if (!auth.hasAccount()) return reply.redirect("/setup");
    return html(reply, ui.loginPage());
  });
  app.post("/login", async (req, reply) => {
    const b = (req.body ?? {}) as { password?: string; code?: string };
    const wantsJson = req.headers.accept?.includes("json");
    const fail = (code: number, msg: string) => (wantsJson ? reply.code(code).send({ ok: false, error: msg }) : html(reply, ui.loginPage(msg), code));
    if (!loginLimit.take(`login:${req.ip}`)) return fail(429, `Too many tries from this phone. Wait ${loginLimit.retryAfterS(`login:${req.ip}`)} seconds.`);
    const r = auth.login(String(b.password ?? ""), String(b.code ?? ""));
    log.add({ who: "login", action: "login", result: r.ok ? "ok" : "refused", note: r.ok ? undefined : r.reason });
    if (!r.ok) return fail(r.reason === "locked" ? 423 : 401, r.message);
    reply.header("set-cookie", `ops_session=${r.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${12 * 3600}${cfg.secureCookie ? "; Secure" : ""}`);
    return wantsJson ? { ok: true } : reply.redirect("/");
  });
  app.get("/logout", async (req, reply) => {
    auth.logout(token(req));
    reply.header("set-cookie", `ops_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${cfg.secureCookie ? "; Secure" : ""}`);
    return reply.redirect("/login");
  });

  // first-time enrolment: only while no login exists, and only with the setup code
  app.get("/setup", async (_q, reply) => (auth.hasAccount() ? reply.redirect("/login") : html(reply, ui.setupPage())));
  app.post("/setup", async (req, reply) => {
    if (auth.hasAccount()) return reply.redirect("/login");
    const b = (req.body ?? {}) as { setup?: string; password?: string };
    if (!loginLimit.take(`setup:${req.ip}`)) return html(reply, ui.setupPage("Too many tries. Wait a minute."), 429);
    const a = Buffer.from(String(b.setup ?? "")), c = Buffer.from(setupCode);
    if (a.length !== c.length || !crypto.timingSafeEqual(a, c)) return html(reply, ui.setupPage("That setup code is wrong."), 401);
    try {
      const s = auth.beginSetup(String(b.password ?? ""));
      const sid = crypto.randomBytes(18).toString("base64url");
      setupSessions.set(sid, now() + 15 * 60_000);
      reply.header("set-cookie", `ops_setup=${sid}; HttpOnly; SameSite=Strict; Path=/setup; Max-Age=900${cfg.secureCookie ? "; Secure" : ""}`);
      return html(reply, ui.setupStep2(s.secret, s.otpauth, s.backupCodes));
    } catch (e) { return html(reply, ui.setupPage((e as Error).message), 400); }
  });
  app.post("/setup/confirm", async (req, reply) => {
    const sid = parseCookie(req.headers.cookie, "ops_setup");
    if (auth.hasAccount() || !sid || (setupSessions.get(sid) ?? 0) < now()) return html(reply, ui.setupPage("Start the setup again."), 400);
    if (!loginLimit.take(`setup:${req.ip}`)) return html(reply, ui.setupPage("Too many tries. Wait a minute."), 429);
    const code = String(((req.body ?? {}) as { code?: string }).code ?? "");
    if (!auth.confirmSetup(code)) return html(reply, ui.setupPage("That code was wrong, so setup was not finished. Start again; new backup codes will be made."), 400);
    setupSessions.delete(sid);
    log.add({ who: "setup", action: "login created", result: "ok" });
    return reply.redirect("/login");
  });

  // ---------- pages ----------
  app.get("/", async (_q, reply) => {
    const snap = await snapshot(true);
    return html(reply, ui.dashboard({ snap, releases: await releases.list().catch(() => []), current: releases.current(), alertChannel: sender.channel }));
  });
  app.get("/ui/lights", async (_q, reply) => html(reply, ui.lightsFragment(await snapshot())));
  app.get("/logs/:name", async (req, reply) => {
    const { name } = req.params as { name: string };
    const { tail } = LogsQuerySchema.parse(req.query);
    const r = await fixes.logs(name, Math.min(tail, 2000));
    return html(reply, ui.logsPage(name, r.text, r.tail));
  });
  app.get("/disk", async (_q, reply) => { const p = fixes.planClear(); return html(reply, ui.diskPage(p.items, p.total_bytes)); });
  app.get("/history", async (_q, reply) => html(reply, ui.historyPage(log.recent(200))));

  // ---------- D10 ----------
  app.get("/ops/status", async (): Promise<OpsStatus & Record<string, unknown>> => {
    const snap = await snapshot(true);
    const m = snap.metrics, b = snap.backup;
    const out = {
      release: releases.current() ?? "dev",
      services: snap.services,
      backups: {
        db_wal_age_s: m.wal_age_s ?? 999_999, files_age_min: m.files_age_min ?? 999_999,
        last_drill: b?.drill ? `${b.drill.at.slice(0, 10)} ${b.drill.result}` : "never",
      },
      disk: { used_pct: m.disk_used_pct ?? 0 },
      cert_days_left: m.cert_days_left ?? -1,
      alerts: { channel: sender.channel },
      generated_at: new Date(now()).toISOString(),
    };
    OpsStatusSchema.parse(out);
    return out;
  });
  app.post("/ops/services/:name/restart", async (req) => { const { name } = req.params as { name: string }; return act(req, "restart", name, () => fixes.restart(name)); });
  app.get("/ops/services/:name/logs", async (req) => {
    const { name } = req.params as { name: string };
    const { tail } = LogsQuerySchema.parse(req.query);
    return fixes.logs(name, Math.min(tail, 2000));
  });
  app.post("/ops/jobs/retry", async (req) => act(req, "retry failed jobs", undefined, () => fixes.retryJobs(JobsRetryBodySchema.parse(req.body ?? {}))));
  app.post("/ops/queues/:name/pause", async (req) => { const { name } = req.params as { name: string }; return act(req, "pause queue", name, () => fixes.setPaused(name, true)); });
  app.post("/ops/queues/:name/resume", async (req) => { const { name } = req.params as { name: string }; return act(req, "resume queue", name, () => fixes.setPaused(name, false)); });
  app.post("/ops/releases/:tag/rollback", async (req) => {
    const { tag } = req.params as { tag: string };
    const b = withConfirm(z.object({})).parse(req.body ?? {});
    return act(req, "rollback", tag, () => fixes.rollback(tag, b.confirm));
  });
  app.post("/ops/backups/run", async (req) => act(req, "back up now", undefined, () => fixes.backupNow()));
  app.post("/ops/backups/verify", async (req) => act(req, "verify backups", undefined, () => fixes.verifyBackups()));
  app.post("/ops/db/restore", async (req) => {
    const b = withConfirm(DbRestoreBodySchema).parse(req.body ?? {});
    return act(req, "restore database", b.to, () => fixes.restoreDb(b.to, b.confirm));
  });
  app.post("/ops/db/restore/:id/switch", async (req) => {
    const { id } = req.params as { id: string };
    const b = withConfirm(z.object({})).parse(req.body ?? {});
    return act(req, "switch database", id, () => fixes.switchDb(id, b.confirm));
  });
  app.post("/ops/files/restore", async (req) => {
    const b = withConfirm(FilesRestoreBodySchema).parse(req.body ?? {});
    return act(req, "restore files", `${b.scope} @ ${b.at}`, () => fixes.restoreFiles(b.scope, b.at, b.confirm));
  });
  app.get("/ops/log", async (req, reply) => {
    const rows = log.recent(200);
    if ((req.query as { html?: string }).html || req.headers.accept?.includes("text/html")) return html(reply, ui.historyPage(rows));
    return { entries: rows };
  });
  app.get("/ops/build", async (_q, reply) => {
    let md: string;
    try { md = fs.readFileSync(cfg.statusMdFile, "utf8"); } catch { return html(reply, ui.buildPage(`<div class="card red">The build clock file (${esc(cfg.statusMdFile)}) is not mounted into the desk, so it cannot be shown.</div>`)); }
    return html(reply, ui.buildPage(mdToHtml(maskSecrets(md))));
  });

  // ---------- extra buttons ----------
  app.post("/ops/restart-all", async (req) => act(req, "restart everything", undefined, () => fixes.restartAll()));
  app.post("/ops/up", async (req) => act(req, "bring everything up", undefined, () => fixes.pullUp()));
  app.get("/ops/disk/plan", async () => fixes.planClear());
  app.post("/ops/disk/clear", async (req) => { const b = withConfirm(z.object({})).parse(req.body ?? {}); return act(req, "free disk space", undefined, () => fixes.clearDisk(b.confirm)); });
  app.get("/ops/releases", async () => ({ current: releases.current(), kept: await releases.list() }));
  app.post("/ops/alerts/test", async (req) => act(req, "test alert", undefined, async () => ({ ok: true as const, ...(await alerts.test()) })));

  return { app, auth, health, fixes, alerts, log, releases, snapshot, setupCode };
}
