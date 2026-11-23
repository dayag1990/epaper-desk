import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ArticleSchema } from "@epaper/core";
import { cxmlConnector, parseCXML, toCXML, summariseCxml, syncSource, MemoryArticleStore } from "../src/index.js";
import { CTX } from "./helpers.js";

const FILE = fileURLToPath(new URL("../../../fixtures/blinkcms-poc.cxml", import.meta.url));
const cfg = { path: FILE };

describe("cxml connector", () => {
  it("counts 2 pages, 9 stories, 1 advert and 7 image refs", () => {
    const s = summariseCxml(parseCXML(readFileSync(FILE, "utf8")));
    expect(s).toEqual({ pages: 2, stories: 9, adverts: 1, imageRefs: 7 });
  });

  it("turns the BlinkCMS sample into 9 valid D1 articles and skips the advert", async () => {
    const store = new MemoryArticleStore();
    const rep = await syncSource(cxmlConnector, cfg, undefined, CTX, store);
    expect(rep.rejected).toEqual([]);
    expect(rep.created).toBe(9);
    expect(rep.skipped).toBe(1);
    for (const a of store.all()) expect(ArticleSchema.safeParse(a).success).toBe(true);
    const first = store.all()[0];
    expect(first.lang).toBe("pa");
    expect(first.script).toBe("Guru");
    expect(first.images[0].src).toContain("100.jpg");
    expect(first.layout_hint).toMatchObject({ page: "Main", slot: "story_col_span-3-1", span: 3, order: 1 });
    // the quote context became the kicker of the editorial
    expect(store.all().find((a) => a.kicker === "ਚਿੰਤਾ")).toBeTruthy();
  });

  it("keeps Punjabi text in Unicode NFC", async () => {
    const store = new MemoryArticleStore();
    await syncSource(cxmlConnector, cfg, undefined, CTX, store);
    for (const a of store.all()) {
      const all = [a.headline, a.subhead ?? "", ...a.body.map((b) => b.text)].join("");
      expect(all.normalize("NFC")).toBe(all);
      expect(all).toMatch(/[਀-੿]/);
    }
  });

  it("re-parses its own ContentXML export to the same model", () => {
    const doc = parseCXML(readFileSync(FILE, "utf8"));
    const out = toCXML(doc);
    expect(parseCXML(out)).toEqual(doc);
    expect(toCXML(parseCXML(out))).toBe(out);
  });

  it("rejects things that are not ContentXML in plain words", () => {
    expect(() => parseCXML("<a><b></a>")).toThrow(/not well-formed/);
    expect(() => parseCXML("<root/>")).toThrow(/Not a ContentXML/);
  });
});
