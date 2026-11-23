import { describe, expect, it } from "vitest";
import { handlers, queueEnabled } from "../src/main.js";
import { TYPE_QUEUE } from "../src/ctx.js";
import { loadArticles } from "../src/ctx.js";
import { adapterFor } from "../src/jobs/ingest.js";
import { templateSet } from "../src/templates.js";
import path from "node:path";

describe("worker wiring", () => {
  it("has a handler for every job type the API can send", () => {
    for (const t of Object.keys(TYPE_QUEUE)) expect(typeof handlers[t], t).toBe("function");
  });
  it("the ai queue is silent unless AI_ENABLED=true", () => {
    expect(queueEnabled("ai", {} as any)).toBe(false);
    expect(queueEnabled("ai", { AI_ENABLED: "false" } as any)).toBe(false);
    expect(queueEnabled("ai", { AI_ENABLED: "true" } as any)).toBe(true);
    for (const q of ["ingest", "assets", "layout", "export", "epaper"]) expect(queueEnabled(q, {} as any)).toBe(true);
  });
  it("knows the source kinds", () => {
    for (const k of ["rss", "wordpress", "scrape", "cxml", "push"]) expect(adapterFor(k)?.kind, k).toBeTruthy();
    expect(adapterFor("fax")).toBeNull();
  });
  it("loads templates and says so plainly when a set is missing", () => {
    process.env.TEMPLATES_DIR = path.resolve(__dirname, "../../../templates");
    expect(templateSet("broadsheet-en").length).toBeGreaterThan(1);
    expect(() => templateSet("nope")).toThrow(/no template set/);
    void loadArticles;
  });
});
