import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:8185",
    viewport: { width: 400, height: 800 },
    hasTouch: true,
    isMobile: true,
    serviceWorkers: "allow",
  },
  webServer: {
    command: "pnpm run build && node scripts/dev-server.mjs",
    url: "http://127.0.0.1:8185/config.json",
    timeout: 240_000,
    reuseExistingServer: false,
  },
});
