import type { Article } from "@epaper/core";
import type { Slot, Template } from "./template.js";

/**
 * UNEVEN LAYOUT. A newspaper page has one dominant story (the biggest headline, the biggest photo, most of the columns) and
 * stories that step down from it, not a grid of near-equal boxes. A template opts in by having a slot with `tier: 1` (the lead);
 * slots with `tier` 2 and 3 give the next two steps their headline scale and photo ratio.
 *
 * The widths are chosen from an estimate of each story's height so the stories of one row come out about as tall as each other
 * (a row is as tall as its tallest story: a short story next to a long one leaves a hole). The estimate is rough on purpose; the
 * auto-plan then measures the real page, counts the holes (`hole_pct`) and repairs them.
 */
export interface TierPlan { span: number; cols: number; hs: number; ratio: number; tier: 1 | 2 | 3; row: number }

const tierSlot = (t: Template, n: number): Slot | undefined => t.slots.find((s) => s.tier === n);
export const isTiered = (t: Template): boolean => t.slots.some((s) => s.tier === 1);

const chars = (a: Article) => a.body.reduce((n, b) => n + [...b.text].length, 0);
function charWidth(a: Article): number {
  const s = a.body.map((b) => b.text).join("").slice(0, 400);
  return /[஀-௿]/.test(s) ? 0.7 : /[਀-੿]/.test(s) ? 0.6 : 0.5; // em per character: Tamil and Gurmukhi are wider than Latin
}

/** Text columns for a story of `span` grid columns on a ruled page: a 2-wide story is ONE column (136 px columns are too narrow to read). */
export function tierCols(span: number, t: Pick<Template, "body">): number {
  return span <= 2 ? 1 : Math.max(1, Math.round(span / (t.body.span_per_col ?? 1)));
}

function spanPx(span: number, t: Template): number {
  const colW = (t.canvas_px - t.pad.left - t.pad.right - t.gap.col_px * (t.columns - 1)) / t.columns;
  return span * colW + (span - 1) * t.gap.col_px;
}

/** Estimated height (canvas px) of a story `span` columns wide with headline scale `hs` and photo ratio `ratio`. */
export function estimateHeight(a: Article, span: number, t: Template, hs: number, ratio: number): number {
  const W = spanPx(span, t);
  const fs = (t.body.start_px + t.body.min_px) / 2;
  const cw = charWidth(a);
  const paras = a.body.length;
  const text = (chars(a) * cw * fs * fs * t.body.line_height) / W + fs * t.body.line_height * (1 + 0.45 * paras);
  const headPx = Math.min(20 + span * 5.5, 58) * hs;
  const headLines = Math.max(1, Math.ceil(([...a.headline].length * Math.max(cw, 0.5) * 1.05 * headPx) / W));
  const head = headLines * headPx * 1.24 + 8;
  const sub = a.subhead ? Math.ceil(([...a.subhead].length * cw * 19) / W) * 19 * 1.38 + 10 : 0;
  const photo = a.images.length ? W / ratio + 6 + (a.images[0]!.caption ? 34 : 4) : 0;
  return 14 + (a.kicker ? 26 : 0) + head + sub + (a.byline ? 34 : 0) + photo + text;
}

/**
 * Photo ratio (width / height) for a story of `span` columns: the lead keeps its own big ratio at any width; the others get the
 * tier's ratio when narrow and a flatter one when wide, so a wide secondary story never gets a photo taller than the lead's.
 */
export function tierRatio(tier: 1 | 2 | 3, span: number, base: number): number {
  if (tier === 1) return base;
  return span <= 3 ? base : span <= 5 ? Math.max(base, 2.4) : Math.max(base, 3.6);
}

function compositions(total: number, k: number, min: number): number[][] {
  if (k === 1) return total >= min ? [[total]] : [];
  const out: number[][] = [];
  for (let first = min; first <= total - min * (k - 1); first++) for (const rest of compositions(total - first, k - 1, min)) out.push([first, ...rest]);
  return out;
}

