import { describe, expect, it } from "vitest";
import type { LayoutSnapshot } from "@epaper/core";
import { zoneFromSnapshot } from "../src/index.js";

const fr = (id: string, item: string, role: string, x: number, y: number, w: number, h: number) => ({ id, item, role, x, y, w, h }) as LayoutSnapshot["pages"][number]["frames"][number];

describe("e-paper zones with the newspaper finish", () => {
  it("a story's tap zone covers its byline and jump line, and rules, boxes and the header band are not stories", () => {
    const page: LayoutSnapshot["pages"][number] = {
      no: 1, w: 100, h: 200, fill_pct: 90,
      frames: [
        fr("it_a.head", "it_a", "head", 10, 10, 50, 10), fr("it_a.byline", "it_a", "byline", 10, 22, 50, 5), fr("it_a.body", "it_a", "body", 10, 30, 50, 40),
        fr("it_a.jump_to", "it_a", "jump", 10, 72, 50, 5),
        fr("it_a.rule", "it_a", "rule", 10, 9, 50, 0), fr("it_furniture.rule_top", "it_furniture", "rule", 0, 0, 100, 0), fr("it_a.box", "it_a", "box", 8, 8, 54, 72),
      ],
    };
    const zones = zoneFromSnapshot(page, [], {});
    expect(zones.length).toBe(1);
    const [x, y, w, h] = zones[0]!.rects[0]!;
    expect(y + h).toBeCloseTo(77 / 200, 3); // reaches the bottom of the jump line
    expect(x).toBeCloseTo(0.1, 3);
    expect(w).toBeCloseTo(0.5, 3);
  });
});
