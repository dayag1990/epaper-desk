import { describe, expect, it } from "vitest";
import { OPS_ROUTES } from "@epaper/core";
import { base32Decode, hotp, totpAt, verifyTotp } from "../src/totp.js";
import { PASSWORD, loginCookie, mkStack, post, get } from "./helpers.js";

describe("TOTP (RFC 6238)", () => {
  it("matches the RFC test vector", () => {
    // RFC 4226 appendix D: secret 12345678901234567890, counter 1 -> 287082
    expect(hotp(Buffer.from("12345678901234567890"), 1)).toBe("287082");
    expect(hotp(Buffer.from("12345678901234567890"), 0)).toBe("755224");
  });
  it("accepts one step of drift, refuses far-off and malformed codes", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const t = 1_700_000_000_000;
    expect(verifyTotp(secret, totpAt(secret, t), t)).not.toBeNull();
    expect(verifyTotp(secret, totpAt(secret, t - 30_000), t)).not.toBeNull();
    expect(verifyTotp(secret, totpAt(secret, t - 300_000), t)).toBeNull();
    expect(verifyTotp(secret, "12345", t)).toBeNull();
    expect(base32Decode(secret).length).toBe(10);
  });
});

describe("first-time setup", () => {
  it("needs the setup code, shows backup codes once, needs a right TOTP to finish", async () => {
    const s = mkStack();
    const bad = await s.app.inject({ method: "POST", url: "/setup", payload: `setup=nope&password=${PASSWORD}`, headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(bad.statusCode).toBe(401);
    const ok = await s.app.inject({ method: "POST", url: "/setup", payload: `setup=setup-123&password=${encodeURIComponent(PASSWORD)}`, headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toMatch(/shown only this once/);
    expect(ok.body.match(/[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}/g)?.length).toBe(8);
    const setupCookie = String(ok.headers["set-cookie"]).split(";")[0]!;
    // a wrong code does not finish setup
    const wrong = await s.app.inject({ method: "POST", url: "/setup/confirm", payload: "code=000000", headers: { "content-type": "application/x-www-form-urlencoded", cookie: setupCookie } });
    expect(wrong.statusCode).toBe(400);
    expect(s.auth.hasAccount()).toBe(false);
    // backup codes are stored hashed, never in plain text
    const users = (await import("node:fs")).readFileSync(`${s.cfg.stateDir}/users.json`, "utf8");
    for (const c of ok.body.match(/[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}/g)!) expect(users).not.toContain(c);
    // no setup cookie: refused
    const noCookie = await s.app.inject({ method: "POST", url: "/setup/confirm", payload: "code=000000", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(noCookie.statusCode).toBe(400);
  });
  it("is closed once a login exists", async () => {
    const s = mkStack();
    await loginCookie(s);
    const r = await s.app.inject({ method: "POST", url: "/setup", payload: `setup=setup-123&password=${PASSWORD}`, headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(r.statusCode).toBe(302);
    expect((await s.app.inject({ method: "GET", url: "/setup" })).statusCode).toBe(302);
  });
});

describe("login", () => {
  const login = (s: ReturnType<typeof mkStack>, password: string, code: string, ip = "1.1.1.1") =>
    s.app.inject({ method: "POST", url: "/login", remoteAddress: ip, headers: { accept: "application/json" }, payload: { password, code } });

  it("refuses a wrong code and a wrong password in plain words", async () => {
    const s = mkStack();
    await loginCookie(s);
    const secret = (s as unknown as { _secret: string })._secret;
    const w1 = await login(s, PASSWORD, "000000");
    expect(w1.statusCode).toBe(401);
    expect(w1.json().error).toMatch(/password or the 6-digit code is wrong/);
    s.clock.advance(31_000);
    const w2 = await login(s, "not the password at all", totpAt(secret, s.clock.now()));
    expect(w2.statusCode).toBe(401);
    s.clock.advance(31_000);
    expect((await login(s, PASSWORD, totpAt(secret, s.clock.now()))).statusCode).toBe(200);
  });

  it("a TOTP code works once only", async () => {
    const s = mkStack();
    await loginCookie(s);
    const secret = (s as unknown as { _secret: string })._secret;
    s.clock.advance(31_000);
    const code = totpAt(secret, s.clock.now());
    expect((await login(s, PASSWORD, code)).statusCode).toBe(200);
    expect((await login(s, PASSWORD, code)).statusCode).toBe(401);
  });

  it("a backup code works exactly once", async () => {
    const s = mkStack();
    await loginCookie(s);
    const codes = (s as unknown as { _codes: string[] })._codes;
    expect((await login(s, PASSWORD, codes[0]!)).statusCode).toBe(200);
    expect((await login(s, PASSWORD, codes[0]!)).statusCode).toBe(401);
    expect((await login(s, PASSWORD, codes[1]!.toUpperCase().replace(/-/g, " "))).statusCode).toBe(200);
    expect(s.auth.backupCodesLeft()).toBe(6);
  });

  it("locks after 5 wrong tries, even for the right code, then frees after 15 minutes", async () => {
    const s = mkStack();
    await loginCookie(s);
    const secret = (s as unknown as { _secret: string })._secret;
    for (let i = 0; i < 5; i++) await login(s, PASSWORD, "000000", `9.9.9.${i}`);
    s.clock.advance(31_000);
    const locked = await login(s, PASSWORD, totpAt(secret, s.clock.now()), "9.9.9.99");
    expect(locked.statusCode).toBe(423);
    expect(locked.json().error).toMatch(/locked/);
    s.clock.advance(15 * 60_000 + 1000);
    expect((await login(s, PASSWORD, totpAt(secret, s.clock.now()), "9.9.9.98")).statusCode).toBe(200);
  });

  it("rate limits one address to 10 tries a minute", async () => {
    const s = mkStack();
    await loginCookie(s);
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await login(s, "x".repeat(12), "000000", "5.5.5.5")).statusCode);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
    expect(codes.slice(0, 2)).not.toContain(429);
  });
});

describe("nothing is reachable without login", () => {
  it("every D10 route and every page answers 401 / redirect with no session", async () => {
    const s = mkStack();
    await loginCookie(s);
    for (const [method, path] of OPS_ROUTES) {
      const url = path.replace(":name", "api").replace(":tag", "2026-11-21.1").replace(":id", "r1");
      const r = await s.app.inject({ method, url, payload: method === "POST" ? {} : undefined, headers: { "x-ops": "1", accept: "application/json" } });
      expect(r.statusCode, `${method} ${path}`).toBe(401);
    }
    for (const url of ["/", "/history", "/disk", "/logs/api", "/ui/lights", "/ops/restart-all", "/ops/up", "/ops/disk/clear", "/ops/alerts/test", "/ops/releases", "/ops/disk/plan"]) {
      for (const method of ["GET", "POST"] as const) {
        const r = await s.app.inject({ method, url, headers: { "x-ops": "1" } });
        expect([302, 401, 404], `${method} ${url} -> ${r.statusCode}`).toContain(r.statusCode);
        expect(r.statusCode === 404 && method === "GET" ? true : r.statusCode !== 200).toBe(true);
      }
    }
    expect(s.docker.calls).toEqual([]);
  });
  it("a forged or tampered cookie is not a login; only /healthz is open", async () => {
    const s = mkStack();
    const cookie = await loginCookie(s);
    const bad = cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect((await get(s, bad, "/ops/status")).statusCode).toBe(401);
    expect((await s.app.inject({ method: "GET", url: "/healthz" })).json()).toEqual({ ok: true });
    expect((await get(s, cookie, "/ops/status")).statusCode).toBe(200);
    // logout kills the session server-side
    await s.app.inject({ method: "GET", url: "/logout", headers: { cookie } });
    expect((await get(s, cookie, "/ops/status")).statusCode).toBe(401);
  });
  it("a button press without the desk's own header is refused (cross-site safety)", async () => {
    const s = mkStack();
    const cookie = await loginCookie(s);
    const r = await s.app.inject({ method: "POST", url: "/ops/services/api/restart", headers: { cookie } });
    expect(r.statusCode).toBe(403);
    expect(s.docker.calls).toEqual([]);
    expect((await post(s, cookie, "/ops/services/api/restart")).statusCode).toBe(200);
  });
});
