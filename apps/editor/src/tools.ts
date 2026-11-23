import type { PageDoc, PageItem } from "@epaper/core";
import { defaultRatio, packedSpans, type Template } from "./layout";

export type Docs = Record<string, PageDoc>;

/** Everything a tool needs to know that is not in the docs themselves. */
export interface ToolCtx {
  /** Page ids in page order. */
  order: string[];
  templateOf(pageId: string): Template;
  /** True when this asset id has a picture we can show (so "Remove" can tell a filled slot from an empty one). */
  hasSrc(assetId: string): boolean;
}
export type ToolAction = "span-" | "span+" | "cols-" | "cols+" | "hs-" | "hs+" | "ar-" | "ar+" | "mv-" | "mv+" | "imgx" | "del";
export interface ToolResult {
  docs: Docs;
  /** Page the item is on afterwards (changes on a move across pages). */
  pageId: string;
  note?: string;
  /** Pages whose docs changed. */
  touched: string[];
}
export const EMPTY_ASSET = "ast_empty-slot";
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r2 = (v: number) => +v.toFixed(2);

function withItem(docs: Docs, pageId: string, itemId: string, fn: (it: PageItem) => PageItem): Docs {
  const d = docs[pageId];
  if (!d) return docs;
  return { ...docs, [pageId]: { ...d, items: d.items.map((i) => (i.id === itemId ? fn(i) : i)) } };
}
const find = (docs: Docs, pageId: string, itemId: string) => docs[pageId]?.items.find((i) => i.id === itemId);

/**
 * The prototype's #tool click handler, ported 1:1.
 * Spans are read AFTER row packing (the prototype read them from the DOM), then stored on the item.
 */
export function applyTool(docs: Docs, pageId: string, itemId: string, a: ToolAction, ctx: ToolCtx): ToolResult | null {
  const doc = docs[pageId];
  const item = find(docs, pageId, itemId);
  if (!doc || !item) return null;
  const t = ctx.templateOf(pageId);
  const idx = doc.items.findIndex((i) => i.id === itemId);
  const spanNow = packedSpans(doc, t)[idx]!;
  const colsNow = item.cols ?? (item.kind === "ad" ? 1 : spanNow);
  const done = (d: Docs, extra: Partial<ToolResult> = {}): ToolResult => ({ docs: d, pageId, touched: [pageId], ...extra });

  if (a === "span-" || a === "span+") {
    const v = clamp(spanNow + (a === "span+" ? 1 : -1), 1, 8);
    let cols = colsNow;
    if (item.kind !== "ad" && colsNow === spanNow) cols = v;
    if (cols > v) cols = v;
    return done(withItem(docs, pageId, itemId, (i) => ({ ...i, span: v, cols })));
  }
  if (a === "cols-" || a === "cols+") {
    const v = clamp(colsNow + (a === "cols+" ? 1 : -1), 1, 8);
    return done(withItem(docs, pageId, itemId, (i) => ({ ...i, span: spanNow, cols: v })));
  }
  if (a === "hs-" || a === "hs+") {
    const v = clamp(r2((item.hs ?? 1) + (a === "hs+" ? 0.1 : -0.1)), 0.5, 2);
    return done(withItem(docs, pageId, itemId, (i) => ({ ...i, hs: v })));
  }
  if (a === "ar-" || a === "ar+") {
    if (!item.image) return null;
    const cur = item.image.ratio ?? defaultRatio(item.kind, spanNow);
    const v = clamp(r2(cur * (a === "ar+" ? 1.2 : 1 / 1.2)), 0.6, 12);
    return done(withItem(docs, pageId, itemId, (i) => ({ ...i, image: { ...i.image!, ratio: v } })));
  }
  if (a === "mv-" || a === "mv+") {
    const fwd = a === "mv+";
    const j = idx + (fwd ? 1 : -1);
    if (j >= 0 && j < doc.items.length) {
      const items = [...doc.items];
      [items[idx], items[j]] = [items[j]!, items[idx]!];
      return done({ ...docs, [pageId]: { ...doc, items } });
    }
    const pi = ctx.order.indexOf(pageId);
    const target = ctx.order[pi + (fwd ? 1 : -1)];
    if (!target || !docs[target]) return null;
    const moved: PageItem = { ...item, span: spanNow, cols: colsNow };
    const src = { ...doc, items: doc.items.filter((i) => i.id !== itemId) };
    const dst = docs[target]!;
    const dstItems = fwd ? [moved, ...dst.items] : [...dst.items, moved];
    return {
      docs: { ...docs, [pageId]: src, [target]: { ...dst, items: dstItems } },
      pageId: target,
      touched: [pageId, target],
      note: `Moved to page ${docs[target]!.page.no}`,
    };
  }
  if (a === "imgx") {
    if (!item.image) return null;
    const filled = ctx.hasSrc(item.image.asset_id);
    if (item.kind === "ad" || filled) {
      // fillFig(): empty the slot but keep it
      return done(withItem(docs, pageId, itemId, (i) => ({ ...i, image: { ...i.image!, asset_id: EMPTY_ASSET as never, cutout: false } })));
    }
    return done(withItem(docs, pageId, itemId, (i) => {
      const { image: _drop, ...rest } = i;
      return rest;
    }));
  }
  if (a === "del") {
    return done({ ...docs, [pageId]: { ...doc, items: doc.items.filter((i) => i.id !== itemId) } });
  }
  return null;
}

