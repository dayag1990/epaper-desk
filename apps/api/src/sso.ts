import type { FastifyReply, FastifyRequest } from "fastify";
import { SSO_COOKIE, signSso, ssoClearCookie, ssoEnabled, ssoSetCookie, verifySso } from "@epaper/sso";
import { prisma } from "./db.js";

/**
 * "One login": next to the API's own session cookie, the API sets a signed, HttpOnly sign-in cookie that the ops desk can check
 * on its own (no API, no Postgres). Without SSO_SECRET nothing is set and the ops desk keeps its own login only.
 */
const secret = () => process.env.SSO_SECRET;
const domain = () => process.env.SSO_COOKIE_DOMAIN || undefined;
export const ssoOn = () => ssoEnabled(secret());
const secure = (req: FastifyRequest) => req.protocol === "https";

/** Owners of at least one paper (not deleted). The ops desk only takes owners. */
export async function isOwnerAnywhere(user_id: string): Promise<boolean> {
  const ms = await prisma.membership.findMany({ where: { user_id, role: "owner", deleted_at: null } });
  if (!ms.length) return false;
  const papers = await prisma.paper.findMany({ where: { id: { in: ms.map((m: { paper_id: string }) => m.paper_id) }, deleted_at: null } });
  return papers.length > 0;
}

export async function setSsoCookie(req: FastifyRequest, reply: FastifyReply, user: { id: string; email: string }, owner?: boolean): Promise<void> {
  if (!ssoOn()) return;
  const isOwner = owner ?? (await isOwnerAnywhere(user.id));
  reply.header("set-cookie", ssoSetCookie(signSso(secret()!, { uid: user.id, email: user.email, owner: isOwner }), { secure: secure(req), domain: domain() }));
}

/** Sign out of everything that shares the browser's cookies: the sign-in cookie and the ops desk's own session cookie. */
export function clearSsoCookies(req: FastifyRequest, reply: FastifyReply): void {
  const o = { secure: secure(req), domain: domain() };
  reply.header("set-cookie", ssoClearCookie(o));
  if (o.domain) reply.header("set-cookie", ssoClearCookie({ secure: o.secure })); // a cookie from before the domain was set
  reply.header("set-cookie", `ops_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${o.secure ? "; Secure" : ""}`);
}

/** Keeps the cookie fresh while someone works: set again when missing, or when less than 6 hours are left. */
export async function refreshSso(req: FastifyRequest, reply: FastifyReply, user: { id: string; email?: string | null }): Promise<void> {
  if (!ssoOn() || !user.email) return;
  const c = verifySso(secret(), req.cookies?.[SSO_COOKIE], Date.now() + 6 * 3600_000);
  if (c && c.uid === user.id) return;
  await setSsoCookie(req, reply, { id: user.id, email: user.email });
}
