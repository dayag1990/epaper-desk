import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const coreSrc = fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url));
// Only types are imported from @epaper/core, so the bundle stays small.
// The console is served by the API under /admin; in tests `vite preview` forwards /v1 and /readyz to the in-memory mock.
const api = process.env.ADMIN_API ?? "http://127.0.0.1:8171";
const proxy = { "/v1": api, "/readyz": api };
export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  resolve: { alias: [{ find: "@epaper/core", replacement: coreSrc }] },
  server: { host: "127.0.0.1", port: 8172, proxy },
  preview: { host: "127.0.0.1", port: 8170, proxy },
  build: { target: "es2022", sourcemap: false },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
} as Parameters<typeof defineConfig>[0]);
