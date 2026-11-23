import type { Article, PageDoc, PageItem } from "@epaper/core";
import { PageDocSchema } from "@epaper/core";
import { LayoutEngine, type FitOptions, type FitReport } from "./engine.js";
import { defaultRatio, defaultSpan } from "./render.js";
import { packSpans } from "./pack.js";
import type { Slot, Template } from "./template.js";
import { round } from "./units.js";

export interface AdBooking {
  page: number; // 1-based
  asset_id: Article["images"][number]["asset_id"];
  ratio?: number;
}
export interface AutoPlanOptions {
  /** Number of pages to plan. Default: one page per distinct section. */
  pages?: number;
  /** Keep each section on its own page (the prototype's sections-are-pages behaviour). Default true when `pages` is not given. */
  bySection?: boolean;
  date?: string; // printed in the strip; no clock is read, so plans are repeatable
  ads?: AdBooking[];
  fit?: FitOptions;
  /** Cap the number of full re-fit passes (safety). */
  maxPasses?: number;
}
export interface PlannedPage {
  doc: PageDoc;
  template: Template;
  fit: FitReport;
  articles: string[]; // article ids placed here
}
export interface PlanResult {
  pages: PlannedPage[];
  unplaced: string[]; // article ids that could not be placed (never silently dropped)
  elapsed_ms: number;
}

const words = (a: Article) => a.body.reduce((n, b) => n + b.text.split(/\s+/).filter(Boolean).length, 0);

function kindOfHint(slot: string | undefined): PageItem["kind"] | null {
  if (!slot) return null;
  if (/^advert/i.test(slot)) return "ad";
  if (/sidebar/i.test(slot)) return "side";
  if (/^feature/i.test(slot)) return "feature";
  if (/^editorial/i.test(slot)) return "edit";
  if (/^story/i.test(slot)) return "story";
  return null;
}

/** Stable total order: layout_hint.order (when present) first, then priority desc, newer first, id. */
function order(a: Article, b: Article): number {
  const ha = a.layout_hint?.order, hb = b.layout_hint?.order;
  if (ha != null && hb != null && ha !== hb) return ha - hb;
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.published_at !== b.published_at) return a.published_at < b.published_at ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function pickVariant(set: Template[], pageNo: number, storyCount: number): Template {
  const role = pageNo === 1 ? "front" : "inner";
  const ofRole = set.filter((t) => t.role === role);
  const pool = ofRole.length ? ofRole : set;
  // smallest variant that holds the story count, else the roomiest
  const sorted = [...pool].sort((a, b) => a.max_stories - b.max_stories || (a.id < b.id ? -1 : 1));
  return sorted.find((t) => t.max_stories >= storyCount) ?? sorted[sorted.length - 1]!;
}

/** Fill slots by priority: first unused slot of the right kind whose word range fits. */
function chooseSlot(kind: PageItem["kind"], w: number, hasImage: boolean, used: Set<string>, t: Template): Slot | null {
  const cand = t.slots.filter((s) => s.kind === kind && !used.has(s.id) && w >= s.words_min && w <= s.words_max && (!hasImage || s.image || kind !== "story"));
  return cand[0] ?? null;
}

function toItem(a: Article, pageNo: number, n: number, t: Template, used: Set<string>): PageItem {
  const w = words(a);
  const hinted = kindOfHint(a.layout_hint?.slot);
  const kind: PageItem["kind"] = hinted && hinted !== "ad" ? hinted : "story";
  const hasImage = a.images.length > 0;
  let slot: string, span: number, cols: number;
  if (a.layout_hint && hinted) {
    slot = a.layout_hint.slot;
    span = Math.min(t.columns, Math.max(1, a.layout_hint.span || defaultSpan({ kind, slot }, t.columns)));
    cols = span;
  } else {
    const s = chooseSlot(kind, w, hasImage, used, t);
    if (s) { slot = s.id; span = s.span; cols = s.cols; used.add(s.id); }
    else {
      span = w < 70 ? 2 : w < 160 ? 3 : w < 280 ? 4 : 5;
      span = Math.min(t.columns, Math.max(1, Math.round((span * t.columns) / 8)));
      slot = `story_col_span-${span}-${n}`; cols = span;
    }
  }
  const img = a.images[0];
  const item: PageItem = {
    id: `it_p${pageNo}n${n}`,
    kind,
    article_id: a.id,
    article_rev: a.rev,
    slot,
    span,
    cols,
    hs: 1,
    text: { kicker: a.kicker ?? null, head: a.headline, sub: a.subhead ?? null, body: a.body.map((b) => b.text) },
    styles: { head: t.styles.head, sub: t.styles.sub, body: t.styles.body },
  };
  if (img) item.image = { asset_id: img.asset_id, ratio: defaultRatio(kind, span), cutout: false, focal: [0.5, 0.4] };
  return item;
}

