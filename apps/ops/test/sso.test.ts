import fs from "node:fs";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { SSO_COOKIE, signSso } from "@epaper/sso";
import { totpAt } from "../src/totp.js";
import { PASSWORD, loginCookie, mkStack, type Stack } from "./helpers.js";

const SECRET = "dummy-sso-secret-for-tests-only";
const OWNER = { uid: "u-owner", email: "olga@paper.test", owner: true };
const sso = (s: Stack, c = OWNER, secret = SECRET) => `${SSO_COOKIE}=${signSso(secret, c, s.clock.now())}`;
const enrol = (s: Stack) => {
  const su = s.auth.beginSetup(PASSWORD);
  s.auth.confirmSetup(totpAt(su.secret, s.clock.now()));
  s.clock.advance(31_000);
  return su.secret;
};
const stack = (over: Record<string, string> = {}) => mkStack({ cfgOver: { SSO_SECRET: SECRET, ...over } });
const get = (s: Stack, url: string, cookie = "", headers: Record<string, string> = {}) => s.app.inject({ method: "GET", url, headers: { cookie, ...headers } });
const setCookies = (r: { headers: Record<string, unknown> }) => ([] as string[]).concat((r.headers["set-cookie"] as string | string[] | undefined) ?? []);

describe("one login: newsroom sign-in, then the 6-digit code once", () => {
  it("an owner with the shared cookie is sent to the code step, not to a password page, and the desk opens after the code", async () => {
    const s = stack(); const secret = enrol(s);
    const r = await get(s, "/", sso(s));
    expect(r.statusCode).toBe(302); expect(r.headers.location).toBe("/stepup");
    const page = await get(s, "/stepup", sso(s));
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("olga@paper.test"); expect(page.body).toContain("6-digit code"); expect(page.body).not.toContain('type="password"');
    const go = await s.app.inject({ method: "POST", url: "/stepup", headers: { cookie: sso(s), "content-type": "application/x-www-form-urlencoded" }, payload: `code=${totpAt(secret, s.clock.now())}` });
    expect(go.statusCode).toBe(302); expect(go.headers.location).toBe("/");
    const ops = String(go.headers["set-cookie"]).split(";")[0]!;
    const desk = await get(s, "/", `${ops}; ${sso(s)}`);
    expect(desk.statusCode).toBe(200);
    expect(desk.body).toContain("olga@paper.test"); // the top bar names the signed-in person
    expect(desk.body).toContain("Sign out");
  });
  it("the code works once; a wrong code is refused in plain words; five wrong ones lock (same lock as the desk login)", async () => {
    const s = stack(); const secret = enrol(s);
    const code = totpAt(secret, s.clock.now());
    const post = (c: string) => s.app.inject({ method: "POST", url: "/stepup", headers: { cookie: sso(s), accept: "application/json", "content-type": "application/json" }, payload: { code: c } });
    expect((await post(code)).statusCode).toBe(200);
    const again = await post(code);
    expect(again.statusCode).toBe(401);
    expect(again.json().error).toMatch(/6-digit code is wrong/);
    for (let i = 0; i < 4; i++) await post("000000");
    s.clock.advance(31_000);
    const locked = await post(totpAt(secret, s.clock.now()));
    expect(locked.statusCode).toBe(423);
    expect(locked.json().error).toMatch(/locked/);
  });
  it("a session made this way ends with the newsroom sign-in: without the shared cookie the desk asks again", async () => {
    const s = stack(); const secret = enrol(s);
    const go = await s.app.inject({ method: "POST", url: "/stepup", headers: { cookie: sso(s), accept: "application/json", "content-type": "application/json" }, payload: { code: totpAt(secret, s.clock.now()) } });
    const ops = String(go.headers["set-cookie"]).split(";")[0]!;
    expect((await get(s, "/", `${ops}; ${sso(s)}`)).statusCode).toBe(200);
    const signedOutElsewhere = await get(s, "/", ops);
    expect(signedOutElsewhere.statusCode).toBe(302); expect(signedOutElsewhere.headers.location).toBe("/login");
    expect((await get(s, "/ops/status", ops, { accept: "application/json" })).statusCode).toBe(401);
    // another person's sign-in cannot ride on this session
    const other = await get(s, "/", `${ops}; ${sso(s, { ...OWNER, uid: "someone-else" })}`);
    expect(other.statusCode).toBe(302);
  });
  it("refuses non-owners, a wrong secret, a forged or expired cookie, and a person off the allow-list", async () => {
    const s = stack({ OPS_OWNER_EMAILS: "olga@paper.test" }); const secret = enrol(s);
    for (const c of [sso(s, { ...OWNER, owner: false }), sso(s, OWNER, "another-dummy-secret-1234"), `${SSO_COOKIE}=abc.def`, sso(s, { ...OWNER, email: "mallory@paper.test" }),
      `${SSO_COOKIE}=${signSso(SECRET, { ...OWNER, exp: Math.floor(s.clock.now() / 1000) - 5 }, s.clock.now())}`]) {
      const r = await get(s, "/", c);
      expect(r.headers.location, c).toBe("/login");
      const p = await s.app.inject({ method: "POST", url: "/stepup", headers: { cookie: c, "content-type": "application/json" }, payload: { code: totpAt(secret, s.clock.now()) } });
      expect(p.statusCode, c).toBe(302); expect(p.headers.location).toBe("/login");
    }
    expect((await get(s, "/", sso(s))).headers.location).toBe("/stepup");
  });
  it("without SSO_SECRET the shared cookie means nothing and only the desk's own login works", async () => {
    const s = mkStack(); const secret = enrol(s);
    expect((await get(s, "/", sso(s))).headers.location).toBe("/login");
    expect((await s.app.inject({ method: "POST", url: "/stepup", headers: { cookie: sso(s), "content-type": "application/json" }, payload: { code: totpAt(secret, s.clock.now()) } })).headers.location).toBe("/login");
    expect((await get(s, "/ops/alerts/stream", sso(s))).statusCode).toBe(401);
  });
  it("break-glass: the desk's own login still works with SSO on, and with the API and database down (nothing here calls them)", async () => {
    const s = stack();
    s.docker.stop("api"); s.docker.stop("postgres");
    s.api.queueStats = async () => null;
    const cookie = await loginCookie(s);
    const r = await get(s, "/", cookie);
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("Desk login");
    expect(s.api.calls).toEqual([]);
    // and the newsroom path works just as well with the API stopped
    const secret = (s as unknown as { _secret: string })._secret;
    s.clock.advance(31_000);
    const go = await s.app.inject({ method: "POST", url: "/stepup", headers: { cookie: sso(s), accept: "application/json", "content-type": "application/json" }, payload: { code: totpAt(secret, s.clock.now()) } });
    expect(go.statusCode).toBe(200);
  });
  it("login page: offers the newsroom login when the cookie is there, explains how to get it when not", async () => {
    const s = stack(); enrol(s);
    expect((await get(s, "/login", sso(s))).body).toContain("Continue with this login");
    const none = (await get(s, "/login")).body;
    expect(none).toContain('type="password"'); expect(none).toContain("sign in there");
    const plain = mkStack(); enrol(plain);
    expect((await get(plain, "/login")).body).not.toContain("sign in there");
  });
  it("sign-out clears the desk cookie, the shared sign-in cookie and the API session cookie, and the login page signs the API out too", async () => {
    const s = stack({ OPS_INSECURE_COOKIE: "1" }); enrol(s);
    const r = await get(s, "/logout", sso(s));
    expect(r.headers.location).toBe("/login?out=1");
    const lines = setCookies(r);
    for (const name of ["ops_session", SSO_COOKIE, "epaper_session"]) expect(lines.find((l) => l.startsWith(name + "=")), name).toMatch(/Max-Age=0/);
    const page = await get(s, "/login?out=1");
    expect(page.body).toContain('data-signout="http://localhost:8100/v1/auth/logout"');
    expect(page.headers["content-security-policy"]).toContain("connect-src 'self' http://localhost:8100");
  });
  it("the top bar: links to the other apps, ops link for owners, no inline styles (the page security policy forbids them)", async () => {
    const s = stack(); const cookie = await loginCookie(s);
    const body = (await get(s, "/", cookie)).body;
    for (const t of ["Editor", "Admin", "Reader", "Ops desk"]) expect(body).toContain(`>${t}</a>`);
    expect(body).toContain('id="ep-bell-count"');
    expect(body).not.toMatch(/ style="/);
    expect(body).toContain('/assets/theme.css');
    const css = await get(s, "/assets/theme.css");
    expect(css.statusCode).toBe(200); expect(css.body).toContain("--proof: #E63B2E");
    expect((await get(s, "/assets/theme/live.js")).body).toContain("openStream");
  });
});

describe("alert stream: who may read it", () => {
  async function serve(s: Stack) { await s.app.listen({ port: 0, host: "127.0.0.1" }); return `http://127.0.0.1:${(s.app.server.address() as AddressInfo).port}`; }
  async function first(url: string, headers: Record<string, string>) {
    const ac = new AbortController();
    const res = await fetch(url, { headers, signal: ac.signal });
    if (!res.body || res.status !== 200) { ac.abort(); return { res, text: "" }; }
    const rd = res.body.getReader(); let text = "";
    for (let i = 0; i < 20 && !/event: snapshot/.test(text); i++) { const r = await Promise.race([rd.read(), new Promise<{ value?: undefined }>((ok) => setTimeout(() => ok({}), 200))]); if (r.value) text += new TextDecoder().decode(r.value); }
    ac.abort();
    return { res, text };
  }
  it("an owner's shared cookie is enough (no code needed for read-only alerts), from the known app origins only, with credentials CORS", async () => {
    const s = stack(); const base = await serve(s);
    const ok = await first(`${base}/ops/alerts/stream`, { cookie: sso(s), origin: "http://127.0.0.1:8100" });
    expect(ok.res.status).toBe(200);
    expect(ok.res.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:8100");
    expect(ok.res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(ok.res.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(ok.text).toContain("event: snapshot");
    const evil = await first(`${base}/ops/alerts/stream`, { cookie: sso(s), origin: "https://evil.example" });
    expect(evil.res.status).toBe(403); expect(evil.res.headers.get("access-control-allow-origin")).toBeNull();
    const nobody = await first(`${base}/ops/alerts/stream`, { origin: "http://127.0.0.1:8100" });
    expect(nobody.res.status).toBe(401);
    const editor = await first(`${base}/ops/alerts/stream`, { cookie: sso(s, { ...OWNER, owner: false }), origin: "http://127.0.0.1:8100" });
    expect(editor.res.status).toBe(401);
    await s.app.close();
  });
  it("the desk's own pages read it with the desk session", async () => {
    const s = stack(); const cookie = await loginCookie(s); const base = await serve(s);
    const r = await first(`${base}/ops/alerts/stream`, { cookie });
    expect(r.res.status).toBe(200); expect(fs.existsSync(s.cfg.stateDir)).toBe(true);
    await s.app.close();
  });
});
