import crypto from "node:crypto";

/**
 * The shared sign-in cookie ("one login").
 *
 * The API signs it when someone logs in; the ops desk checks it WITHOUT calling the API or Postgres: an HMAC over the claims
 * with a secret both services have (env SSO_SECRET). It is a statement ("the API said this person is user X, an owner,
 * until time T"), never a password. The ops desk still asks for the 6-digit code once per ops session.
 */
export const SSO_COOKIE = "epaper_sso";
export const SSO_TTL_S = 12 * 3600;

export interface SsoClaims {
  /** user id */
  uid: string;
  email: string;
  /** owns at least one paper */
  owner: boolean;
  /** expiry, seconds since the epoch */
  exp: number;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (secret: string, body: string) => crypto.createHmac("sha256", secret).update(body).digest("base64url");

/** A secret shorter than 16 characters is treated as "not set" (a typo must not silently weaken the lock). */
export const ssoEnabled = (secret: string | undefined | null): secret is string => typeof secret === "string" && secret.length >= 16;

export function signSso(secret: string, c: Omit<SsoClaims, "exp"> & { exp?: number }, nowMs: number = Date.now()): string {
  if (!ssoEnabled(secret)) throw new Error("SSO_SECRET is not set (or shorter than 16 characters).");
  const claims: SsoClaims = { uid: c.uid, email: c.email, owner: c.owner, exp: c.exp ?? Math.floor(nowMs / 1000) + SSO_TTL_S };
  const body = b64(JSON.stringify(claims));
  return `${body}.${mac(secret, body)}`;
}

/** The claims when the signature is good and the time has not run out; otherwise null. Never throws. */
export function verifySso(secret: string | undefined | null, token: string | undefined | null, nowMs: number = Date.now()): SsoClaims | null {
  if (!ssoEnabled(secret) || !token) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const want = Buffer.from(mac(secret, body)), got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<SsoClaims>;
    if (typeof c.uid !== "string" || typeof c.email !== "string" || typeof c.owner !== "boolean" || typeof c.exp !== "number") return null;
    if (c.exp * 1000 <= nowMs) return null;
    return c as SsoClaims;
  } catch { return null; }
}

/** Value of one cookie from a raw Cookie header. */
export function cookieFrom(header: string | undefined, name: string): string | undefined {
  return header?.split(";").map((x) => x.trim()).find((x) => x.startsWith(name + "="))?.slice(name.length + 1);
}

export interface CookieOpts { secure: boolean; domain?: string; maxAgeS?: number }
/** Set-Cookie line for the sign-in cookie: HttpOnly, SameSite=Lax, whole site. `maxAgeS: 0` clears it. */
export function ssoSetCookie(value: string, o: CookieOpts): string {
  return `${SSO_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${o.maxAgeS ?? SSO_TTL_S}${o.domain ? `; Domain=${o.domain}` : ""}${o.secure ? "; Secure" : ""}`;
}
export const ssoClearCookie = (o: Omit<CookieOpts, "maxAgeS">) => ssoSetCookie("", { ...o, maxAgeS: 0 });
