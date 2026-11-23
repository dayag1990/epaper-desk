// Give an existing account a membership in another paper. Never touches the password; reads no secret.
//   GRANT_EMAIL  GRANT_PAPER (slug)  GRANT_ROLE (default owner). Run it through scripts/grant-paper.sh.
import { PrismaClient } from "@prisma/client";

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const pw = encodeURIComponent(process.env.POSTGRES_PASSWORD ?? "");
  return `postgresql://${process.env.POSTGRES_USER ?? "epaper"}:${pw}@${process.env.PGHOST ?? "postgres"}:5432/${process.env.POSTGRES_DB ?? "epaper"}`;
}
const fail = (msg: string): never => { console.error(msg); process.exit(1); };

const email = (process.env.GRANT_EMAIL ?? "").trim().toLowerCase();
const slug = (process.env.GRANT_PAPER ?? "").trim();
const role = (process.env.GRANT_ROLE ?? "owner").trim();
if (!["owner", "editor", "sub", "designer", "viewer"].includes(role)) fail("The role must be one of: owner, editor, sub, designer, viewer.");
if (!email || !slug) fail("Say which account (email) and which paper.");

const prisma = new PrismaClient({ datasourceUrl: databaseUrl() });
const user = await prisma.user.findFirst({ where: { email, deleted_at: null } });
if (!user) fail(`There is no account for ${email}. Create it first with scripts/create-admin.sh.`);
const paper = await prisma.paper.findFirst({ where: { slug, deleted_at: null } });
if (!paper) fail(`There is no paper called "${slug}" on this server.`);
await prisma.membership.upsert({
  where: { user_id_paper_id: { user_id: user!.id, paper_id: paper!.id } },
  create: { user_id: user!.id, paper_id: paper!.id, role: role as any },
  update: { role: role as any, deleted_at: null },
});
await prisma.auditLog.create({ data: { paper_id: paper!.id, user_id: user!.id, action: "admin.grant_paper", entity: "membership", entity_id: user!.id, after: { role } as any } });
console.log(`${email} now has the role ${role} in ${slug}. The password was not changed.`);
await prisma.$disconnect();
