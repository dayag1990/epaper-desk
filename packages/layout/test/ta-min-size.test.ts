import { describe, expect, it } from "vitest";
import { pxToPt } from "../src/index.js";
import { tplSet } from "./helpers.js";

describe("Tamil template: the body text is never fitted below 8.5 pt", () => {
  it("every broadsheet-ta template has a minimum body size of at least 8.5 pt, and start/max stay above it", () => {
    const set = tplSet("broadsheet-ta");
    expect(set.length).toBeGreaterThanOrEqual(3);
    for (const t of set) {
      expect(pxToPt(t.body.min_px, t), `${t.id} min`).toBeGreaterThanOrEqual(8.5);
      expect(t.body.start_px, `${t.id} start`).toBeGreaterThanOrEqual(t.body.min_px);
      expect(t.body.max_px, `${t.id} max`).toBeGreaterThanOrEqual(t.body.start_px);
    }
  });
});
