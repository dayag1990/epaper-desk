import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:8180", headless: true },
  webServer: [
    { command: "pnpm exec tsx mock/server.ts", url: "http://127.0.0.1:8181/healthz", reuseExistingServer: false, env: { MOCK_PORT: "8181" } },
    { command: "pnpm exec vite preview --host 127.0.0.1 --port 8180 --strictPort", url: "http://127.0.0.1:8180", reuseExistingServer: false },
  ],
});
