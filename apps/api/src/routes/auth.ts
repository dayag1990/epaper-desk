import { z } from "zod";
import { prisma } from "../db.js";
import { audit, COOKIE, hashPassword, hashToken, newToken, requireRole, sessionExpiry, verifyPassword } from "../auth.js";
import { ApiError } from "../errors.js";
import type { App } from "./types.js";

const Role = z.enum(["owner", "editor", "sub", "designer", "viewer"]);

export function authRoutes(app: App) {
  app.post("/v1/auth/login", {
    schema: { tags: ["auth"], body: z.object({ email: z.string().email(), password: z.string().min(1), paper: z.string().optional() }) },
  }, async (req, reply) => {
    const { email, password, paper } = req.body;
    const bad = new ApiError(401, "bad_login", "That email and password do not match.");
    const user = await prisma.user.findFirst({ where: { email: email.toLowerCase(), deleted_at: null } });
    if (!user || !(await verifyPassword(user.pw_hash, password))) throw bad;
    const ms = await prisma.membership.findMany({
      where: { user_id: user.id, deleted_at: null, paper: { deleted_at: null, ...(paper ? { slug: paper } : {}) } },
      orderBy: { created_at: "asc" },
    });
    const m = ms[0];
    if (!m) throw new ApiError(403, "no_paper", "You are not a member of that paper.");
    const token = newToken();
    await prisma.session.create({ data: { token_hash: hashToken(token), user_id: user.id, paper_id: m.paper_id, expires_at: sessionExpiry() } });
    await audit(m.paper_id, user.id, "login", "session", null, null, null);
    reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", secure: req.protocol === "https", expires: sessionExpiry() });
    return { ok: true, paper_id: m.paper_id, role: m.role };
  });

  app.post("/v1/auth/logout", { schema: { tags: ["auth"] } }, async (req, reply) => {
    const tok = req.cookies[COOKIE];
    if (tok) await prisma.session.updateMany({ where: { token_hash: hashToken(tok) }, data: { revoked_at: new Date() } });
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/v1/auth/me", { schema: { tags: ["auth"] }, preHandler: requireRole() }, async (req) => {
    const p = req.principal!;
    const paper = await prisma.paper.findUnique({ where: { id: p.paper_id }, select: { id: true, slug: true, name: true } });
    return { paper, role: p.role, user_id: p.user_id };
  });

  app.post("/v1/members", {
    schema: { tags: ["auth"], body: z.object({ email: z.string().email(), name: z.string().min(1), password: z.string().min(12, "at least 12 characters"), role: Role }) },
    preHandler: requireRole("owner"),
  }, async (req, reply) => {
    const p = req.principal!;
    const b = req.body;
    const email = b.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    const user = existing ?? (await prisma.user.create({ data: { email, name: b.name, pw_hash: await hashPassword(b.password) } }));
    await prisma.membership.upsert({
      where: { user_id_paper_id: { user_id: user.id, paper_id: p.paper_id } },
      create: { user_id: user.id, paper_id: p.paper_id, role: b.role },
      update: { role: b.role, deleted_at: null },
    });
    await audit(p.paper_id, p.user_id, "member.set", "membership", user.id, null, { role: b.role });
    return reply.status(201).send({ user_id: user.id, role: b.role });
  });
}
