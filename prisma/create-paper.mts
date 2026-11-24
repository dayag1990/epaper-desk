// Create a paper (if its slug is free) and make existing accounts its owners. No password is read or changed.
//   PAPER_SLUG PAPER_NAME PAPER_LANG PAPER_SCRIPT [PAPER_W_MM PAPER_H_MM PAPER_TZ]  OWNER_EMAILS (comma separated, must exist)
// Run it through scripts/create-paper.sh. Safe to repeat: an existing paper is left as it is.
import { PrismaClient } from "@prisma/client";

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const pw = encodeURIComponent(process.env.POSTGRES_PASSWORD ?? "");
  return `postgresql://${process.env.POSTGRES_USER ?? "epaper"}:${pw}@${process.env.PGHOST ?? "postgres"}:5432/${process.env.POSTGRES_DB ?? "epaper"}`;
}
const fail = (msg: string): never => { console.error(msg); process.exit(1); };
const e = process.env;
const slug = (e.PAPER_SLUG ?? "").trim(), name = (e.PAPER_NAME ?? "").trim();
if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) fail("The paper's short name (slug) must be 2-41 letters, digits or dashes.");
if (!name) fail("Say the paper's name.");
const emails = (e.OWNER_EMAILS ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

const prisma = new PrismaClient({ datasourceUrl: databaseUrl() });
const users = [];
for (const email of emails) {
  const u = await prisma.user.findUnique({ where: { email } });
  if (!u) fail(`There is no account ${email} on this server. Nothing was changed.`);
  else users.push(u);
}
let paper = await prisma.paper.findFirst({ where: { slug, deleted_at: null } });
if (paper) console.log(`The paper "${slug}" already exists; left as it is.`);
else {
  paper = await prisma.paper.create({ data: { slug, name, lang: e.PAPER_LANG ?? "en", script: e.PAPER_SCRIPT ?? "Latn", page_w_mm: Number(e.PAPER_W_MM ?? 300), page_h_mm: Number(e.PAPER_H_MM ?? 450), tz: e.PAPER_TZ ?? "UTC" } });
  console.log(`Created paper "${slug}" (${name}).`);
}
for (const u of users) {
  await prisma.membership.upsert({
    where: { user_id_paper_id: { user_id: u.id, paper_id: paper.id } },
    create: { user_id: u.id, paper_id: paper.id, role: "owner" },
    update: { role: "owner", deleted_at: null },
  });
  await prisma.auditLog.create({ data: { paper_id: paper.id, user_id: u.id, action: "paper.create", entity: "paper", entity_id: paper.id } });
  console.log(`${u.email} is owner of ${slug}.`);
}
await prisma.$disconnect();