/** Apply row packing, then give items the span-derived defaults the prototype used (cols, image ratio). */
function finishItems(items: PageItem[], t: Template): PageItem[] {
  const spans = packSpans(items.map((i) => i.span ?? defaultSpan(i, t.columns)), t.columns);
  return items.map((it, k) => {
    const span = spans[k]!;
    const stretched = span !== it.span;
    return {
      ...it,
      span,
      cols: stretched && it.cols === it.span ? span : Math.min(it.cols ?? span, span),
      ...(it.image ? { image: { ...it.image, ratio: defaultRatio(it.kind, span) } } : {}),
    };
  });
}

function buildDoc(pageNo: number, t: Template, items: PageItem[], opts: AutoPlanOptions, section: string): PageDoc {
  const strip: [string, string, string] =
    pageNo === 1 ? [t.furniture.strip[0], opts.date ?? t.furniture.strip[1], t.furniture.strip[2]] : [section, opts.date ?? t.furniture.strip[1], `PAGE ${pageNo}`];
  const doc = {
    page: { no: pageNo, size: t.size.id, w_mm: t.size.w_mm, h_mm: t.size.h_mm, template: t.id, body_pt: round(t.body.start_px * (t.size.w_mm / t.canvas_px / 25.4 * 72), 3) },
    furniture: { masthead: t.furniture.masthead, tagline: t.furniture.tagline, strip },
    items: finishItems(items, t),
    status: "draft",
    rev: 1,
  };
  return PageDocSchema.parse(doc);
}

/**
 * Auto-plan: articles -> PageDocs for N pages. Rule-based and deterministic (no AI, no clock, no randomness):
 * sort by hint order / priority, group by section, fill pages by word budget, pick a template variant by
 * story count, fit each page, and push the last story to the next page while a page overflows.
 * The last page keeps what is left and reports its overflow.
 */
export async function autoPlan(
  engine: LayoutEngine,
  articles: readonly Article[],
  templates: readonly Template[],
  opts: AutoPlanOptions = {},
): Promise<PlanResult> {
  const t0 = Date.now();
  const sorted = [...articles].sort(order);
  const sectionKey = (a: Article) => a.layout_hint?.page ?? a.section;
  // section order = first appearance in priority order
  const secOrder: string[] = [];
  for (const a of sorted) if (!secOrder.includes(sectionKey(a))) secOrder.push(sectionKey(a));
  const bySection = opts.bySection ?? opts.pages == null;
  const nPages = Math.max(1, opts.pages ?? secOrder.length);
  const queue: Article[] = [];
  for (const s of secOrder) queue.push(...sorted.filter((a) => sectionKey(a) === s));

  const totalWords = queue.reduce((n, a) => n + words(a), 0);
  const target = totalWords / nPages;
  const result: PlannedPage[] = [];
  const unplaced: string[] = [];

  for (let p = 1; p <= nPages; p++) {
    const last = p === nPages;
    let cur: Article[] = [];
    let w = 0;
    while (queue.length) {
      const a = queue[0]!;
      if (!last && cur.length) {
        if (bySection ? sectionKey(a) !== sectionKey(cur[0]!) : w + words(a) / 2 > target * 1.05 || (sectionKey(a) !== sectionKey(cur[cur.length - 1]!) && w >= target * 0.7)) break;
      }
      cur.push(queue.shift()!);
      w += words(a);
    }
    // an empty page (fewer articles than pages) is still a page; planning never invents content
    const section = cur[0] ? sectionKey(cur[0]) : "";
    const make = (list: Article[]) => {
      const t = pickVariant([...templates], p, list.length + (opts.ads?.filter((x) => x.page === p).length ?? 0));
      const used = new Set<string>();
      const items = list.map((a, i) => toItem(a, p, i + 1, t, used));
      (opts.ads ?? []).filter((x) => x.page === p).forEach((ad, i) =>
        items.push({ id: `it_p${p}ad${i + 1}`, kind: "ad", slot: `adverts-${i + 1}`, span: t.columns, cols: 1, image: { asset_id: ad.asset_id, ratio: ad.ratio ?? 9, cutout: false, focal: [0.5, 0.5] } }));
      return { t, doc: buildDoc(p, t, items, opts, section) };
    };
    let built = make(cur);
    let fit = await engine.fit(built.doc, built.t, articles, opts.fit);
    let passes = 0;
    while (fit.overflow && !last && !bySection && cur.length > 1 && passes++ < (opts.maxPasses ?? 40)) {
      queue.unshift(cur.pop()!);
      built = make(cur);
      fit = await engine.fit(built.doc, built.t, articles, opts.fit);
    }
    result.push({ doc: fit.doc, template: built.t, fit, articles: cur.map((a) => a.id) });
  }
  for (const a of queue) unplaced.push(a.id);
  return { pages: result, unplaced, elapsed_ms: Date.now() - t0 };
}
