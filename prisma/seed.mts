// Seed: a demo paper and its owner. The owner password comes from SEED_OWNER_PASSWORD, never from code.
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const pw = encodeURIComponent(process.env.POSTGRES_PASSWORD ?? "");
  return `postgresql://${process.env.POSTGRES_USER ?? "epaper"}:${pw}@${process.env.PGHOST ?? "postgres"}:5432/${process.env.POSTGRES_DB ?? "epaper"}`;
}

const password = process.env.SEED_OWNER_PASSWORD;
if (!password || password.length < 12) {
  console.error("Set SEED_OWNER_PASSWORD (at least 12 characters) to seed the owner.");
  process.exit(1);
}
const slug = process.env.SEED_PAPER_SLUG ?? "demo";
const name = process.env.SEED_PAPER_NAME ?? "Demo Daily";
const email = (process.env.SEED_OWNER_EMAIL ?? "owner@demo.example").toLowerCase();

const prisma = new PrismaClient({ datasourceUrl: databaseUrl() });
const paper = await prisma.paper.upsert({
  where: { slug },
  create: { slug, name, lang: "en", script: "Latn", tz: "UTC" },
  update: {},
});
const existing = await prisma.user.findUnique({ where: { email } });
const user =
  existing ??
  (await prisma.user.create({ data: { email, name: "Demo Owner", pw_hash: await argon2.hash(password, { type: argon2.argon2id }) } }));
await prisma.membership.upsert({
  where: { user_id_paper_id: { user_id: user.id, paper_id: paper.id } },
  create: { user_id: user.id, paper_id: paper.id, role: "owner" },
  update: { role: "owner", deleted_at: null },
});
await prisma.auditLog.create({ data: { paper_id: paper.id, user_id: user.id, action: "seed", entity: "paper", entity_id: paper.id } });
console.log(`seeded paper "${slug}" with owner ${email}`);
await prisma.$disconnect();
