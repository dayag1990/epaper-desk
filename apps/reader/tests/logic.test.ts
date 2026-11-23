import { describe, expect, it } from "vitest";
import { searchEdition } from "../src/lib/search";
import type { TextPage, Zone } from "../src/lib/types";
import { hitTest, levelForZoom, zoneText } from "../src/lib/zones";

const zone = (id: string, rects: [number, number, number, number][], extra: Partial<Zone> = {}): Zone =>
  ({ id, article_id: "art_" + id, title: id, url: `https://x/${id}`, rects, confidence: 1, source: "auto", ...extra }) as Zone;

describe("hitTest (0-1 fractions)", () => {
  const a = zone("a", [[0.1, 0.1, 0.4, 0.4]]);
  const b = zone("b", [[0.6, 0.1, 0.3, 0.3], [0.6, 0.5, 0.3, 0.3]]);
  const inner = zone("inner", [[0.2, 0.2, 0.1, 0.1]]);
  it("finds the zone containing the point", () => {
    expect(hitTest([a, b], 0.3, 0.3)?.id).toBe("a");
    expect(hitTest([a, b], 0.7, 0.6)?.id).toBe("b");
  });
  it("returns null on empty paper and outside the page", () => {
    expect(hitTest([a, b], 0.55, 0.9)).toBeNull();
    expect(hitTest([a, b], 1.2, 0.3)).toBeNull();
  });
  it("includes edges and prefers the smaller of overlapping zones", () => {
    expect(hitTest([a], 0.5, 0.5)?.id).toBe("a");
    expect(hitTest([a, inner], 0.25, 0.25)?.id).toBe("inner");
    expect(hitTest([inner, a], 0.25, 0.25)?.id).toBe("inner");
  });
});

describe("levelForZoom", () => {
  const L = [400, 1600, 3200];
  it("grows with zoom", () => {
    expect(levelForZoom(1, 400, 1, L)).toBe(400);
    expect(levelForZoom(2, 400, 1, L)).toBe(1600);
    expect(levelForZoom(5, 400, 1, L)).toBe(3200);
  });
  it("accounts for device pixel ratio and caps at the largest level", () => {
    expect(levelForZoom(1, 400, 3, L)).toBe(1600);
    expect(levelForZoom(6, 1440, 2, L)).toBe(3200);
  });
  it("handles unsorted levels", () => { expect(levelForZoom(2, 400, 1, [3200, 400, 1600])).toBe(1600); });
});

const text: TextPage = { page: 1, w: 100, h: 200, lines: [
  { x0: 10, y0: 10, x1: 50, y1: 20, text: "Council votes to repair" },
  { x0: 10, y0: 22, x1: 50, y1: 32, text: "Old Mill Bridge" },
  { x0: 60, y0: 10, x1: 90, y1: 20, text: "ਪੰਜਾਬੀ ਖ਼ਬਰ" },
  { x0: 60, y0: 120, x1: 90, y1: 130, text: "తెలుగు వార్త" },
] };

describe("zoneText", () => {
  it("collects lines inside the zone in reading order", () => {
    expect(zoneText(text, zone("a", [[0, 0, 0.55, 0.2]]))).toEqual(["Council votes to repair", "Old Mill Bridge"]);
  });
});

describe("searchEdition", () => {
  const pages = [{ page: 1, text, zones: [] }, { page: 3, text: null, zones: [zone("z1", [[0.1, 0.2, 0.3, 0.2]], { title: "Flood barrier passes test" })] }];
  it("finds a phrase across a line break with one rect per line", () => {
    const h = searchEdition(pages, "repair old mill");
    expect(h).toHaveLength(1);
    expect(h[0].page).toBe(1);
    expect(h[0].rects).toHaveLength(2);
    expect(h[0].rects[0][0]).toBeCloseTo(0.1);
  });
  it("matches story titles case-insensitively and reports their page", () => {
    const h = searchEdition(pages, "FLOOD BARRIER");
    expect(h[0]).toMatchObject({ page: 3, kind: "story", zoneId: "z1" });
  });
  it("is safe for Gurmukhi and Telugu", () => {
    expect(searchEdition(pages, "ਖ਼ਬਰ")[0]?.page).toBe(1);
    expect(searchEdition(pages, "వార్త")[0]?.page).toBe(1);
  });
  it("ignores too-short queries and misses", () => {
    expect(searchEdition(pages, "a")).toEqual([]);
    expect(searchEdition(pages, "zzzz")).toEqual([]);
  });
});
