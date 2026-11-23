import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  // Run the workspace packages from source (as packages/*/vitest.config.ts do), so no dist/ build is needed.
  resolve: { alias: { "@epaper/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)) } },
  test: { include: ["tests/**/*.test.ts"], testTimeout: 180_000, hookTimeout: 180_000, fileParallelism: false },
});
