import { packSpans } from "@epaper/layout/src/pack.js";

/**
 * Pure helpers for the flow layout: a page is an ORDERED list of blocks with a width (`span`, 1-8 grid columns)
 * and `cols` (text columns inside the block). There are no x/y positions; the row packer places the blocks.
 * Everything here works on plain numbers and rectangles so it can be unit tested without a browser.
 */
export const COLUMNS = 8;
/** Pointer movement below this many px is a click, not a drag. */
export const DRAG_THRESHOLD_PX = 4;
/** Arrow keys of one run (same key, within this many ms) are ONE undo step. */
export const KEY_RUN_MS = 600;
/** Screen px (at zoom 1) of upward pointer travel per text column when dragging the bottom handle. */
export const COLS_STEP_PX = 50;

export const clampSpan = (v: number, columns = COLUMNS) => Math.min(columns, Math.max(1, Math.round(v)));
/** Text columns: 1 up to the block's own width (more columns than grid columns makes no sense). */
export const clampCols = (v: number, span: number) => Math.min(Math.max(1, Math.round(span)), Math.max(1, Math.round(v)));

export interface Rect { id: string; x: number; y: number; w: number; h: number }
export interface Slot { row: number; col: number; span: number }

/** Row/column of every block once packed (the packer fills rows exactly, so this is a running sum). */
export function slotsOf(spans: readonly number[], columns = COLUMNS): Slot[] {
  const packed = packSpans(spans, columns);
  let col = 0, row = 0;
  return packed.map((span) => {
    const s = { row, col, span };
    col += span;
    if (col >= columns) { col = 0; row++; }
    return s;
  });
}

/** Remove the item at `from` and insert it so it ends up at index `to`. */
export function moveInOrder<T>(items: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length) return [...items];
  const t = Math.min(items.length - 1, Math.max(0, to));
  const out = [...items];
  const [it] = out.splice(from, 1);
  out.splice(t, 0, it!);
  return out;
}

/** Split rects (in reading order) into rows: a new row starts when a block is not to the right of the one before it. */
export function rowsOf(rects: readonly Rect[]): Rect[][] {
  const rows: Rect[][] = [];
  for (const r of rects) {
    const row = rows[rows.length - 1];
    const prev = row?.[row.length - 1];
    if (!row || !prev || r.x <= prev.x + 0.5) rows.push([r]);
    else row.push(r);
  }
  return rows;
}
export const rowTop = (row: readonly Rect[]) => Math.min(...row.map((r) => r.y));
export const rowBottom = (row: readonly Rect[]) => Math.max(...row.map((r) => r.y + r.h));

/**
 * Where does the dragged block go if dropped with the pointer at (px, py)? Returns the index it will have in the
 * item order after the move (= insertion index in the list without the dragged block). Uses the rendered rects.
 */
export function dropIndex(rects: readonly Rect[], dragId: string, px: number, py: number): number {
  const others = rects.filter((r) => r.id !== dragId);
  if (!others.length) return 0;
  const rows = rowsOf(others);
  let r = 0;
  rows.forEach((row, i) => { if (py >= rowTop(row)) r = i; });
  if (r === rows.length - 1 && py > rowBottom(rows[r]!)) return others.length;
  let n = rows.slice(0, r).reduce((a, row) => a + row.length, 0);
  for (const it of rows[r]!) if (px > it.x + it.w / 2) n++;
  return n;
}

/** Where will the block land (logical row + column + packed width) after moving item `from` to index `to`? */
export function predictSlot(spans: readonly number[], from: number, to: number, columns = COLUMNS): Slot {
  return slotsOf(moveInOrder(spans, from, to), columns)[Math.min(spans.length - 1, Math.max(0, to))]!;
}

/** Arrow Up/Down: the new index that puts the block in the row above/below, nearest column first. null = no such row. */
export function rowStep(spans: readonly number[], idx: number, dir: -1 | 1, columns = COLUMNS): number | null {
  const cur = slotsOf(spans, columns)[idx];
  if (!cur) return null;
  let best: { to: number; dc: number; di: number } | null = null;
  for (let to = 0; to < spans.length; to++) {
    if (to === idx) continue;
    const s = predictSlot(spans, idx, to, columns);
    if (s.row !== cur.row + dir) continue;
    const c = { to, dc: Math.abs(s.col - cur.col), di: Math.abs(to - idx) };
    if (!best || c.dc < best.dc || (c.dc === best.dc && c.di < best.di)) best = c;
  }
  return best ? best.to : null;
}

/** Width in whole columns for a pointer at `px`, dragging the right edge (blockLeft fixed). */
export function spanFromRight(px: number, blockLeft: number, pitch: number, gap: number, columns = COLUMNS) {
  return clampSpan((px - blockLeft + gap) / pitch, columns);
}
/** Same, dragging the left edge (blockRight fixed). */
export function spanFromLeft(px: number, blockRight: number, pitch: number, gap: number, columns = COLUMNS) {
  return clampSpan((blockRight - px + gap) / pitch, columns);
}
/** Text columns while dragging the bottom handle: pulling it UP makes the block shorter = more columns. */
export function colsFromDrag(startCols: number, startY: number, py: number, span: number, stepPx: number) {
  return clampCols(startCols + (startY - py) / stepPx, span);
}

/** Readout text for the selection. */
export const readoutText = (span: number, cols: number, index: number, total: number) =>
  `Width ${span} of ${COLUMNS} · Text columns ${cols} · Place ${index + 1} of ${total}`;
