import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cxmlConnector, syncSource, MemoryArticleStore, testSource } from "../src/index.js";
import { CTX } from "./helpers.js";

const FILE = fileURLToPath(new URL("../../../fixtures/blinkcms-poc.cxml", import.meta.url));
const xmlOriginal = readFileSync(FILE, "utf8");

describe("dedupe, hash and rev", () => {
  it("re-ingest of the same file writes nothing and makes no duplicates", async () => {
    const store = new MemoryArticleStore();
    await syncSource(cxmlConnector, { path: FILE }, undefined, CTX, store);
    const before = JSON.stringify(store.all());
    const rep = await syncSource(cxmlConnector, { path: FILE }, undefined, CTX, store);
    expect(rep).toMatchObject({ created: 0, updated: 0, unchanged: 9, events: [] });
    expect(store.all()).toHaveLength(9);
    expect(JSON.stringify(store.all())).toBe(before);
  });

  it("a changed story bumps rev, keeps its id and emits article.updated", async () => {
    const store = new MemoryArticleStore();
    await syncSource(cxmlConnector, { xml: xmlOriginal }, undefined, CTX, store);
    const target = store.all().find((a) => a.external_id.endsWith(":2"))!;
    const changed = xmlOriginal.replace(target.body[0].text.slice(0, 12), "ਸੋਧਿਆ ਹੋਇਆ " + target.body[0].text.slice(0, 12));
    expect(changed).not.toBe(xmlOriginal);
    const rep = await syncSource(cxmlConnector, { xml: changed }, undefined, CTX, store);
    expect(rep.updated).toBe(1);
    expect(rep.unchanged).toBe(8);
    expect(rep.events).toHaveLength(1);
    expect(rep.events[0]).toMatchObject({ type: "article.updated", previousRev: 1 });
    const after = store.all().find((a) => a.external_id === target.external_id)!;
    expect(after.rev).toBe(2);
    expect(after.id).toBe(target.id);
    expect(after.content_hash).not.toBe(target.content_hash);
    expect(store.all()).toHaveLength(9);
  });

  it("rejects a bad item with reasons and keeps going", async () => {
    const bad = xmlOriginal.replace(/<tps:p type="Story-head">[^<]*<\/tps:p>/, "");
    const store = new MemoryArticleStore();
    const rep = await syncSource(cxmlConnector, { xml: bad }, undefined, CTX, store);
    expect(rep.rejected.length).toBeGreaterThanOrEqual(1);
    expect(rep.rejected[0].reasons[0]).toMatch(/headline/i);
    expect(rep.created).toBeGreaterThanOrEqual(7);
  });

  it("test endpoint returns 5 parsed articles and writes nothing", async () => {
    const r = await testSource(cxmlConnector, { path: FILE }, undefined, CTX, 5);
    expect(r.articles).toHaveLength(5);
  });
});