/** Add / swap a photo (prototype `img`): creates the slot when the story has none. */
export function setPhoto(docs: Docs, pageId: string, itemId: string, assetId: string): Docs {
  return withItem(docs, pageId, itemId, (i) => ({
    ...i,
    image: { asset_id: assetId as never, ratio: i.image?.ratio ?? 1.78, cutout: false, focal: i.image?.focal ?? [0.5, 0.4] },
  }));
}
/** Add an empty photo slot so the sub can tap it and pick a file. */
export function ensureSlot(docs: Docs, pageId: string, itemId: string): Docs {
  const it = find(docs, pageId, itemId);
  if (!it || it.image) return docs;
  return withItem(docs, pageId, itemId, (i) => ({ ...i, image: { asset_id: EMPTY_ASSET as never, ratio: 1.78, cutout: false, focal: [0.5, 0.4] } }));
}
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export function setFocal(docs: Docs, pageId: string, itemId: string, x: number, y: number): Docs {
  return withItem(docs, pageId, itemId, (i) => (i.image ? { ...i, image: { ...i.image, focal: [r2(clamp01(x)), r2(clamp01(y))] } } : i));
}
/** Crop = the shape of the frame (width / height). The focal point decides which part stays in. */
export function setRatio(docs: Docs, pageId: string, itemId: string, ratio: number): Docs {
  return withItem(docs, pageId, itemId, (i) => (i.image ? { ...i, image: { ...i.image, ratio: clamp(r2(ratio), 0.6, 12) } } : i));
}
export function setCutout(docs: Docs, pageId: string, itemId: string, assetId: string): Docs {
  return withItem(docs, pageId, itemId, (i) => (i.image ? { ...i, image: { ...i.image, asset_id: assetId as never, cutout: true } } : i));
}

