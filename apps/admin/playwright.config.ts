import { defineConfig } from "@playwright/test";

// Ports 8170-8179, loopback only: 8170 = vite preview of the built console, 8171 = in-memory mock of the API routes.
export default defineConfig({
  testDir: "e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:8170", headless: true },
  webServer: [
    { command: "pnpm exec tsx mock/server.ts", url: "http://127.0.0.1:8171/healthz", reuseExistingServer: false, env: { MOCK_PORT: "8171" } },
    { command: "pnpm exec vite preview --host 127.0.0.1 --port 8170 --strictPort", url: "http://127.0.0.1:8170/admin/", reuseExistingServer: false },
  ],
});
