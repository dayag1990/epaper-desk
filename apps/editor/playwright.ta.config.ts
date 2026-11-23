import { defineConfig } from "@playwright/test";

// The Tamil line-break proof: the real editor build (vite preview) against a mock API that serves the Tamil demo edition.
// Own ports so it never collides with the normal editor e2e run.
export default defineConfig({
  testDir: "e2e-ta",
  timeout: 240_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:8184", headless: true },
  webServer: [
    { command: "pnpm exec tsx mock/server.ts", url: "http://127.0.0.1:8183/healthz", reuseExistingServer: false, timeout: 120_000, env: { MOCK_PORT: "8183", MOCK_SEED: "ta" } },
    { command: "pnpm exec vite preview --host 127.0.0.1 --port 8184 --strictPort", url: "http://127.0.0.1:8184", reuseExistingServer: false },
  ],
});
