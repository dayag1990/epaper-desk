import PgBoss from "pg-boss";
import { databaseUrl } from "./env.js";

export const QUEUES = ["ingest", "assets", "ai", "layout", "export", "epaper"] as const;
export type QueueName = (typeof QUEUES)[number];
// demo job types -> queue
export const JOB_TYPES: Record<string, QueueName> = { noop: "ingest", "always-fail": "ingest" };
export const deadName = (q: string) => `${q}_dead`;

let boss: PgBoss | undefined;
export async function getBoss() {
  if (boss) return boss;
  const b = new PgBoss({ connectionString: databaseUrl(), supervise: false, schedule: false, max: 3 });
  b.on("error", (e) => console.error("queue error:", e.message));
  await b.start();
  boss = b;
  return b;
}
export async function stopBoss() {
  await boss?.stop({ graceful: false, wait: false });
  boss = undefined;
}

export const retryOptions = () => ({
  retryLimit: 3,
  retryDelay: Number(process.env.JOB_RETRY_DELAY_S ?? 2),
  retryBackoff: true,
});

export async function ensureQueues(b: PgBoss) {
  for (const q of QUEUES) {
    await b.createQueue(deadName(q), { name: deadName(q), policy: "standard" });
    await b.createQueue(q, { name: q, policy: "short", deadLetter: deadName(q) });
  }
}
