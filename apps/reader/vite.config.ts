import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  build: { outDir: "dist", target: "es2020", sourcemap: false },
  test: { include: ["tests/**/*.test.ts"] },
} as never);
