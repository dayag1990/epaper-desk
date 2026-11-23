import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { totpAt } from "../src/totp.js";
import { PASSWORD, REPO_OPS, tmp } from "./helpers.js";

// A REAL ops process. Nothing it is told about (Docker, API, worker, Postgres) exists: all point at closed ports.
const PORT = 18000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${PORT}`;
let child: ChildProcess;
let out = "";
const root = tmp("ops-real-");

async function waitUp() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("ops did not start: " + out);
}

beforeAll(async () => {
  fs.mkdirSync(path.join(root, "files"), { recursive: true });
  child = spawn(process.execPath, ["--import", "tsx", path.resolve(HERE, "../src/server.ts")], {
    cwd: path.resolve(HERE, ".."),
    env: {
      PATH: process.env.PATH!, OPS_PORT: String(PORT), OPS_BIND: "127.0.0.1", FILES_ROOT: path.join(root, "files"), OPS_PROC_DIR: "/proc",
      OPS_SERVICES_FILE: path.join(REPO_OPS, "services.yml"), OPS_ALERTS_FILE: path.join(REPO_OPS, "alerts.yml"), OPS_INSECURE_COOKIE: "1", OPS_SETUP_CODE: "setup-xyz",
      DOCKER_HOST: "http://127.0.0.1:1", OPS_API_BASE: "http://127.0.0.1:2", OPS_SCRIPTS_DIR: path.join(root, "no-scripts"), OPS_STATUS_MD: path.join(root, "none.md"),
    },
  });
  child.stdout?.on("data", (d) => (out += d)); child.stderr?.on("data", (d) => (out += d));
  await waitUp();
}, 30_000);
afterAll(() => { child?.kill("SIGKILL"); });

describe("the real ops process, with API, worker, Postgres and Docker all unreachable", () => {
  it("starts, logs where its state lives, and answers /healthz", async () => {
    expect(out).toMatch(/plain JSON files/);
    expect(await (await fetch(`${base}/healthz`)).json()).toEqual({ ok: true });
  });
  it("shows the login page, refuses everything else, then after setup+login loads the desk with RED lights in plain words", async () => {
    const login = await fetch(`${base}/login`, { redirect: "manual" });
    expect([200, 302]).toContain(login.status);
    expect((await fetch(`${base}/ops/status`)).status).toBe(401);
    expect((await fetch(`${base}/`, { redirect: "manual" })).status).toBe(302);

    const form = { "content-type": "application/x-www-form-urlencoded" };
    const s1 = await fetch(`${base}/setup`, { method: "POST", headers: form, body: new URLSearchParams({ setup: "setup-xyz", password: PASSWORD }) });
    const html = await s1.text();
    const secret = /class="codes">([A-Z2-7]{32})</.exec(html)![1]!;
    const setupCookie = s1.headers.get("set-cookie")!.split(";")[0]!;
    const s2 = await fetch(`${base}/setup/confirm`, { method: "POST", headers: { ...form, cookie: setupCookie }, body: new URLSearchParams({ code: totpAt(secret, Date.now()) }), redirect: "manual" });
    expect(s2.status).toBe(302);

    // the enrolment code used step c; the code for the next step (c+1) is accepted by one step of drift
    const resp = await fetch(`${base}/login`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ password: PASSWORD, code: totpAt(secret, Date.now() + 30_000) }) });
    expect(resp.status).toBe(200);
    const cookie = resp.headers.get("set-cookie")!.split(";")[0]!;
    const st = await fetch(`${base}/ops/status`, { headers: { cookie } });
    expect(st.status).toBe(200);
    const j = (await st.json()) as { services: { name: string; state: string; last_error: string }[] };
    const api = j.services.find((x) => x.name === "api")!;
    expect(api.state).toBe("red");
    expect(api.last_error).toMatch(/cannot ask Docker|socket proxy/);
    const page = await (await fetch(`${base}/`, { headers: { cookie } })).text();
    expect(page).toMatch(/need[s]? you/);
    // the fix button answers in plain words even though Docker is out of reach
    const r = await fetch(`${base}/ops/services/api/restart`, { method: "POST", headers: { cookie, "x-ops": "1", accept: "application/json" } });
    expect(r.status).toBe(502);
    expect(((await r.json()) as { error: string }).error).toMatch(/socket proxy is not answering/);
  });
});
