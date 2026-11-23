import { defineConfig } from "@playwright/test";

// Real-API run: against the console served by the API itself at /admin (compose project epaper-m12, 127.0.0.1:8130).
// Needs M12_API_BASE, M12_PW_A, M12_PW_B in the environment. Not part of the normal e2e run.
export default defineConfig({
  testDir: "e2e-real",
  timeout: 60_000,
  workers: 1,
  reporter: "list",
  use: { baseURL: process.env.M12_API_BASE ?? "http://127.0.0.1:8130", headless: true },
});
