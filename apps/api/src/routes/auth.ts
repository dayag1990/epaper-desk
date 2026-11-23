import { z } from "zod";
import { prisma } from "../db.js";
import { allow } from "../lib/ratelimit.js";
import { audit, COOKIE, listMyPapers, hashPassword, hashToken, newToken, requireRole, sessionExpiry, verifyPassword } from "../auth.js";
import { ApiError } from "../errors.js";
import { aiOnFor } from "./content.js";
import type { App } from "./types.js";

const tooMany = () => new ApiError(429, "too_many", "Too many tries. Wait a minute and try again.");
const Role = z.enum(["owner", "editor", "sub", "designer", "viewer"]);

export function authRoutes(app: App) {
  app.post("/v1/auth/login", {
    schema: { tags: ["auth"], body: z.object({ email: z.string().email(), password: z.string().min(1), paper: z.string().optional() }) },
  }, async (req, reply) => {
    const { email, password, paper } = req.body;
    const bad = new ApiError(401, "bad_login", "That email and password do not match.");
    if (!allow(`login:${req.ip}:${email.toLowerCase()}`, 20)) throw tooMany();
    const user = await prisma.user.findFirst({ where: { email: email.toLowerCase(), deleted_at: null } });
    if (!user || !(await verifyPassword(user.pw_hash, password))) throw bad;
    // Active memberships only. With no paper given: the oldest membership. A paper the user does not belong to
    // fails exactly like a wrong password, so a login never reveals which other papers exist or which the user has.
    const mine = await prisma.membership.findMany({ where: { user_id: user.id, deleted_at: null }, orderBy: { created_at: "asc" } });
    const live = await prisma.paper.findMany({ where: { id: { in: mine.map((x) => x.paper_id) }, deleted_at: null } });
    const ok = mine.filter((x) => live.some((p) => p.id === x.paper_id && (!paper || p.slug === paper)));
    const m = ok[0];
    if (!m) throw bad;
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
    const paper = await prisma.paper.findUnique({ where: { id: p.paper_id }, select: { id: true, slug: true, name: true, lang: true, script: true } });
    return { paper, role: p.role, user_id: p.user_id, papers: p.user_id ? await listMyPapers(p.user_id, p.paper_id) : [] };
  });

  // ---- which papers can I switch to (only ones I am an active member of) ----
  app.get("/v1/me/papers", { schema: { tags: ["auth"] }, preHandler: requireRole() }, async (req) => {
    const p = req.principal!;
    return { items: p.user_id ? await listMyPapers(p.user_id, p.paper_id) : [] };
  });

  // ---- move my session to another paper I belong to ----
  // Safer choice: issue a NEW session token for the new paper and revoke the old one, so the old cookie value
  // can never be replayed (not for the old paper, not for the new one). The cookie keeps its httpOnly/lax flags.
  app.post("/v1/auth/switch", {
    schema: { tags: ["auth"], body: z.object({ paper: z.string().min(1).max(100) }) },
    preHandler: requireRole(),
  }, async (req, reply) => {
    const p = req.principal!;
    if (p.kind !== "user" || !p.user_id) throw new ApiError(403, "forbidden", "API keys cannot switch papers.");
    if (!allow(`switch:${p.user_id}`, 20)) throw tooMany();
    const noAccess = new ApiError(403, "no_access", "You do not have access to that paper.");
    const target = await prisma.paper.findFirst({ where: { slug: req.body.paper, deleted_at: null } });
    if (!target || target.deleted_at) throw noAccess;
    const m = await prisma.membership.findFirst({ where: { user_id: p.user_id, paper_id: target.id, deleted_at: null } });
    if (!m || m.deleted_at) throw noAccess;
    if (target.id !== p.paper_id) {
      const token = newToken();
      await prisma.session.create({ data: { token_hash: hashToken(token), user_id: p.user_id, paper_id: target.id, expires_at: sessionExpiry() } });
      await prisma.session.updateMany({ where: { token_hash: hashToken(req.cookies[COOKIE]!) }, data: { revoked_at: new Date() } });
      await audit(p.paper_id, p.user_id, "switch.away", "session", null, null, { to: target.slug });
      await audit(target.id, p.user_id, "switch.in", "session", null, { from: p.paper_id }, null);
      reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", secure: req.protocol === "https", expires: sessionExpiry() });
    }
    const u = await prisma.user.findUnique({ where: { id: p.user_id } });
    const papers = await listMyPapers(p.user_id, target.id);
    return {
      user: { id: p.user_id, name: u?.name ?? "", email: u?.email }, role: m.role, ai_enabled: await aiOnFor(target.id), papers,
      paper: { slug: target.slug, name: target.name, lang: target.lang, script: target.script },
    };
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
