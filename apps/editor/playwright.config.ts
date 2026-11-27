import { defineConfig } from "@playwright/test";

const WEB = process.env.E2E_WEB ?? "8180", API = process.env.E2E_API ?? "8181"; // other ports when another run holds these

export default defineConfig({
  testDir: "e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { baseURL: `http://127.0.0.1:${WEB}`, headless: true },
  webServer: [
    { command: "pnpm exec tsx mock/server.ts", url: `http://127.0.0.1:${API}/healthz`, reuseExistingServer: false, env: { MOCK_PORT: API } },
    { command: `pnpm exec vite preview --host 127.0.0.1 --port ${WEB} --strictPort`, url: `http://127.0.0.1:${WEB}`, reuseExistingServer: false },
  ],
});
