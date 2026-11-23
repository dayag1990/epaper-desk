import { execFileSync } from "node:child_process";
import { databaseUrl } from "./env.js";

// Runs expand-only migrations. Retries while Postgres is still starting.
for (let i = 0; ; i++) {
  try {
    execFileSync("node_modules/.bin/prisma", ["migrate", "deploy", "--schema", "prisma/schema.prisma"], {
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, DATABASE_URL: databaseUrl() },
    });
    break;
  } catch (e) {
    if (i >= 10) throw new Error("Migrations failed.");
    await new Promise((r) => setTimeout(r, 3000));
  }
}
