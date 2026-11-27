import { defineConfig } from "vite";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The shared top bar (packages/theme) is written for React; the reader is Preact, so "react" means "preact/compat" here.
const preact = dirname(createRequire(import.meta.url).resolve("preact/package.json"));
const themeSrc = fileURLToPath(new URL("../../packages/theme/src", import.meta.url));
const themeCss = fileURLToPath(new URL("../../packages/theme/theme.css", import.meta.url));

export default defineConfig({
  base: "./",
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  resolve: {
    dedupe: ["preact"],
    alias: [
      { find: /^react\/jsx-runtime$/, replacement: join(preact, "jsx-runtime/dist/jsxRuntime.module.js") },
      { find: /^react-dom$/, replacement: join(preact, "compat/dist/compat.module.js") },
      { find: /^react$/, replacement: join(preact, "compat/dist/compat.module.js") },
      { find: /^@epaper\/theme\/react$/, replacement: `${themeSrc}/react.tsx` },
      { find: /^@epaper\/theme\/theme\.css$/, replacement: themeCss },
      { find: /^@epaper\/theme$/, replacement: `${themeSrc}/index.ts` },
    ],
  },
  build: { outDir: "dist", target: "es2020", sourcemap: false },
  test: { include: ["tests/**/*.test.ts"] },
} as never);
