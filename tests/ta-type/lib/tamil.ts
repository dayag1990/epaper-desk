// Shared helpers for the Tamil typography tests: the 40 articles through the connectors RSS adapter, planning, the
// line-break proof inputs, and the PDF text reader. Node only. Imports the built packages (run the package builds first).
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Article, PageDoc } from "@epaper/core";
import { createRssConnector, MemoryArticleStore, RSS_DEFAULT_MAPPING, syncSource } from "../../../packages/connectors/src/index.js";
import { autoPlan, loadTemplateSet, type LayoutEngine, type PlanResult, type Template } from "../../../packages/layout/dist/index.js";

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const SECTIONS = ["முதல் பக்கம்", "தமிழ்நாடு", "சென்னை", "இந்தியா", "உலகம்", "வணிகம்", "விளையாட்டு", "சினிமா"];
export const DATE_TA = "நவம்பர் 24, 2026";
export const taTemplates = (): Template[] => loadTemplateSet(join(ROOT, "templates/broadsheet-ta"));

/** The 40 Tamil articles exactly as the connectors RSS adapter reads them from the generated demo site. */
export async function ingestTamil(): Promise<Article[]> {
  const xml = readFileSync(join(ROOT, "fixtures/demo-site-ta/site/rss.xml"), "utf8");
  const fetcher = { get: async (u: string) => ({ url: u, status: 200, contentType: "application/rss+xml", text: xml }) };
  const store = new MemoryArticleStore();
  const mapping = { ...RSS_DEFAULT_MAPPING, lang: "const:ta", script: "const:Taml" };
  const rep = await syncSource(createRssConnector(fetcher as never), { url: "http://127.0.0.1:8190/rss.xml", limit: 200 }, mapping, { paperId: "pap_ta", sourceId: "src_ta" }, store);
  if (rep.created !== 40 || rep.rejected.length) throw new Error(`ingest gave ${rep.created} articles, ${rep.rejected.length} rejected`);
  return store.all();
}

const PLACEHOLDER = "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1600"><rect width="2400" height="1600" fill="#8a8a8a"/></svg>').toString("base64");
/** A grey placeholder picture on the given articles (the lead story of each page). */
export function withPlaceholder(arts: readonly Article[], ids: ReadonlySet<string>): Article[] {
  return arts.map((a) => (ids.has(a.id) ? { ...a, images: [{ asset_id: `ast_ph${a.id.slice(-8)}` as never, role: "lead", src: PLACEHOLDER }] } : a));
}

export const planTamil = (engine: LayoutEngine, arts: readonly Article[]): Promise<PlanResult> =>
  autoPlan(engine, arts, taTemplates(), { sectionPages: SECTIONS, date: DATE_TA });

// ---------------------------------------------------------------- proof inputs
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
export interface ProofInput { id: string; kind: string; text: string }
/**
 * 8 representative paragraphs and the 8 section headlines. Taken from the articles; two paragraphs get a Latin acronym
 * or a "3-1" score added, because the 40 articles contain no Latin letters at all.
 */
