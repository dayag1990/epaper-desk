// Create (or reset the password of) an owner/admin account for one OR SEVERAL papers.
// The password is read from STDIN, never from an argument or a file, so it does not show in `ps`,
// shell history, logs or chat. Run it through scripts/create-admin.sh, which asks for it at a hidden prompt.
//   ADMIN_EMAIL  (required)   ADMIN_PAPER (one slug, or a comma-separated list: "riverton-herald,thenpothigai")
//   ADMIN_NAME (optional, default "Admin")
// A paper in the list that does not exist yet is skipped with a note; at least one must exist. The account becomes
// owner in each paper that does.
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const pw = encodeURIComponent(process.env.POSTGRES_PASSWORD ?? "");
  return `postgresql://${process.env.POSTGRES_USER ?? "epaper"}:${pw}@${process.env.PGHOST ?? "postgres"}:5432/${process.env.POSTGRES_DB ?? "epaper"}`;
}
const fail = (msg: string): never => { console.error(msg); process.exit(1); };

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const password = raw.replace(/\r?\n$/, ""); // only the final newline; spaces inside a password are kept
const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
const slugs = [...new Set((process.env.ADMIN_PAPER ?? "").split(",").map((x) => x.trim()).filter(Boolean))];
const name = (process.env.ADMIN_NAME ?? "Admin").trim() || "Admin";

if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("That email address does not look right.");
if (!slugs.length) fail("Say which paper (or papers, separated by commas) the account is for.");
if (password.length < 12) fail("The password must be at least 12 characters.");
if (password.length > 200) fail("That password is too long (200 characters at most).");
if (password.toLowerCase().includes(email.split("@")[0]) && email.split("@")[0].length >= 4) fail("The password should not contain the name part of the email.");

const prisma = new PrismaClient({ datasourceUrl: databaseUrl() });
const papers = [];
for (const slug of slugs) {
  const found = await prisma.paper.findFirst({ where: { slug, deleted_at: null } });
  if (found) papers.push(found);
  else console.log(`Note: there is no paper called "${slug}" on this server yet, so it was skipped.`);
}
if (!papers.length) fail(`None of these papers exist on this server: ${slugs.join(", ")}. Nothing was changed.`);

const pw_hash = await argon2.hash(password, { type: argon2.argon2id });
const existing = await prisma.user.findUnique({ where: { email } });
let user;
if (existing) {
  user = await prisma.user.update({ where: { id: existing.id }, data: { pw_hash, name } });
  // a changed password signs the account out everywhere
  await prisma.session.updateMany({ where: { user_id: user.id, revoked_at: null }, data: { revoked_at: new Date() } });
} else {
  user = await prisma.user.create({ data: { email, name, pw_hash } });
}
for (const paper of papers) {
  await prisma.membership.upsert({
    where: { user_id_paper_id: { user_id: user.id, paper_id: paper.id } },
    create: { user_id: user.id, paper_id: paper.id, role: "owner" },
    update: { role: "owner", deleted_at: null },
  });
  await prisma.auditLog.create({ data: { paper_id: paper.id, user_id: user.id, action: existing ? "admin.password_reset" : "admin.create", entity: "user", entity_id: user.id } });
}
console.log(`${existing ? "Password changed for" : "Admin account created:"} ${email} (owner of ${papers.map((p) => p.slug).join(", ")}).`);
await prisma.$disconnect();
