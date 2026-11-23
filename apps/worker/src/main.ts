import http from "node:http";
import { access, constants } from "node:fs/promises";
import pg from "pg";
import PgBoss from "pg-boss";
import { z } from "zod";

const QUEUES = ["ingest", "assets", "ai", "layout", "export", "epaper"] as const;
const dead = (q: string) => `${q}_dead`;

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const pw = encodeURIComponent(process.env.POSTGRES_PASSWORD ?? "");
  return `postgresql://${process.env.POSTGRES_USER ?? "epaper"}:${pw}@${process.env.PGHOST ?? "postgres"}:5432/${process.env.POSTGRES_DB ?? "epaper"}`;
}

// Job envelope: {type, paper_id, payload, idempotency_key}
export const Envelope = z.object({
  type: z.string(),
  paper_id: z.string().uuid(),
  payload: z.record(z.any()).default({}),
  idempotency_key: z.string(),
});
export type Envelope = z.infer<typeof Envelope>;

export const handlers: Record<string, (e: Envelope) => Promise<void>> = {
  noop: async () => {},
  "always-fail": async () => {
    throw new Error("always-fail job failed on purpose");
  },
};

/** The ai queue does nothing unless AI is switched on. */
export const queueEnabled = (q: string, env: NodeJS.ProcessEnv = process.env) => q !== "ai" || env.AI_ENABLED === "true";

async function main() {
  const filesRoot = process.env.FILES_ROOT ?? "/files";
  const retry = { retryLimit: 3, retryDelay: Number(process.env.JOB_RETRY_DELAY_S ?? 2), retryBackoff: true };
  const boss = new PgBoss({ connectionString: databaseUrl(), max: 5 });
  boss.on("error", (e) => console.error("queue error:", e.message));
  for (let i = 0; ; i++) {
    try { await boss.start(); break; } catch (e) {
      if (i > 20) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  for (const q of QUEUES) {
    await boss.createQueue(dead(q), { name: dead(q), policy: "standard" });
    await boss.createQueue(q, { name: q, policy: "short", deadLetter: dead(q) });
  }
  void retry; // retry options travel with each job (set by the sender); see apps/api/src/queue.ts

  for (const q of QUEUES) {
    if (!queueEnabled(q)) {
      console.log(`queue ${q}: AI is off, not listening`);
      continue;
    }
    await boss.work<unknown>(q, { batchSize: 1, pollingIntervalSeconds: 1 }, async (jobs: any) => {
      for (const job of Array.isArray(jobs) ? jobs : [jobs]) {
        const env = Envelope.parse(job.data);
        const h = handlers[env.type];
        if (!h) throw new Error(`no handler for job type ${env.type}`);
        await h(env);
      }
    });
  }

  const pool = new pg.Pool({ connectionString: databaseUrl(), max: 1, connectionTimeoutMillis: 4000 });
  const check = async () => {
    const out: Record<string, string> = {};
    const t = (n: string, f: () => Promise<unknown>) =>
      Promise.race([f().then(() => (out[n] = "ok")), new Promise((r) => setTimeout(r, 5000)).then(() => { out[n] = "timeout after 5 s"; })]).catch(() => (out[n] = "failed"));
    await Promise.all([t("db", () => pool.query("select 1")), t("files", () => access(filesRoot, constants.R_OK | constants.W_OK))]);
    return { ok: Object.values(out).every((v) => v === "ok"), checks: out };
  };
  const server = http.createServer(async (req, res) => {
    const send = (c: number, b: unknown) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
    if (req.url === "/healthz") return send(200, { ok: true });
    if (req.url === "/readyz") { const r = await check(); return send(r.ok ? 200 : 503, r); }
    send(404, { code: "not_found", message: "There is nothing at this address.", details: {} });
  });
  server.listen(3001, "0.0.0.0");
  for (const sig of ["SIGTERM", "SIGINT"] as const)
    process.on(sig, async () => { server.close(); await boss.stop({ graceful: true, timeout: 10000 }); process.exit(0); });
  console.log("worker ready");
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
