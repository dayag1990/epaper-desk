import { randomUUID } from "node:crypto";
import { getBoss, retryOptions, type QueueName } from "../queue.js";

/** Job type -> queue. The worker has the same table. */
export const TYPE_QUEUE: Record<string, QueueName> = {
  "source.sync": "ingest",
  "asset.fetch": "assets",
  "edition.autoplan": "layout",
  "page.fit": "layout",
  "export.run": "export",
  "epaper.build": "epaper",
  "epaper.replace_page": "epaper",
  "epaper.publish": "epaper",
  "webhook.deliver": "epaper",
};

/** Send one job with the standard envelope. Same idempotency key while queued = one job. */
export async function enqueue(type: keyof typeof TYPE_QUEUE | string, paper_id: string, payload: Record<string, unknown>, idem?: string, delay_s?: number) {
  const queue = TYPE_QUEUE[type]!;
  const key = idem ?? randomUUID();
  const boss = await getBoss();
  const id = await boss.send(queue, { type, paper_id, payload, idempotency_key: key }, {
    ...retryOptions(),
    singletonKey: `${paper_id}:${type}:${key}`,
    ...(delay_s ? { startAfter: delay_s } : {}),
  });
  return { id, queue };
}

export async function emitWebhook(paper_id: string, event: string, payload: Record<string, unknown>) {
  const { prisma } = await import("../db.js");
  const hooks = await prisma.webhook.findMany({ where: { paper_id, active: true, deleted_at: null } });
  for (const h of hooks) {
    if (!(h.events as string[]).includes(event)) continue;
    const d = await prisma.webhookDelivery.create({ data: { paper_id, webhook_id: h.id, event, payload: payload as any } });
    await enqueue("webhook.deliver", paper_id, { delivery_id: d.id }, `wh:${d.id}`);
  }
}
