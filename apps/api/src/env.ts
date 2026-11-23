// Config read from the environment. Secrets are never logged.
export function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const pw = encodeURIComponent(process.env.POSTGRES_PASSWORD ?? "");
  const host = process.env.PGHOST ?? "postgres";
  const user = process.env.POSTGRES_USER ?? "epaper";
  const db = process.env.POSTGRES_DB ?? "epaper";
  return `postgresql://${user}:${pw}@${host}:5432/${db}`;
}
export const config = {
  port: Number(process.env.API_PORT ?? 8100),
  filesDriver: process.env.FILES_DRIVER ?? "fs",
  filesRoot: process.env.FILES_ROOT ?? "/files",
  sessionDays: 14,
  aiEnabled: process.env.AI_ENABLED === "true",
};