/**
 * Choose rows and widths for the stories of one page, in order (the first is the lead). Exact DP over contiguous rows of one to
 * three stories; `compact` (0-3) makes headlines a little smaller and photos flatter, which the auto-plan asks for when a page overflows. A row's cost is how uneven its story heights are. The lead's row gives the lead at least 60 % of the columns
 * (or the whole width when it stands alone). Deterministic: no randomness, ties go to the first option.
 */
export function planTiers(list: readonly Article[], t: Template, compact = 0): TierPlan[] {
  const n = list.length;
  if (!n) return [];
  const T1 = tierSlot(t, 1)!, T2 = tierSlot(t, 2) ?? T1, T3 = tierSlot(t, 3) ?? T2;
  const C = t.columns;
  const minSpan = 2;
  const leadMin = Math.ceil(C * 0.6);
  const look = (tier: 1 | 2 | 3, span: number) => { const s = tier === 1 ? T1 : tier === 2 ? T2 : T3; return { hs: Math.max(0.8, (s.hs ?? 1) - (tier === 1 ? 0.1 : 0.05) * compact), ratio: tierRatio(tier, span, s.ratio ?? 1.8) * (1 + 0.3 * compact) }; };
  const maxRow = Math.min(3, Math.floor(C / minSpan));
  type Row = { cost: number; spans: number[]; tiers: (1 | 2 | 3)[] };
  const rowCost = (i: number, j: number, rowNo: number): Row | null => {
    const k = j - i;
    let best: Row | null = null;
    for (const comp of compositions(C, k, minSpan)) {
      if (i === 0 && k > 1 && comp[0]! < leadMin) continue;
      // a story after the lead is never wider than the lead
      const tiers = comp.map((_, x) => (i + x === 0 ? 1 : rowNo === 1 ? 2 : 3) as 1 | 2 | 3);
      const hs = comp.map((sp, x) => estimateHeight(list[i + x]!, sp, t, look(tiers[x]!, sp).hs, look(tiers[x]!, sp).ratio));
      const hi = Math.max(...hs), lo = Math.min(...hs);
      // uneven row = a hole; a lone story spans the full width and has none. Prefer wider columns for the taller story (comp order = story order).
      const cost = k === 1 ? (i === 0 ? 0.15 : 0.15 + (list[i]!.images.length ? 0.2 : 0)) : (hi - lo) / hi;
      if (!best || cost < best.cost - 1e-9) best = { cost, spans: comp, tiers };
    }
    return best;
  };
  // f[i] = best cost of arranging the first i stories; rows numbered from 0
  const f: number[] = new Array(n + 1).fill(Infinity);
  const from: { j: number; row: Row }[] = new Array(n + 1);
  const rowNoAt: number[] = new Array(n + 1).fill(0);
  f[0] = 0;
  // rows are numbered by their start, which depends on the path: carry the count along the best path
  for (let j = 1; j <= n; j++) {
    for (let k = 1; k <= maxRow && k <= j; k++) {
      const i = j - k;
      if (f[i] === Infinity) continue;
      const row = rowCost(i, j, rowNoAt[i]!);
      if (!row) continue;
      // the lead's row must contain story 0: it starts at i = 0 by construction
      const c = f[i]! + row.cost;
      if (c < f[j]! - 1e-9) { f[j] = c; from[j] = { j: i, row }; rowNoAt[j] = rowNoAt[i]! + 1; }
    }
  }
  const out: TierPlan[] = new Array(n);
  let j = n;
  let rowNo = rowNoAt[n]! - 1;
  while (j > 0) {
    const { j: i, row } = from[j]!;
    for (let x = 0; x < row.spans.length; x++) {
      const tier = row.tiers[x]!;
      out[i + x] = { span: row.spans[x]!, cols: tierCols(row.spans[x]!, t), ...look(tier, row.spans[x]!), tier, row: rowNo };
    }
    j = i; rowNo--;
  }
  return out;
}
