import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Resolve @epaper/core from source so tests do not need core to be built first.
export default defineConfig({
  resolve: { alias: { "@epaper/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)) } },
  test: { testTimeout: 180_000, hookTimeout: 180_000 },
});