/** Text typed in the page, read back from the DOM (see PageView.readText). */
export interface TextSnapshot {
  items: { id: string; kicker?: string; head?: string; sub?: string; body?: string[] }[];
  furniture?: { masthead?: string; tagline?: string; strip?: string[] };
}
export function applyText(doc: PageDoc, s: TextSnapshot): PageDoc {
  let changed = false;
  const items = doc.items.map((it) => {
    const sn = s.items.find((x) => x.id === it.id);
    if (!sn || !it.text) return it;
    const tx = it.text;
    const next = { ...tx };
    if (sn.kicker !== undefined && sn.kicker !== (tx.kicker ?? "")) next.kicker = sn.kicker;
    if (sn.head !== undefined && sn.head !== tx.head) next.head = sn.head;
    if (sn.sub !== undefined && sn.sub !== (tx.sub ?? "")) next.sub = sn.sub === "" && tx.sub == null ? tx.sub : sn.sub;
    if (sn.body !== undefined && JSON.stringify(sn.body) !== JSON.stringify(tx.body)) next.body = sn.body;
    if (JSON.stringify(next) === JSON.stringify(tx)) return it;
    changed = true;
    return { ...it, text: next };
  });
  let furniture = doc.furniture;
  if (s.furniture && furniture) {
    const f = s.furniture;
    const nf = { ...furniture };
    if (f.masthead !== undefined) nf.masthead = f.masthead;
    if (f.tagline !== undefined) nf.tagline = f.tagline;
    if (f.strip) nf.strip = [0, 1, 2].map((i) => f.strip![i] ?? furniture!.strip[i] ?? "");
    if (JSON.stringify(nf) !== JSON.stringify(furniture)) {
      furniture = nf;
      changed = true;
    }
  }
  return changed ? { ...doc, items, furniture } : doc;
}

let seq = 0;
export const newItemId = (): `it_${string}` => `it_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Add story (prototype #addStory): a 4-wide story straight after the selected one, or at the end. */
export function addStory(docs: Docs, pageId: string, afterId: string | null, id: string = newItemId()): Docs {
  const d = docs[pageId];
  if (!d) return docs;
  const n = d.items.length + 1;
  const item: PageItem = { id: id as never, kind: "story", slot: `story_col_span-4-${n}`, span: 4, cols: 4, hs: 1, text: { kicker: null, head: "", sub: null, body: [] } };
  const at = afterId ? d.items.findIndex((i) => i.id === afterId) : -1;
  const items = at >= 0 ? [...d.items.slice(0, at + 1), item, ...d.items.slice(at + 1)] : [...d.items, item];
  return { ...docs, [pageId]: { ...d, items } };
}
/** Place a story from the tray: a new item built from an article's print copy. */
export function placeArticle(
  docs: Docs,
  pageId: string,
  a: { id: string; rev: number; kicker?: string | null; headline: string; subhead?: string | null; paras: string[]; image?: { asset_id: string } },
  id: string = newItemId(),
): Docs {
  const d = docs[pageId];
  if (!d) return docs;
  const item: PageItem = {
    id: id as never,
    kind: "story",
    article_id: a.id as never,
    article_rev: a.rev,
    slot: "story_col_span-4-" + (d.items.length + 1),
    span: 4,
    cols: 4,
    hs: 1,
    text: { kicker: a.kicker ?? null, head: a.headline, sub: a.subhead ?? null, body: a.paras },
    ...(a.image ? { image: { asset_id: a.image.asset_id as never, ratio: 2.3, cutout: false, focal: [0.5, 0.4] as [number, number] } } : {}),
  };
  return { ...docs, [pageId]: { ...d, items: [...d.items, item] } };
}

export const PAGE_SIZES = [
  { id: "broadsheet", label: "Broadsheet 381×578", w: 381, h: 578 },
  { id: "berliner", label: "Berliner 315×470", w: 315, h: 470 },
  { id: "tabloid", label: "Tabloid 280×430", w: 280, h: 430 },
  { id: "a3", label: "A3 297×420", w: 297, h: 420 },
] as const;
export function setPageSize(docs: Docs, pageId: string, sizeId: string): Docs {
  const s = PAGE_SIZES.find((x) => x.id === sizeId);
  const d = docs[pageId];
  if (!s || !d) return docs;
  return { ...docs, [pageId]: { ...d, page: { ...d.page, size: s.id, w_mm: s.w, h_mm: s.h } } };
}
export function setStatus(docs: Docs, pageId: string, status: string): Docs {
  const d = docs[pageId];
  return d ? { ...docs, [pageId]: { ...d, status } } : docs;
}
