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
  /** Upper bound on page evaluations (each = one real render+fit) the balancing search may spend. Default 40. */
  repairBudget?: number;
  /** Fill ratio the balancer aims for on every page (the band is 0.85..1). Default 0.9. */
  targetFill?: number;
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
  /** Plain-words reason for every id in `unplaced`. */
  unplaced_reasons?: { id: string; reason: string }[];
  /** How many real page evaluations the balancer spent (bounded by repairBudget). */
  evaluations?: number;
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

function toItem(a: Article, pageNo: number, n: number, t: Template, used: Set<string>, spanOv?: number): PageItem {
  const w = words(a);
  const hinted = kindOfHint(a.layout_hint?.slot);
  const kind: PageItem["kind"] = hinted && hinted !== "ad" ? hinted : "story";
  const hasImage = a.images.length > 0;
  let slot: string, span: number, cols: number;
  if (spanOv != null && !(a.layout_hint && hinted)) {
    span = Math.min(t.columns, Math.max(1, spanOv));
    slot = `story_col_span-${span}-${n}`; cols = span;
  } else if (a.layout_hint && hinted) {
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

/** Rough height of a story in "word equivalents": copy + headline/kicker/sub furniture + photo. Only used to split pages; the real fit loop decides. */
export function estimateUnits(a: Article): number {
  return words(a) + 55 + (a.images.length ? 90 : 0);
}

/**
 * Split an ordered queue into `n` contiguous parts whose estimated loads are as even as possible
 * (front page counts as a little smaller: masthead). Cutting inside a section costs a little, so
 * sections stay together unless balance needs the cut. Exact DP, O(n^2 * parts), deterministic.
 */
export function partitionQueue(units: readonly number[], sections: readonly string[], n: number, caps: readonly number[]): number[] {
  const N = units.length;
  const pre = [0];
  for (const u of units) pre.push(pre[pre.length - 1]! + u);
  const target = pre[N]! / caps.reduce((x, y) => x + y, 0);
  const splitCost = (0.12 * target) ** 2;
  const cut = (i: number) => (i > 0 && i < N && sections[i - 1] === sections[i] ? splitCost : 0);
  const INF = Infinity;
  const best: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(N + 1).fill(INF));
  const from: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(N + 1).fill(0));
  best[0]![0] = 0;
  const minPer = N >= n ? 1 : 0;
  for (let p = 1; p <= n; p++)
    for (let i = 0; i <= N; i++)
      for (let j = 0; j <= i - minPer; j++) {
        const b = best[p - 1]![j]!;
        if (b === INF) continue;
        const load = (pre[i]! - pre[j]!) / caps[p - 1]!;
        const c = b + (load - target) ** 2 + (p < n ? cut(i) : 0);
        if (c < best[p]![i]!) { best[p]![i] = c; from[p]![i] = j; }
      }
  const ends: number[] = [];
  let i = N;
  for (let p = n; p >= 1; p--) { ends.unshift(i); i = from[p]![i]!; }
  return ends; // exclusive end index of each part
}

/** Penalty of one page for the search: 0 inside the band, growing below the target and steeply on overflow. */
const penalty = (fill: number, target: number): number => (fill > 1 ? 1 + 20 * (fill - 1) : fill < target ? (target - fill) * 2 : 0);

