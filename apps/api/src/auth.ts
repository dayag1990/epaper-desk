import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "@prisma/client";
import { prisma } from "./db.js";
import { config } from "./env.js";
import { forbidden, unauthorized } from "./errors.js";

export const COOKIE = "epaper_session";
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export const hashPassword = (pw: string) => argon2.hash(pw, { type: argon2.argon2id });
export const verifyPassword = (hash: string, pw: string) => argon2.verify(hash, pw).catch(() => false);

export interface Principal {
  kind: "user" | "apikey";
  paper_id: string; // always resolved from the session or key, never from the request
  user_id: string | null;
  role: Role | "source";
}
declare module "fastify" {
  interface FastifyRequest {
    principal?: Principal;
  }
}

export const WRITE_ROLES: Array<Role> = ["owner", "editor", "sub", "designer"];

export async function resolvePrincipal(req: FastifyRequest): Promise<Principal | null> {
  const tok = req.cookies[COOKIE];
  if (tok) {
    const s = await prisma.session.findUnique({ where: { token_hash: hashToken(tok) } });
    if (!s || s.revoked_at || s.expires_at < new Date()) return null;
    const m = await prisma.membership.findFirst({
      where: { user_id: s.user_id, paper_id: s.paper_id, deleted_at: null, paper: { deleted_at: null }, user: { deleted_at: null } },
    });
    if (!m) return null;
    return { kind: "user", paper_id: s.paper_id, user_id: s.user_id, role: m.role };
  }
  const key = req.headers["x-api-key"];
  if (typeof key === "string" && key) {
    const k = await prisma.apiKey.findUnique({ where: { key_hash: hashToken(key) } });
    if (!k || k.deleted_at) return null;
    await prisma.apiKey.update({ where: { id: k.id }, data: { last_used_at: new Date() } });
    return { kind: "apikey", paper_id: k.paper_id, user_id: null, role: "source" };
  }
  return null;
}

/** preHandler factory: signed in, and role in `roles` (omit = any signed-in user). */
export function requireRole(...roles: Array<Role | "source">) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const p = await resolvePrincipal(req);
    if (!p) throw unauthorized();
    if (roles.length && !roles.includes(p.role)) {
      throw forbidden(
        p.role === "viewer" ? "Viewers can look but not save. Ask an editor or the owner." : "Your role does not allow this.",
      );
    }
    req.principal = p;
  };
}

export const sessionExpiry = () => new Date(Date.now() + config.sessionDays * 86400_000);

export async function audit(
  paper_id: string,
  user_id: string | null,
  action: string,
  entity: string,
  entity_id: string | null,
  before: unknown,
  after: unknown,
) {
  await prisma.auditLog.create({
    data: { paper_id, user_id, action, entity, entity_id, before: (before ?? undefined) as any, after: (after ?? undefined) as any },
  });
}
