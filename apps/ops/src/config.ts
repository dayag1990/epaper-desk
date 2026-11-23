import path from "node:path";

/** Everything the desk needs to know about its surroundings. All from env, all with safe defaults. */
export interface Config {
  port: number;
  host: string;
  /** Own state (login, sessions, ops log, alert memory). Plain JSON files: no database. */
  stateDir: string;
  filesDir: string;
  scriptsDir: string;
  procDir: string;
  servicesFile: string;
  alertsFile: string;
  statusMdFile: string;
  alertsLogFile: string;
  composeProject: string;
  composeFiles: string[];
  dockerHost: string;
  apiBase: string;
  apiToken: string | undefined;
  opsHost: string | undefined;
  telegramToken: string | undefined;
  telegramChat: string | undefined;
  setupCode: string | undefined;
  /** how long a restart waits for "healthy" before saying it did not come back */
  healthWaitMs: number;
  secureCookie: boolean;
  clearDirNames: string[];
  keepReleases: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const files = env.FILES_ROOT ?? "/srv/epaper/files";
  const stateDir = env.OPS_STATE_DIR ?? path.join(files, "_ops");
  const ops = env.OPS_CONFIG_DIR ?? "/srv/epaper/desk/ops";
  return {
    port: Number(env.OPS_PORT ?? 8101),
    host: env.OPS_BIND ?? "0.0.0.0",
    stateDir,
    filesDir: files,
    scriptsDir: env.OPS_SCRIPTS_DIR ?? "/srv/epaper/desk/scripts",
    procDir: env.OPS_PROC_DIR ?? "/host/proc",
    servicesFile: env.OPS_SERVICES_FILE ?? path.join(ops, "services.yml"),
    alertsFile: env.OPS_ALERTS_FILE ?? path.join(ops, "alerts.yml"),
    statusMdFile: env.OPS_STATUS_MD ?? "/srv/epaper/desk/STATUS.md",
    alertsLogFile: env.OPS_ALERTS_LOG ?? path.join(files, "alerts.log"),
    composeProject: env.OPS_COMPOSE_PROJECT ?? "epaper",
    composeFiles: (env.OPS_COMPOSE_FILES ?? "/srv/epaper/desk/docker-compose.yml:/srv/epaper/desk/docker-compose.ops.yml").split(":").filter(Boolean),
    dockerHost: env.DOCKER_HOST ?? "http://dockerproxy:2375",
    apiBase: env.OPS_API_BASE ?? "http://api:8100",
    apiToken: env.OPS_API_TOKEN || undefined,
    opsHost: env.OPS_HOST || undefined,
    telegramToken: env.ALERT_TELEGRAM_TOKEN || undefined,
    telegramChat: env.ALERT_TELEGRAM_CHAT || undefined,
    setupCode: env.OPS_SETUP_CODE || undefined,
    healthWaitMs: Number(env.OPS_HEALTH_WAIT_MS ?? 90_000),
    secureCookie: env.OPS_INSECURE_COOKIE !== "1",
    clearDirNames: (env.OPS_CLEAR_DIRS ?? "derived,derivatives,exports,cache,tmp").split(",").map((s) => s.trim()).filter(Boolean),
    keepReleases: 5,
  };
}
