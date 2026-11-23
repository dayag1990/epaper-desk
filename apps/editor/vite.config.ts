import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const layoutSrc = fileURLToPath(new URL("../../packages/layout/src", import.meta.url));
const coreSrc = fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url));

// The editor uses the SAME renderPage/paperCss/domFill/domFrames/domReady source as the server.
// We import those files directly (not the package barrel, which pulls in Playwright for the headless engine).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@epaper\/layout\/src\/(.*)\.js$/, replacement: layoutSrc + "/$1.ts" },
      { find: "@epaper/core", replacement: coreSrc },
    ],
  },
  server: { host: "127.0.0.1", port: 8182, fs: { allow: ["../.."] } },
  preview: { host: "127.0.0.1", port: 8180 },
  build: { target: "es2022", sourcemap: false },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
} as Parameters<typeof defineConfig>[0]);
