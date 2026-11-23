import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Resolve @epaper/layout from source so tests do not depend on a prior build of its dist.
export default defineConfig({
  resolve: { alias: { "@epaper/layout": fileURLToPath(new URL("../layout/src/index.ts", import.meta.url)) } },
  test: { include: ["test/**/*.test.ts"], testTimeout: 60000 },
});
