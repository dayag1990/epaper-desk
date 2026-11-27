import { describe, expect, it } from "vitest";
import { cookieFrom, signSso, ssoClearCookie, ssoEnabled, ssoSetCookie, verifySso } from "../src/index.js";

const SECRET = "dummy-secret-for-tests-only-0000";
const T0 = 1_800_000_000_000;
const who = { uid: "u1", email: "owner@example.test", owner: true };

describe("sso cookie", () => {
  it("round-trips claims and expires after 12 hours", () => {
    const t = signSso(SECRET, who, T0);
    expect(verifySso(SECRET, t, T0 + 1000)).toMatchObject(who);
    expect(verifySso(SECRET, t, T0 + 12 * 3600_000 - 1000)).not.toBeNull();
    expect(verifySso(SECRET, t, T0 + 12 * 3600_000 + 1000)).toBeNull();
  });
  it("refuses a wrong secret, a changed body, a changed signature and junk", () => {
    const t = signSso(SECRET, who, T0);
    expect(verifySso("another-dummy-secret-1234", t, T0)).toBeNull();
    const [b, s] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...who, owner: true, uid: "u2", exp: 9e9 })).toString("base64url");
    expect(verifySso(SECRET, `${forged}.${s}`, T0)).toBeNull();
    expect(verifySso(SECRET, `${b}.${s}x`, T0)).toBeNull();
    for (const j of ["", "a", "a.b", "a.b.c", undefined, null]) expect(verifySso(SECRET, j as string, T0)).toBeNull();
  });
  it("is off without a real secret", () => {
    expect(ssoEnabled(undefined)).toBe(false);
    expect(ssoEnabled("short")).toBe(false);
    expect(() => signSso("", who)).toThrow();
    expect(verifySso(undefined, signSso(SECRET, who, T0), T0)).toBeNull();
  });
  it("builds the Set-Cookie lines", () => {
    expect(ssoSetCookie("v", { secure: true, domain: "example.test" })).toBe("epaper_sso=v; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200; Domain=example.test; Secure");
    expect(ssoClearCookie({ secure: false })).toContain("Max-Age=0");
    expect(cookieFrom("a=1; epaper_sso=xyz; b=2", "epaper_sso")).toBe("xyz");
  });
});
