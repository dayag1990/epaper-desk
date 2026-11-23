import { describe, expect, it } from "vitest";
import type { PageDoc } from "@epaper/core";
import { History } from "../src/history";
import { clampCols, clampSpan, colsFromDrag, dropIndex, moveInOrder, predictSlot, rowStep, rowsOf, slotsOf, spanFromLeft, spanFromRight, type Rect } from "../src/flow";
import { applyTool, moveTo, resizeItem, type Docs, type ToolCtx } from "../src/tools";
import { templateFor } from "../src/templates";
import { buildSeed } from "../mock/seed";

// A 8-column page: [A 5][B 3] / [C 3][D 2][E 3]. Pitch 100, gap 0 for the geometry tests.
const R = (id: string, col: number, span: number, row: number): Rect => ({ id, x: col * 100, y: row * 300, w: span * 100, h: 200 });
const rects = [R("A", 0, 5, 0), R("B", 5, 3, 0), R("C", 0, 3, 1), R("D", 3, 2, 1), R("E", 5, 3, 1)];

describe("flow: pure slot logic", () => {
  it("slotsOf gives row and column of the packed blocks", () => {
    expect(slotsOf([5, 3, 3, 2, 3])).toEqual([
      { row: 0, col: 0, span: 5 }, { row: 0, col: 5, span: 3 },
      { row: 1, col: 0, span: 3 }, { row: 1, col: 3, span: 2 }, { row: 1, col: 5, span: 3 },
    ]);
    // the packer stretches the last block of a row: 3 + 3 + 3 -> the 2nd row-mate takes the gap
    expect(slotsOf([3, 3, 3]).map((s) => s.span)).toEqual([3, 5, 3 + 5]);
  });
  it("rowsOf splits rendered rects into rows", () => {
    expect(rowsOf(rects).map((r) => r.map((x) => x.id).join(""))).toEqual(["AB", "CDE"]);
  });
  it("moveInOrder removes and re-inserts, clamped", () => {
    expect(moveInOrder(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveInOrder(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveInOrder(["a", "b"], 0, 99)).toEqual(["b", "a"]);
    expect(moveInOrder(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });
  it("dropIndex details", () => {
    expect(dropIndex(rects, "D", 100, 50)).toBe(0);
    expect(dropIndex(rects, "D", 400, 50)).toBe(1); // right half of A, before B
    expect(dropIndex(rects, "D", 700, 50)).toBe(2); // right of B: end of row 0
    expect(dropIndex(rects, "A", 50, 350)).toBe(1); // row 1 (others: B / C D E), left of C
    expect(dropIndex(rects, "A", 790, 350)).toBe(4); // right of E
    expect(dropIndex(rects, "A", 50, 900)).toBe(4); // below everything: the end
    expect(dropIndex([R("A", 0, 8, 0)], "A", 5, 5)).toBe(0);
  });
  it("predictSlot says where the moved block really lands after the packer", () => {
    expect(predictSlot([5, 3, 3, 2, 3], 1, 0)).toEqual({ row: 0, col: 0, span: 3 });
    expect(predictSlot([5, 3, 3, 2, 3], 0, 4)).toEqual({ row: 1, col: 3, span: 5 });
  });
  it("rowStep: nearest slot in the row above / below, null when there is none", () => {
    const spans = [5, 3, 3, 2, 3];
    const up = rowStep(spans, 3, -1)!; // D (row 1, col 3)
    expect(slotsOf(moveInOrder(spans, 3, up))[up]!.row).toBe(0);
    expect(rowStep(spans, 0, -1)).toBeNull();
    const down = rowStep(spans, 0, 1)!;
    expect(down).toBeGreaterThan(0);
    expect(slotsOf(moveInOrder(spans, 0, down))[down]!.row).toBeGreaterThan(0);
  });
  it("span and cols are clamped", () => {
    expect(clampSpan(0)).toBe(1);
    expect(clampSpan(11)).toBe(8);
    expect(clampSpan(3.6)).toBe(4);
    expect(clampCols(0, 4)).toBe(1);
    expect(clampCols(7, 4)).toBe(4); // never more text columns than grid columns
    expect(clampCols(3, 8)).toBe(3);
  });
  it("edge resize math snaps to whole columns at any zoom (pitch already includes the zoom)", () => {
    for (const z of [0.25, 0.5, 1, 1.5]) {
      const pitch = 200 * z, gap = 24 * z;
      expect(spanFromRight(1000 * z + 2 * pitch + 0.3 * pitch, 1000 * z, pitch, gap)).toBe(clampSpan(Math.round((2 * pitch + 0.3 * pitch + gap) / pitch)));
      expect(spanFromRight(1000 * z + 3 * pitch - gap, 1000 * z, pitch, gap)).toBe(3);
      expect(spanFromLeft(1000 * z - 2 * pitch + gap, 1000 * z, pitch, gap)).toBe(2);
    }
  });
  it("colsFromDrag: up = more columns, steps by the (zoomed) step, clamped to the width", () => {
    expect(colsFromDrag(3, 500, 500, 5, 50)).toBe(3);
    expect(colsFromDrag(3, 500, 400, 5, 50)).toBe(5);
    expect(colsFromDrag(3, 500, 300, 5, 50)).toBe(5);
    expect(colsFromDrag(3, 500, 600, 5, 50)).toBe(1);
    expect(colsFromDrag(3, 500, 450, 5, 25)).toBe(5);
  });
});

describe("flow: run coalescing", () => {
  it("same key within the window is one undo step; a pause or another key is a new one", () => {
    const h = new History<number>(0);
    h.push(1, "k", 1000, 600);
    h.push(2, "k", 1200, 600);
    h.push(3, "k", 1700, 600); // rolling: 500 ms after the last press
    expect(h.undo()).toBe(0);
    expect(h.canUndo).toBe(false);
    h.redo();
    h.push(4, "k", 5000, 600); // long pause
    expect(h.undo()).toBe(3);
    h.push(5, "x", 5100, 600); // other key
    h.push(6, "y", 5200, 600);
    expect(h.undo()).toBe(5);
    expect(h.undo()).toBe(3);
  });
  it("typing keeps its own longer window", () => {
    const h = new History<number>(0);
    h.push(1, "text", 0);
    h.push(2, "text", 1000);
    expect(h.undo()).toBe(0);
  });
});

describe("flow: moves and resizes through the shared tools", () => {
  const s = buildSeed("");
  const docs: Docs = Object.fromEntries(s.pages.map((p) => [p.id, p.doc]));
  const ctx: ToolCtx = { order: s.pages.map((p) => p.id), templateOf: (id) => templateFor(docs[id]!, s.templates), hasSrc: () => true };
  const ids = (d: Docs, p: string) => d[p]!.items.map((i) => i.id);

  it("moveTo changes the order only, never the span", () => {
    const out = moveTo(docs, "pg_front", "it_1x4", 0);
    expect(ids(out, "pg_front")).toEqual(["it_1x4", "it_1x1", "it_1x2", "it_1x3", "it_1x5"]);
    expect(out.pg_front!.items.map((i) => i.span)).toEqual([2, 5, 3, 3, 3]);
    expect(moveTo(docs, "pg_front", "it_1x4", 3)).toBe(docs);
  });
  it("row-/row+ move the block to the row above / below via the tool path", () => {
    const up = applyTool(docs, "pg_front", "it_1x4", "row-", ctx)!;
    const i = ids(up.docs, "pg_front").indexOf("it_1x4");
    expect(i).toBeLessThan(3);
    expect(applyTool(docs, "pg_front", "it_1x1", "row-", ctx)).toBeNull();
  });
  it("keyboard steps use the same width/columns rules as the buttons", () => {
    const w = applyTool(docs, "pg_front", "it_1x1", "span-", ctx)!;
    expect(w.docs.pg_front!.items[0]).toMatchObject({ span: 4, cols: 4 });
    const c = applyTool(w.docs, "pg_front", "it_1x1", "cols+", ctx)!;
    expect(c.docs.pg_front!.items[0]!.cols).toBe(4); // clamped to the width
    const c2 = applyTool(w.docs, "pg_front", "it_1x1", "cols-", ctx)!;
    expect(c2.docs.pg_front!.items[0]!.cols).toBe(3);
  });
  it("resize e/w/s", () => {
    const e = resizeItem(docs, "pg_front", "it_1x1", "e", 3, ctx)!;
    expect(e.docs.pg_front!.items[0]).toMatchObject({ span: 3, cols: 3 });
    expect(resizeItem(docs, "pg_front", "it_1x1", "e", 5, ctx)).toBeNull();
    const s2 = resizeItem(docs, "pg_front", "it_1x1", "s", 2, ctx)!;
    expect(s2.docs.pg_front!.items[0]).toMatchObject({ span: 5, cols: 2 });
    // left edge, one column wider: the row-mate before gives one up, so the right edge stays
    const w = resizeItem(docs, "pg_front", "it_1x2", "w", 4, ctx)!;
    expect(w.docs.pg_front!.items.slice(0, 2).map((i) => i.span)).toEqual([4, 4]);
    // first in its row: only the width changes
    const w1 = resizeItem(docs, "pg_front", "it_1x3", "w", 4, ctx)!;
    expect(w1.docs.pg_front!.items.map((i) => i.span)).toEqual([5, 3, 4, 2, 3]);
    // narrow from the left: the row-mate takes the column
    const w2 = resizeItem(docs, "pg_front", "it_1x2", "w", 2, ctx)!;
    expect(w2.docs.pg_front!.items.slice(0, 2).map((i) => i.span)).toEqual([6, 2]);
  });
  it("a moved/resized doc still has no free x/y", () => {
    const out = resizeItem(moveTo(docs, "pg_front", "it_1x4", 0), "pg_front", "it_1x4", "e", 4, ctx)!;
    for (const it of out.docs.pg_front!.items) expect(Object.keys(it).filter((k) => k === "x" || k === "y")).toEqual([]);
    expect((out.docs.pg_front as PageDoc).items.length).toBe(5);
  });
});
