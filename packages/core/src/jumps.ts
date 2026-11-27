import type { PageDoc, PageItem } from "./contracts/d3-pagedoc.js";

/**
 * "Continued on page N" / "Continued from page N" bookkeeping. A story that runs over two pages is two items, each with a
 * `jump` pointing at the other (`pair`). The page number printed on a jump line is the OTHER half's page number; it is kept
 * here, in one pure function, so a page delete or renumber can never leave a wrong number behind.
 */

/**
 * Set every jump's `page` to the page number its partner is on now. A jump whose partner is gone (the page was deleted, the
 * story went back to the tray) or does not point back is dropped, so no line ever says "Continued on page 7" for a page
 * that does not exist. Returns the SAME array and objects when nothing changed.
 */
export function syncJumps<D extends PageDoc>(docs: readonly D[]): D[] {
  const at = new Map<string, { no: number; item: PageItem }>();
  for (const d of docs) for (const it of d.items) at.set(it.id, { no: d.page.no, item: it });
  let changed = false;
  const out = docs.map((d) => {
    let dc = false;
    const items = d.items.map((it) => {
      if (!it.jump) return it;
      const mate = at.get(it.jump.pair);
      const ok = mate && mate.item.jump && mate.item.jump.pair === it.id && mate.item.jump.role !== it.jump.role;
      if (!ok) { dc = true; const { jump: _j, ...rest } = it; return rest as PageItem; }
      if (it.jump.page === mate.no) return it;
      dc = true;
      return { ...it, jump: { ...it.jump, page: mate.no } };
    });
    if (!dc) return d;
    changed = true;
    return { ...d, items };
  });
  return changed ? out : (docs as D[]);
}

export interface ContinueOptions {
  /** Item that runs on. */
  item: string;
  /** Page (by number) that gets the rest. */
  toPage: number;
  /** First paragraph (0-based) that moves to the other page; 1..body.length-1. Default: the middle. */
  atPara?: number;
  /** Id of the new item on the other page. */
  newId: PageItem["id"];
}

/**
 * Split a story over two pages: the first part stays, the rest becomes a new item at the top of `toPage`, and both get a
 * jump. Returns null when it cannot be done (no such item or page, same page, fewer than two paragraphs).
 */
export function continueStory<D extends PageDoc>(docs: readonly D[], o: ContinueOptions): D[] | null {
  const src = docs.find((d) => d.items.some((i) => i.id === o.item));
  const dst = docs.find((d) => d.page.no === o.toPage);
  const it = src?.items.find((i) => i.id === o.item);
  if (!src || !dst || !it?.text || src === dst || it.text.body.length < 2 || it.jump) return null;
  const at = Math.min(it.text.body.length - 1, Math.max(1, o.atPara ?? Math.ceil(it.text.body.length / 2)));
  const first: PageItem = { ...it, text: { ...it.text, body: it.text.body.slice(0, at) }, jump: { role: "to", pair: o.newId, page: dst.page.no } };
  const rest: PageItem = {
    id: o.newId,
    kind: "story",
    ...(it.article_id ? { article_id: it.article_id } : {}),
    ...(it.article_rev != null ? { article_rev: it.article_rev } : {}),
    slot: `story_col_span-${it.span ?? 4}-${dst.items.length + 1}`,
    span: it.span ?? 4,
    cols: it.cols,
    hs: Math.max(0.6, (it.hs ?? 1) * 0.7),
    text: { kicker: null, head: it.text.head, sub: null, body: it.text.body.slice(at) },
    ...(it.styles ? { styles: it.styles } : {}),
    jump: { role: "from", pair: it.id, page: src.page.no },
  };
  return docs.map((d) =>
    d === src ? { ...d, items: d.items.map((i) => (i.id === it.id ? first : i)) }
    : d === dst ? { ...d, items: [rest, ...d.items] }
    : d,
  ) as D[];
}
