import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";
import { FakeApi, FakeBackup, FakeDocker } from "../src/fakes.js";
import type { ReadyProbe } from "../src/health.js";
import { totpAt } from "../src/totp.js";
import type { AlertChannel } from "../src/alerts.js";

export const REPO_OPS = path.resolve(__dirname, "../../../ops");
export const PASSWORD = "correct horse battery staple";

export function tmp(prefix = "ops-test-"): string { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

export function mkCfg(over: Record<string, string> = {}): { cfg: Config; root: string } {
  const root = tmp();
  const proc = path.join(root, "proc"); fs.mkdirSync(proc);
  fs.writeFileSync(path.join(proc, "meminfo"), "MemTotal: 1000000 kB\nMemAvailable: 600000 kB\n");
  fs.writeFileSync(path.join(proc, "loadavg"), "0.10 0.10 0.10 1/100 1\n");
  const files = path.join(root, "files"); fs.mkdirSync(files);
  const cfg = loadConfig({
    FILES_ROOT: files, OPS_STATE_DIR: path.join(root, "state"), OPS_PROC_DIR: proc, OPS_SERVICES_FILE: path.join(REPO_OPS, "services.yml"),
    OPS_ALERTS_FILE: path.join(REPO_OPS, "alerts.yml"), OPS_STATUS_MD: path.join(root, "STATUS.md"), OPS_ALERTS_LOG: path.join(files, "alerts.log"),
    OPS_INSECURE_COOKIE: "1", OPS_HEALTH_WAIT_MS: "300", OPS_HOST: "", OPS_SETUP_CODE: "setup-123", ...over,
  });
  return { cfg, root };
}

export const SERVICES = ["api", "worker", "postgres", "ops", "caddy"];

export function mkStack(opts: { cfgOver?: Record<string, string>; telegram?: AlertChannel | null } = {}) {
  const { cfg, root } = mkCfg(opts.cfgOver);
  const docker = new FakeDocker(SERVICES);
  const backup = new FakeBackup();
  const api = new FakeApi();
  const down = new Set<string>(); // urls that fail
  const probe: ReadyProbe = async (url) => {
    if (down.has(url)) return { error: "cannot connect" };
    const host = /\/\/([^:/]+)/.exec(url)?.[1] ?? "";
    if (docker.stayBroken.has(host)) return { status: 503, body: { ok: false, checks: { db: "timeout after 5 s" } } };
    return { status: 200, body: { ok: true } };
  };
  let t = Date.now();
  const clock = { now: () => t, advance: (ms: number) => { t += ms; } };
  const built = buildApp({ cfg, docker, backup, api, probe, now: clock.now, telegram: opts.telegram ?? null, certProbe: async () => 60, pollMs: 5 });
  return { ...built, cfg, root, docker, backup, api, down, clock, probe };
}
export type Stack = ReturnType<typeof mkStack>;

/** Make the one account directly (setup flow itself is tested separately) and log in. Returns the cookie header. */
export async function loginCookie(s: Stack, nowMs = s.clock.now()): Promise<string> {
  if (!s.auth.hasAccount()) {
    const su = s.auth.beginSetup(PASSWORD);
    s.auth.confirmSetup(totpAt(su.secret, nowMs));
    (s as unknown as { _secret: string })._secret = su.secret;
    (s as unknown as { _codes: string[] })._codes = su.backupCodes;
  }
  const secret = (s as unknown as { _secret: string })._secret;
  // next 30 s step so the enrolment code is not reused
  s.clock.advance(31_000);
  const r = await s.app.inject({ method: "POST", url: "/login", headers: { accept: "application/json" }, payload: { password: PASSWORD, code: totpAt(secret, s.clock.now()) } });
  if (r.statusCode !== 200) throw new Error(`login failed ${r.statusCode} ${r.body}`);
  return String(r.headers["set-cookie"]).split(";")[0]!;
}
export const post = (s: Stack, cookie: string, url: string, payload: unknown = {}) =>
  s.app.inject({ method: "POST", url, payload: payload as object, headers: { cookie, "x-ops": "1", accept: "application/json" } });
export const get = (s: Stack, cookie: string, url: string) => s.app.inject({ method: "GET", url, headers: { cookie, accept: "application/json" } });
