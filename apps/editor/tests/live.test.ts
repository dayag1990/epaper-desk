import { describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { Api } from "../src/api";
import { loadConfig } from "../src/config";
import { MemoryDrafts } from "../src/draft";
import { movedBlocks } from "../src/motion";
import { EditorStore } from "../src/store";
import { MockBackend, mockFetch } from "../mock/core";
import { buildSeed } from "../mock/seed";

const cfg = { ...loadConfig(), autosaveMs: 1e9, heartbeatMs: 1e9, lockPollMs: 1e9, retryMs: 50 };
async function open() {
  const b = new MockBackend(buildSeed(""));
  const api = new Api({ base: "", fetch: mockFetch(b, "ana"), mockUser: "ana" });
  const store = new EditorStore(api, new MemoryDrafts(), cfg);
  await store.load("ed_demo", "1");
  return { b, store };
}
const head = (s: EditorStore, pid: string) => s.state.docs[pid]!.items.find((i) => i.text)!.text!.head;

describe("live updates in the store", () => {
  it("a page nobody here touched is replaced quietly, with the server's fill %", async () => {
    const { b, store } = await open();
    const ev = b.externalSave("pg_two", "Changed by Bea", 96);
    await store.onLive(ev as never);
    expect(head(store, "pg_two")).toBe("Changed by Bea");
    expect(store.state.revs.pg_two).toBe(ev.rev);
    expect(store.state.serverFit.pg_two).toBe(96);
    expect(store.state.remote).toEqual({});
    expect(store.state.dirty).toEqual([]);
  });
  it("a page with unsaved changes is never overwritten: it is only marked, and Reload shows both versions", async () => {
    const { b, store } = await open();
    const d = store.state.docs.pg_front!;
    const mine = { ...d, items: d.items.map((i, k) => (k === 0 && i.text ? { ...i, text: { ...i.text, head: "MY HEADLINE" } } : i)) };
    store.commit({ ...store.state.docs, pg_front: mine }, ["pg_front"]);
    expect(store.state.dirty).toContain("pg_front");
    const ev = b.externalSave("pg_front", "THEIR HEADLINE", 90);
    await store.onLive(ev as never);
    expect(store.state.docs.pg_front!.items[0]!.text!.head).toBe("MY HEADLINE");
    expect(store.state.remote.pg_front).toBe(ev.rev);
    await store.reviewRemote("pg_front");
    expect(store.state.conflict?.mine.items[0]!.text!.head).toBe("MY HEADLINE");
    expect(store.state.conflict?.theirs.items.find((i) => i.text)!.text!.head).toBe("THEIR HEADLINE");
    expect(store.state.remote).toEqual({});
    store.dispose();
  });
  it("our own save announced back to us changes nothing; old news is ignored", async () => {
    const { store } = await open();
    const rev = store.state.revs.pg_two!;
    await store.onLive({ type: "page.updated", page_id: "pg_two", edition_id: "ed_demo", rev, fill: 88, status: "draft" });
    expect(store.state.revs.pg_two).toBe(rev);
    expect(store.state.serverFit.pg_two).toBe(88);
    await store.onLive({ type: "page.updated", page_id: "pg_nope", edition_id: "ed_demo", rev: 9, fill: 1, status: "draft" }); // a page of another edition
    expect(store.state.serverFit.pg_nope).toBeUndefined();
  });
  it("page.fit sets the server's colour state; edition.changed and a changed page list ask for a reload", async () => {
    const { b, store } = await open();
    await store.onLive({ type: "page.fit", page_id: "pg_three", edition_id: "ed_demo", rev: 2, fill: 107, state: "over", overflow: true });
    expect(store.state.fitState.pg_three).toBe("over");
    expect(store.state.serverFit.pg_three).toBe(107);
    expect(store.state.listChanged).toBe(false);
    b.pages.get("pg_three")!.deleted = true;
    await store.refreshFromServer(); // the 15 s check
    expect(store.state.listChanged).toBe(true);
  });
  it("the 15 s check finds a change the stream missed", async () => {
    const { b, store } = await open();
    b.externalSave("pg_two", "Missed by the stream", 93);
    await store.refreshFromServer();
    expect(head(store, "pg_two")).toBe("Missed by the stream");
    expect(store.state.serverFit.pg_two).toBe(93);
  });
});

describe("block motion (which blocks glide)", () => {
  const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
  it("lists only blocks that moved or changed size, with the old place relative to the new one", () => {
    const prev = new Map([["a", box(0, 0, 100, 50)], ["b", box(100, 0, 100, 50)], ["c", box(0, 50, 200, 80)]]);
    const next = new Map([["a", box(0, 0, 100, 50)], ["b", box(100, 60, 100, 50)], ["c", box(0, 50, 100, 80)]]);
    const m = movedBlocks(prev, next);
    expect(m.map((x) => x.id)).toEqual(["b", "c"]);
    expect(m[0]).toMatchObject({ dx: 0, dy: -60 });
    expect(m[1]).toMatchObject({ sx: 2, sy: 1 });
  });
  it("does nothing when the set of blocks differs (another page, a story added) or there was no earlier layout", () => {
    expect(movedBlocks(new Map(), new Map([["a", box(0, 0, 1, 1)]]))).toEqual([]);
    expect(movedBlocks(new Map([["a", box(0, 0, 9, 9)]]), new Map([["b", box(5, 5, 9, 9)]]))).toEqual([]);
    expect(movedBlocks(new Map([["a", box(0, 0, 9, 9)]]), new Map([["a", box(0, 0, 9, 9)], ["b", box(5, 5, 9, 9)]]))).toEqual([]);
  });
});
