import { buildApp } from "./app.js";
import { config } from "./env.js";
import { stopBoss } from "./queue.js";

const app = await buildApp();
for (const sig of ["SIGTERM", "SIGINT"] as const)
  process.on(sig, async () => {
    await app.close();
    await stopBoss();
    process.exit(0);
  });
await app.listen({ host: "0.0.0.0", port: config.port });
