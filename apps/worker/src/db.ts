import { PrismaClient } from "@prisma/client";

export function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const pw = encodeURIComponent(process.env.POSTGRES_PASSWORD ?? "");
  return `postgresql://${process.env.POSTGRES_USER ?? "epaper"}:${pw}@${process.env.PGHOST ?? "postgres"}:5432/${process.env.POSTGRES_DB ?? "epaper"}`;
}
export const prisma = new PrismaClient({ datasourceUrl: databaseUrl() });
