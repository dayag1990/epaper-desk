import type { Mapping } from "@epaper/core";
import type { Overview } from "../types";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

/** Errors in plain words: what happened, what is safe, what to do. */
export function plainError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return "Can't reach the server. Nothing was changed. Check your connection and try again.";
    if (e.code === "bad_login") return e.message;
    if (e.status === 401) return "You've been signed out. Sign in again; nothing was lost.";
    if (e.status === 403) return e.message && e.message.length < 160 ? e.message : "Your role does not allow this.";
    if (e.status >= 500) return "Something went wrong on our side. Nothing was lost; please try again.";
    return e.message || "That did not work. Nothing was changed.";
  }
  return "Something went wrong. Nothing was changed.";
}

export function confidenceWords(c: number): { label: string; tone: "good" | "ok" | "weak" } {
  const pct = Math.round(c * 100);
  if (c >= 0.8) return { label: `Good match (${pct}%). The stories should come through cleanly.`, tone: "good" };
  if (c >= 0.6) return { label: `Fair match (${pct}%). Check the sample stories before saving.`, tone: "ok" };
  return { label: `Weak match (${pct}%). Read the sample carefully; some parts may be missing.`, tone: "weak" };
}

export const FIELD_WORDS: Record<string, string> = { headline: "Headline", body: "Story text", published_at: "Date", "images[0].src": "Main picture", byline: "Author", subhead: "Sub-headline", section: "Section" };

export const fillTone = (pct: number | null): "none" | "low" | "good" | "over" => (pct == null ? "none" : pct < 70 ? "low" : pct > 100 ? "over" : "good");
export const fillWords = (pct: number | null) => (pct == null ? "not measured yet" : pct < 70 ? `${pct}% full (a lot of empty space)` : pct > 100 ? `${pct}% (too much text)` : `${pct}% full`);

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const tomorrow = (now = new Date()) => isoDay(new Date(now.getTime() + 86400_000));
export function checkDate(s: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "Pick a date.";
  const d = new Date(s + "T00:00:00Z");
  return Number.isNaN(d.getTime()) || isoDay(d) !== s ? "That date does not exist." : null;
}

export const mappingToRows = (m: Mapping | null | undefined): { field: string; expr: string }[] => Object.entries(m ?? {}).map(([field, expr]) => ({ field, expr }));
export function rowsToMapping(rows: { field: string; expr: string }[]): { mapping: Mapping; error: string | null } {
  const mapping: Mapping = {};
  for (const r of rows) {
    const f = r.field.trim();
    if (!f && !r.expr.trim()) continue;
    if (!f) return { mapping, error: "Every rule needs a field name on the left." };
    if (f in mapping) return { mapping, error: `"${f}" appears twice.` };
    if (!r.expr.trim()) return { mapping, error: `"${f}" has no rule on the right. Fill it in or clear the row.` };
    mapping[f] = r.expr.trim();
  }
  if (!mapping.headline) return { mapping, error: "A mapping needs at least a headline rule." };
  return { mapping, error: null };
}

export const EDITION_WORDS: Record<string, string> = { draft: "Draft", planning: "Planning pages", planned: "Planned", approved: "Approved", published: "Published" };
export const PAGE_WORDS: Record<string, string> = { draft: "Draft", approved: "Approved" };
export const READER_WORDS: Record<string, string> = { building: "Building the reader copy", ready: "Ready to publish", scheduled: "Scheduled", published: "Live for readers", failed: "Could not be built" };
export const EXPORT_WORDS: Record<string, string> = { queued: "Waiting", running: "Working", done: "Ready", failed: "Failed" };
export const FORMAT_WORDS: Record<string, string> = { pdf_screen: "PDF", cxml: "ContentXML", idml: "InDesign (IDML)", pdf_press: "Press PDF" };

/** The one thing to do next on an edition, in plain words. */
export function nextStep(o: Overview): string {
  if (o.status === "planning") return "Planning the pages. This takes about a minute.";
  if (!o.pages.length) return "Press Auto-plan to lay out the pages from today's stories.";
  const un = o.pages.filter((p) => p.status !== "approved").length;
  if (un) return `${un} page${un === 1 ? "" : "s"} still need${un === 1 ? "s" : ""} a look. Open them in the editor, then approve.`;
  const pdf = o.exports.find((e) => e.format === "pdf_screen");
  if (!pdf) return "All pages approved. Make the PDF; it also builds the reader copy.";
  if (pdf.status !== "done") return pdf.status === "failed" ? "The PDF could not be made. Try again." : "Making the PDF.";
  if (!o.reader) return "The PDF is ready. The reader copy is on its way.";
  if (o.reader.status === "building") return "Building the reader copy.";
  if (o.reader.status === "ready") return "Ready. Publish to the reader when you want it live.";
  if (o.reader.status === "published") return "Live for readers.";
  if (o.reader.status === "scheduled") return "Scheduled to go live.";
  return "The reader copy failed to build. Make the PDF again.";
}
export const isBusy = (o: Overview | null): boolean => !!o && (o.status === "planning" || o.exports.some((e) => e.status === "queued" || e.status === "running") || o.reader?.status === "building");