export function proofInputs(arts: readonly Article[]): { paragraphs: ProofInput[]; headlines: ProofInput[] } {
  const paras = arts.flatMap((a) => a.body.filter((b) => b.t === "p").map((b, i) => ({ id: `${a.external_id ?? a.id}#${i}`, text: b.text })));
  const pick = (f: (t: string) => boolean, order: (a: string, b: string) => number = () => 0) => [...paras].filter((p) => f(p.text)).sort((a, b) => order(a.text, b.text) || (a.id < b.id ? -1 : 1))[0]!;
  const short = pick((t) => words(t) >= 12, (a, b) => words(a) - words(b));
  const medium = pick((t) => words(t) >= 45 && words(t) <= 60 && /“/.test(t));
  const long = pick((t) => words(t) >= 95, (a, b) => words(b) - words(a));
  const digits = pick((t) => /\d,\d{3}/.test(t), (a, b) => (b.match(/\d/g)?.length ?? 0) - (a.match(/\d/g)?.length ?? 0));
  const quotes = pick((t) => (t.match(/“/g)?.length ?? 0) >= 2);
  const rupees = pick((t) => (t.match(/ரூ\./g)?.length ?? 0) >= 3);
  const range = pick((t) => /\d-\d/.test(t));
  const acr = pick((t) => words(t) >= 30 && words(t) <= 50 && !/“/.test(t));
  const parts = acr.text.split(" ");
  const half = Math.floor(parts.length / 2);
  const acronym = { id: acr.id + "+latin", text: [...parts.slice(0, half), "(GST)", "T20", "AI", ...parts.slice(half)].join(" ") };
  const range2 = { id: range.id + "+3-1", text: range.text + " ஆட்ட முடிவில் 3-1 என்ற கணக்கில் முன்னிலை; 2-0, 10-12 மணி." };
  const paragraphs: ProofInput[] = [
    { ...short, kind: "short" }, { ...medium, kind: "medium, quote" }, { ...long, kind: "long" }, { ...digits, kind: "digits" },
    { ...acronym, kind: "Latin acronyms" }, { ...quotes, kind: "quotes" }, { ...rupees, kind: "ரூ. amounts" }, { ...range2, kind: "hyphen ranges" },
  ];
  const headlines: ProofInput[] = SECTIONS.map((s) => {
    const a = arts.filter((x) => x.section === s).sort((x, y) => (x.published_at < y.published_at ? -1 : 1))[0]!;
    return { id: a.external_id ?? a.id, kind: s, text: a.headline };
  });
  return { paragraphs, headlines };
}

/** Two proof pages: page 9 has the 8 headlines (each over a short body), page 10 the 8 paragraphs at several column widths. */
export function proofDocs(arts: readonly Article[], templates: readonly Template[]): { doc: PageDoc; template: Template }[] {
  const { paragraphs, headlines } = proofInputs(arts);
  const t = templates.find((x) => x.id === "inner_a")!;
  const mk = (no: number, items: PageDoc["items"]): PageDoc => ({
    page: { no, size: t.size.id, w_mm: t.size.w_mm, h_mm: t.size.h_mm, template: t.id, body_pt: +((t.body.start_px * t.size.w_mm) / t.canvas_px / 25.4 * 72).toFixed(3) },
    furniture: { masthead: t.furniture.masthead, tagline: t.furniture.tagline, strip: ["சோதனைப் பக்கம்", DATE_TA, `${t.furniture.page_label} ${no}`] },
    items, status: "draft", rev: 1,
  });
  const spans = [2, 3, 4, 3, 2, 4, 3, 2];
  const styles = { head: t.styles.head, sub: t.styles.sub, body: t.styles.body };
  // every story has a sub-head: the editor draws a placeholder for an empty one (an editing aid that takes room), the PDF does not
  const sub = (i: number) => proofInputs(arts).paragraphs[(i + 2) % 8]!.text.split(" ").slice(0, 9).join(" ") + "…";
  const item = (id: string, span: number, head: string, body: string[], i: number, kicker: string | null = null): PageDoc["items"][number] =>
    ({ id, kind: "story", slot: `story_col_span-${span}-1`, span, cols: Math.max(1, Math.round(span / 2)), hs: 1, text: { kicker, head, sub: sub(i), body }, styles } as never);
  const p9 = headlines.map((h, i) => item(`it_h${i + 1}`, spans[i]!, h.text, [paragraphs[0]!.text.split(" ").slice(0, 14).join(" ") + "."], i, h.kind));
  const p10 = paragraphs.map((p, i) => item(`it_p${i + 1}`, spans[i]!, `${p.kind}`, [p.text, p.text.split(" ").slice(0, 25).join(" ") + "."], i));
  return [{ doc: mk(9, p9), template: t }, { doc: mk(10, p10), template: t }];
}

export { badStart, matchPage, pdfFonts, pdfWords, squash } from "./pdf.js";
