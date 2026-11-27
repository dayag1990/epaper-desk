import { prisma } from "./db.js";

/** Tell every open screen something changed. Postgres NOTIFY, sent AFTER the database write; same channel the API listens on. A failure here never fails a job. */
export type WireEvent =
  | { type: "page.updated"; paper_id: string; page_id: string; edition_id: string; rev: number; fill: number | null; status: string; by?: string | null }
  | { type: "page.fit"; paper_id: string; page_id: string; edition_id: string; rev: number; fill: number | null; state: "ok" | "low" | "over" | null; overflow: boolean }
  | { type: "edition.changed"; paper_id: string; edition_id: string }
  | { type: "edition.published" | "edition.updated"; paper_id: string; ep_edition_id: string; edition_id: string | null; date: string; version: number }
  | { type: "edition.exported"; paper_id: string; export_id: string; edition_id: string | null; format: string; status: string };

export async function publishEvent(ev: WireEvent): Promise<void> {
  try {
    await prisma.$executeRaw`select pg_notify('epaper_events', ${JSON.stringify(ev)})`;
  } catch (e) {
    console.error("event not announced:", (e as Error).message);
  }
}
