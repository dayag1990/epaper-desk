import { describe, expect, it } from "vitest";
import type { PageDoc } from "@epaper/core";
import { PageDocSchema } from "@epaper/core";
import { applyText, placeArticle, setBlockStyle, syncDocs, type Docs } from "../src/tools";
import { buildSeed } from "../mock/seed";

const seed = () => buildSeed("");
const mk = (): Docs => Object.fromEntries(seed().pages.map((p) => [p.id, p.doc]));

describe("block Style control (tools)", () => {
  it("switches a block between plain, boxed brief, pull quote and tinted panel, and the doc still validates", () => {
    const d = mk();
    const id = d.pg_two!.items[1]!.id;
    for (const block of ["brief", "quote", "panel", "plain"] as const) {
      const r = setBlockStyle(d, "pg_two", id, { block });
      const it = r.pg_two!.items[1]!;
      expect(it.block).toBe(block === "plain" ? undefined : block);
      PageDocSchema.parse(r.pg_two);
    }
  });
  it("a plain block and a switched-off drop cap leave no field behind (old pages stay byte-identical)", () => {
    const d = mk();
    const id = d.pg_two!.items[1]!.id;
    const on = setBlockStyle(setBlockStyle(d, "pg_two", id, { block: "brief" }), "pg_two", id, { dropcap: true });
    expect(on.pg_two!.items[1]).toMatchObject({ block: "brief", dropcap: true });
    const off = setBlockStyle(setBlockStyle(on, "pg_two", id, { block: "plain" }), "pg_two", id, { dropcap: false });
    expect(JSON.stringify(off.pg_two)).toBe(JSON.stringify(d.pg_two));
  });
  it("a pull quote is widened to at least 3 columns", () => {
    const d = mk();
    const id = d.pg_two!.items[0]!.id;
    const narrow = { ...d, pg_two: { ...d.pg_two!, items: d.pg_two!.items.map((i) => (i.id === id ? { ...i, span: 2, cols: 2 } : i)) } };
    expect(setBlockStyle(narrow, "pg_two", id, { block: "quote" }).pg_two!.items[0]!.span).toBe(3);
  });
  it("an advert has no style", () => {
    const d = mk();
    const ad = { ...d.pg_two!.items[0]!, kind: "ad" as const };
    const dd = { ...d, pg_two: { ...d.pg_two!, items: [ad, ...d.pg_two!.items.slice(1)] } };
    expect(setBlockStyle(dd, "pg_two", ad.id, { block: "panel" }).pg_two!.items[0]).toEqual(ad);
  });
});

describe("byline text and jump sync (tools)", () => {
  it("typing in a byline is copied into the doc", () => {
    const d = mk();
    const it = d.pg_two!.items[0]!;
    const next = applyText(d.pg_two!, { items: [{ id: it.id, byline: "By Ana Lee" }] });
    expect(next.items[0]!.text!.byline).toBe("By Ana Lee");
    expect(applyText(next, { items: [{ id: it.id, byline: "By Ana Lee" }] })).toBe(next); // no change, no new object
  });
  it("a story placed from the tray brings its byline and dateline", () => {
    const d = mk();
    const r = placeArticle(d, "pg_two", { id: "art_1", rev: 1, headline: "H", byline: "By A", dateline: "Riverton, 3 Nov", paras: ["x"] }, "it_new");
    expect(r.pg_two!.items.at(-1)!.text).toMatchObject({ byline: "By A", dateline: "Riverton, 3 Nov" });
  });
  it("jump numbers follow a story moved to another page", () => {
    const d = mk();
    const a = d.pg_front!.items[0]!, b = d.pg_two!.items[0]!;
    const docs: Docs = {
      ...d,
      pg_front: { ...d.pg_front!, items: [{ ...a, jump: { role: "to", pair: b.id, page: 2 } }, ...d.pg_front!.items.slice(1)] },
      pg_two: { ...d.pg_two!, items: [{ ...b, jump: { role: "from", pair: a.id, page: 1 } }, ...d.pg_two!.items.slice(1)] },
    };
    const order = ["pg_front", "pg_two", "pg_three"];
    expect(syncDocs(docs, order).changed).toEqual([]);
    // the second half moves from page 2 to page 3
    const moved: Docs = { ...docs, pg_two: { ...docs.pg_two!, items: docs.pg_two!.items.slice(1) }, pg_three: { ...docs.pg_three!, items: [docs.pg_two!.items[0]!, ...docs.pg_three!.items] } };
    const r = syncDocs(moved, order);
    expect(r.changed).toEqual(["pg_front"]);
    expect(r.docs.pg_front!.items[0]!.jump).toMatchObject({ role: "to", page: 3 });
    const _unused: PageDoc = r.docs.pg_front!; void _unused;
  });
});
