import { buildApp } from "./app.js";
import { HttpApiClient } from "./api-client.js";
import { ScriptBackupDriver } from "./backup.js";
import { loadConfig } from "./config.js";
import { SocketProxyDocker } from "./docker.js";

// The desk stands alone: no API, worker or Postgres needed to start or to answer.
const cfg = loadConfig();
const docker = new SocketProxyDocker({ host: cfg.dockerHost, project: cfg.composeProject, composeFiles: cfg.composeFiles });
const { app, health, alerts } = buildApp({ cfg, docker, backup: new ScriptBackupDriver(cfg.scriptsDir), api: new HttpApiClient(cfg.apiBase, cfg.apiToken) });

console.log(`ops desk: state is plain JSON files in ${cfg.stateDir} (own login, sessions, ops log, alert memory); no database, no API, no Postgres`);
const tick = () => health.snapshot().then((s) => alerts.tick(s)).catch((e) => console.error("alert check failed:", (e as Error).message));
setInterval(tick, 15_000).unref();
await app.listen({ port: cfg.port, host: cfg.host });
console.log(`ops desk listening on ${cfg.host}:${cfg.port}`);
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => void app.close().then(() => process.exit(0)));