/**
 * Auto-plan: articles -> PageDocs for N pages. Deterministic (no AI, no clock, no randomness).
 *  1. sort by hint order / priority, group by section (sections in order of first appearance);
 *  2. estimate each story's height cheaply and cut the queue into N contiguous parts with even estimated
 *     load (lead stories land on page 1, sections stay together, the last section ends up last);
 *  3. run the real fit loop per page; a page left under the target is grown within the template's size limits;
 *  4. bounded local repair on pages that miss the 85..100 % band: move or swap a story with the neighbour page,
 *     then change a story's span by one column. Every evaluation is a real render, capped by `repairBudget`.
 * With bySection (the default when `pages` is not given) every section keeps its own page and only the
 * size / span repairs run. Whatever still overflows is reported, never hidden; an article that cannot fit
 * on any page even alone goes to `unplaced` with a reason.
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
  const qIndex = new Map(queue.map((a, i) => [a.id, i]));
  const byQ = (x: Article, y: Article) => qIndex.get(x.id)! - qIndex.get(y.id)!;
  const targetFill = opts.targetFill ?? 0.9;

  const unplaced: string[] = [];
  const reasons: { id: string; reason: string }[] = [];
  const giveUp = (a: Article, pct: number) => {
    unplaced.push(a.id);
    reasons.push({ id: a.id, reason: `"${a.headline}" is too long for any page: alone it overflows a whole page by ${pct}% even at the smallest text size. Cut it or run it over two pages.` });
  };
  // 3: real evaluation of a page, cached
  const spanOv = new Map<string, number>(); // article id -> span chosen by the repair
  let evaluations = 0;
  const budget = opts.repairBudget ?? 40;
  type Ev = { t: Template; fit: FitReport };
  const cache = new Map<string, Ev>();
  const evalPage = async (p: number, list: Article[]): Promise<Ev> => {
    const key = `${p}|${list.map((a) => `${a.id}:${spanOv.get(a.id) ?? ""}`).join(",")}`;
    const hit = cache.get(key);
    if (hit) return hit;
    evaluations++;
    const section = list[0] ? sectionKey(list[0]) : "";
    const t = pickVariant([...templates], p, list.length + (opts.ads?.filter((x) => x.page === p).length ?? 0));
    const used = new Set<string>();
    const items = list.map((a, i) => toItem(a, p, i + 1, t, used, spanOv.get(a.id)));
    (opts.ads ?? []).filter((x) => x.page === p).forEach((ad, i) =>
      items.push({ id: `it_p${p}ad${i + 1}`, kind: "ad", slot: `adverts-${i + 1}`, span: t.columns, cols: 1, image: { asset_id: ad.asset_id, ratio: ad.ratio ?? 9, cutout: false, focal: [0.5, 0.5] } }));
    const doc = buildDoc(p, t, items, opts, section);
    let fit = await engine.fit(doc, t, articles, opts.fit);
    if (!fit.overflow && list.length && fit.fill < targetFill) {
      const grown = await engine.fitGrow(doc, t, articles, targetFill);
      if (!grown.overflow && grown.fill > fit.fill) fit = grown;
    }
    const ev = { t, fit };
    cache.set(key, ev);
    return ev;
  };
  // a story far bigger than an average page is tried alone first; if it cannot fit even there it is set aside up front
  if (!bySection) {
    const mean = queue.reduce((n, a) => n + estimateUnits(a), 0) / nPages;
    for (const a of [...queue]) {
      if (estimateUnits(a) <= 1.5 * mean || queue.length <= 1) continue;
      const alone = await evalPage(1, [a]);
      if (alone.fit.overflow) { giveUp(a, alone.fit.overflow_pct); queue.splice(queue.indexOf(a), 1); }
    }
  }

  // 1-2: initial distribution
  let groups: Article[][] = [];
  if (bySection) {
    const rest = [...queue];
    for (let p = 1; p <= nPages; p++) {
      const last = p === nPages;
      const cur: Article[] = [];
      while (rest.length && (last || !cur.length || sectionKey(rest[0]!) === sectionKey(cur[0]!))) cur.push(rest.shift()!);
      groups.push(cur);
    }
  } else {
    const caps = Array.from({ length: nPages }, (_, i) => (i === 0 ? 0.9 : 1));
    const ends = partitionQueue(queue.map(estimateUnits), queue.map(sectionKey), nPages, caps);
    let from = 0;
    groups = ends.map((e) => { const g = queue.slice(from, e); from = e; return g; });
  }

  const evals: Ev[] = [];
  for (let p = 1; p <= nPages; p++) evals.push(await evalPage(p, groups[p - 1]!));
  const pen = (e: Ev, list: Article[]) => (list.length ? penalty(e.fit.fill, targetFill) : 1);
  const total = () => evals.reduce((n, e, i) => n + pen(e, groups[i]!), 0);
  const spent = () => evaluations - nPages >= budget;
  const bad = (i: number) => pen(evals[i]!, groups[i]!) > 0;

  // 4a: move / swap a story with a neighbour page (not when sections are pinned to pages)
  if (!bySection) {
    let improved = true;
    while (improved && !spent()) {
      improved = false;
      // worst page first, ties by page number
      const order2 = evals.map((_, i) => i).filter(bad).sort((a, b) => pen(evals[b]!, groups[b]!) - pen(evals[a]!, groups[a]!) || a - b);
      for (const i of order2) {
        if (improved || spent()) break;
        const over = evals[i]!.fit.fill > 1;
        const neighbours = [i - 1, i + 1].filter((j) => j >= 0 && j < nPages);
        // prefer the neighbour with the most room (when this page is over) or the fullest (when it is low)
        neighbours.sort((a, b) => (over ? evals[a]!.fit.fill - evals[b]!.fit.fill : evals[b]!.fit.fill - evals[a]!.fit.fill) || a - b);
        for (const j of neighbours) {
          const A = groups[i]!, B = groups[j]!;
          // boundary stories on each side: nearest to the other page in queue order
          const edgeA = j > i ? A.slice(-2).reverse() : A.slice(0, 2);
          const edgeB = j > i ? B.slice(0, 2) : B.slice(-2).reverse();
          const cands: { a: Article | null; b: Article | null }[] = [];
          if (over) { for (const a of edgeA) cands.push({ a, b: null }); } else { for (const b of edgeB) cands.push({ a: null, b }); }
          for (const a of edgeA) for (const b of edgeB) cands.push({ a, b });
          for (const c of cands) {
            if (spent()) break;
            if (c.a && A.length < 2 && !c.b) continue;
            if (c.b && B.length < 2 && !c.a) continue;
            const nA = [...A.filter((x) => x !== c.a), ...(c.b ? [c.b] : [])].sort(byQ);
            const nB = [...B.filter((x) => x !== c.b), ...(c.a ? [c.a] : [])].sort(byQ);
            const eA = await evalPage(i + 1, nA), eB = await evalPage(j + 1, nB);
            const before = pen(evals[i]!, A) + pen(evals[j]!, B);
            const after = pen(eA, nA) + pen(eB, nB);
            if (after < before - 1e-9) {
              groups[i] = nA; groups[j] = nB; evals[i] = eA; evals[j] = eB;
              improved = true;
              break;
            }
          }
          if (improved) break;
        }
      }
    }
  }

  // 4b: span repair, one column at a time, on pages still outside the band
  for (let i = 0; i < nPages && !spent(); i++) {
    let again = true;
    while (again && bad(i) && !spent()) {
      again = false;
      const list = groups[i]!;
      const free = list.filter((a) => !(a.layout_hint && kindOfHint(a.layout_hint.slot)));
      const over = evals[i]!.fit.fill > 1;
      for (const a of free) {
        if (spent() || again) break;
        const cur = evals[i]!.fit.doc.items.find((it) => it.article_id === a.id)?.span ?? 3;
        // too full: widen (shorter columns); too empty: narrow (taller)
        for (const d of over ? [1, -1] : [-1, 1]) {
          const next = cur + d;
          if (next < 2 || next > evals[i]!.t.columns || spent()) continue;
          const old = spanOv.get(a.id);
          spanOv.set(a.id, next);
          const e = await evalPage(i + 1, list);
          if (pen(e, list) < pen(evals[i]!, list) - 1e-9) { evals[i] = e; again = true; break; }
          if (old == null) spanOv.delete(a.id); else spanOv.set(a.id, old);
        }
      }
    }
  }

  // 5: nothing is lost. A story that overflows a page even alone at the smallest size cannot be placed anywhere.
  if (!bySection) {
    for (let i = 0; i < nPages; i++) {
      if (!evals[i]!.fit.overflow) continue;
      // the page is still over: test its biggest story alone on a page (one real evaluation)
      const big = [...groups[i]!].sort((a, b) => estimateUnits(b) - estimateUnits(a) || (a.id < b.id ? -1 : 1))[0]!;
      const alone = groups[i]!.length === 1 ? evals[i]! : await evalPage(i + 1, [big]);
      if (!alone.fit.overflow) continue;
      giveUp(big, alone.fit.overflow_pct);
      groups[i] = groups[i]!.filter((a) => a !== big);
      evals[i] = await evalPage(i + 1, groups[i]!);
    }
  }
  const result: PlannedPage[] = evals.map((e, i) => ({ doc: e.fit.doc, template: e.t, fit: e.fit, articles: groups[i]!.map((a) => a.id) }));
  return { pages: result, unplaced, unplaced_reasons: reasons, evaluations, elapsed_ms: Date.now() - t0 };
}
