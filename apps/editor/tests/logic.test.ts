import { describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import type { PageDoc } from "@epaper/core";
import { Api } from "../src/api";
import { loadConfig } from "../src/config";
import { IdbDrafts, MemoryDrafts } from "../src/draft";
import { History } from "../src/history";
import { docSig, needsRefit } from "../src/refit";
import { EditorStore } from "../src/store";
import { applyText, applyTool, addStory, setFocal, setRatio, type Docs, type ToolCtx } from "../src/tools";
import { templateFor } from "../src/templates";
import { MockBackend, mockFetch } from "../mock/core";
import { buildSeed } from "../mock/seed";

const seed = () => buildSeed("");
const mk = (user = "ana") => {
  const b = new MockBackend(seed());
  const api = new Api({ base: "", fetch: mockFetch(b, user), mockUser: user });
  return { b, api };
};
const cfg = { ...loadConfig(), autosaveMs: 50, heartbeatMs: 1e9, lockPollMs: 1e9, retryMs: 50 };

function docs(): { docs: Docs; ctx: ToolCtx } {
  const s = seed();
  const d: Docs = Object.fromEntries(s.pages.map((p) => [p.id, p.doc]));
  return { docs: d, ctx: { order: s.pages.map((p) => p.id), templateOf: (id) => templateFor(d[id]!, s.templates), hasSrc: () => true } };
}

describe("tools (ported from the prototype #tool handler)", () => {
  it("width: clamps 1..8 and drags text columns along when they matched the width", () => {
    const { docs: d, ctx } = docs();
    const id = d.pg_two!.items[1]!.id; // span 3 cols 3
    const r = applyTool(d, "pg_two", id, "span+", ctx)!;
    const it = r.docs.pg_two!.items[1]!;
    expect([it.span, it.cols]).toEqual([4, 4]);
    const r2 = applyTool(r.docs, "pg_two", id, "span-", ctx)!;
    expect([r2.docs.pg_two!.items[1]!.span, r2.docs.pg_two!.items[1]!.cols]).toEqual([3, 3]);
  });
  it("text columns and headline size clamp", () => {
    const { docs: d, ctx } = docs();
    const id = d.pg_two!.items[0]!.id;
    let cur = d;
    for (let i = 0; i < 20; i++) cur = applyTool(cur, "pg_two", id, "hs+", ctx)!.docs;
    expect(cur.pg_two!.items[0]!.hs).toBe(2);
    for (let i = 0; i < 30; i++) cur = applyTool(cur, "pg_two", id, "hs-", ctx)!.docs;
    expect(cur.pg_two!.items[0]!.hs).toBe(0.5);
    cur = applyTool(d, "pg_two", id, "cols-", ctx)!.docs;
    expect(cur.pg_two!.items[0]!.cols).toBe(4);
  });
  it("move swaps inside a page, then crosses to the next page", () => {
    const { docs: d, ctx } = docs();
    const last = d.pg_two!.items.at(-1)!.id;
    const r = applyTool(d, "pg_two", last, "mv+", ctx)!;
    expect(r.pageId).toBe("pg_three");
    expect(r.docs.pg_three!.items[0]!.id).toBe(last);
    expect(r.docs.pg_two!.items.some((i) => i.id === last)).toBe(false);
    expect(r.touched).toEqual(["pg_two", "pg_three"]);
    const first = d.pg_two!.items[0]!.id;
    const s = applyTool(d, "pg_two", first, "mv+", ctx)!;
    expect(s.docs.pg_two!.items[1]!.id).toBe(first);
    expect(applyTool(d, "pg_front", d.pg_front!.items[0]!.id, "mv-", ctx)).toBeNull();
  });
  it("delete, photo shape, focal and crop", () => {
    const { docs: d, ctx } = docs();
    const withImg = d.pg_two!.items.find((i) => i.image)!;
    const r = applyTool(d, "pg_two", withImg.id, "ar+", ctx)!;
    expect(r.docs.pg_two!.items.find((i) => i.id === withImg.id)!.image!.ratio).toBeCloseTo(1.78 * 1.2, 1);
    expect(setFocal(d, "pg_two", withImg.id, 2, -1).pg_two!.items.find((i) => i.id === withImg.id)!.image!.focal).toEqual([1, 0]);
    expect(setRatio(d, "pg_two", withImg.id, 1).pg_two!.items.find((i) => i.id === withImg.id)!.image!.ratio).toBe(1);
    expect(applyTool(d, "pg_two", withImg.id, "del", ctx)!.docs.pg_two!.items.length).toBe(d.pg_two!.items.length - 1);
  });
  it("typing is copied into the doc, and add story", () => {
    const { docs: d } = docs();
    const doc = d.pg_two!;
    const out = applyText(doc, { items: [{ id: doc.items[0]!.id, head: "New head" }] });
    expect(out.items[0]!.text!.head).toBe("New head");
    expect(applyText(doc, { items: [{ id: doc.items[0]!.id, head: doc.items[0]!.text!.head }] })).toBe(doc);
    expect(addStory(d, "pg_two", doc.items[0]!.id, "it_new").pg_two!.items[1]!.id).toBe("it_new");
  });
});

describe("refit triggers", () => {
  const { docs: d } = docs();
  const doc = d.pg_two!;
  it("fires for anything on the page", () => {
    expect(needsRefit(undefined, doc)).toBe(true);
    expect(needsRefit(doc, applyText(doc, { items: [{ id: doc.items[0]!.id, head: "x" }] }))).toBe(true);
    expect(needsRefit(doc, { ...doc, items: [...doc.items].reverse() })).toBe(true);
  });
  it("does not fire for rev, status or the fitted size (its own output)", () => {
    expect(needsRefit(doc, { ...doc, rev: 9 })).toBe(false);
    expect(needsRefit(doc, { ...doc, status: "subbed" })).toBe(false);
    expect(needsRefit(doc, { ...doc, page: { ...doc.page, body_pt: 7 } })).toBe(false);
    expect(docSig(doc)).toBe(docSig({ ...doc }));
  });
});

describe("undo / redo", () => {
  it("steps back and forth, merges quick typing into one step", () => {
    const h = new History<number>(0);
    h.push(1, "t", 0); h.push(2, "t", 100); h.push(3, "t", 200);
    expect(h.undo()).toBe(0);
    expect(h.redo()).toBe(3);
    h.push(10, "other", 5000);
    expect(h.undo()).toBe(3);
    h.push(11);
    expect(h.canRedo).toBe(false);
  });
  it("store: undo restores the doc, replace (refit) is not a step", async () => {
    const { api } = mk();
    const st = new EditorStore(api, new MemoryDrafts(), cfg);
    await st.load("ed_demo");
    const before = st.state.docs;
    const pid = st.state.active!;
    const d = st.state.docs[pid]!;
    st.commit({ ...before, [pid]: { ...d, items: d.items.slice(1) } }, [pid]);
    expect(st.state.canUndo).toBe(true);
    st.undo();
    expect(st.state.docs[pid]!.items.length).toBe(d.items.length);
    st.redo();
    expect(st.state.docs[pid]!.items.length).toBe(d.items.length - 1);
    st.dispose();
  });
});

describe("store: save, lock, drafts", () => {
  it("autosaves with the rev, and the server keeps versions", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { api, b } = mk();
    const st = new EditorStore(api, new MemoryDrafts(), cfg);
    await st.load("ed_demo");
    vi.useRealTimers();
    const pid = st.state.active!;
    const d = st.state.docs[pid]!;
    st.commit({ ...st.state.docs, [pid]: applyText(d, { items: [{ id: d.items[0]!.id, head: "EDITED" }] }) }, [pid], "t");
    await st.saveNow();
    expect(b.pages.get(pid)!.doc.items[0]!.text!.head).toBe("EDITED");
    expect(b.pages.get(pid)!.rev).toBe(2);
    expect(st.state.save.state).toBe("saved");
    expect(b.pages.get(pid)!.versions.length).toBe(2);
    st.dispose();
  });
  it("a second user is read-only and told who holds the page; viewer cannot save", async () => {
    const { b } = mk();
    const a = new EditorStore(new Api({ base: "", fetch: mockFetch(b, "ana"), mockUser: "ana" }), new MemoryDrafts(), cfg);
    await a.load("ed_demo");
    const bea = new EditorStore(new Api({ base: "", fetch: mockFetch(b, "bea"), mockUser: "bea" }), new MemoryDrafts(), cfg);
    await bea.load("ed_demo");
    const pid = bea.state.active!;
    expect(bea.state.access[pid]).toMatchObject({ mode: "readonly", reason: "locked", holder: { name: "Ana Costa" } });
    const d = bea.state.docs[pid]!;
    expect(bea.commit({ ...bea.state.docs, [pid]: { ...d, items: [] } }, [pid])).toBe(false);
    const vic = new EditorStore(new Api({ base: "", fetch: mockFetch(b, "vic"), mockUser: "vic" }), new MemoryDrafts(), cfg);
    await vic.load("ed_demo");
    expect(vic.state.access[vic.state.active!]).toMatchObject({ mode: "readonly", reason: "viewer" });
    [a, bea, vic].forEach((s) => s.dispose());
  });
  it("stale rev shows both versions and never overwrites silently", async () => {
    const { b, api } = mk();
    const st = new EditorStore(api, new MemoryDrafts(), cfg);
    await st.load("ed_demo");
    const pid = st.state.active!;
    b.pages.get(pid)!.rev = 7; // someone else saved
    const d = st.state.docs[pid]!;
    st.commit({ ...st.state.docs, [pid]: applyText(d, { items: [{ id: d.items[0]!.id, head: "MINE" }] }) }, [pid]);
    await st.saveNow();
    expect(st.state.conflict?.pageId).toBe(pid);
    expect(b.pages.get(pid)!.doc.items[0]!.text!.head).not.toBe("MINE");
    await st.resolveConflict("mine");
    expect(b.pages.get(pid)!.doc.items[0]!.text!.head).toBe("MINE");
    st.dispose();
  });
  it("API down: keeps the words, saves when it returns, and a reload recovers from the draft", async () => {
    const { b } = mk();
    let down = true;
    const f = mockFetch(b);
    const flaky = async (u: string, i?: RequestInit) => { if (down && i?.method === "PUT") throw new Error("down"); return f(u, i); };
    const drafts = new IdbDrafts();
    const st = new EditorStore(new Api({ base: "", fetch: flaky }), drafts, cfg);
    await st.load("ed_demo");
    const pid = st.state.active!;
    const d = st.state.docs[pid]!;
    st.commit({ ...st.state.docs, [pid]: applyText(d, { items: [{ id: d.items[0]!.id, head: "KEPT WORDS" }] }) }, [pid]);
    await st.saveNow();
    expect(st.state.save.state).toBe("offline");
    st.dispose();
    // reload while still offline: the browser copy comes back
    const st2 = new EditorStore(new Api({ base: "", fetch: flaky }), drafts, cfg);
    await st2.load("ed_demo");
    expect(st2.state.docs[pid]!.items[0]!.text!.head).toBe("KEPT WORDS");
    down = false;
    st2.online();
    await vi.waitFor(() => expect(b.pages.get(pid)!.doc.items[0]!.text!.head).toBe("KEPT WORDS"));
    st2.dispose();
  });
  it("restore brings back text, photos and layout of an earlier version", async () => {
    const { b, api } = mk();
    const st = new EditorStore(api, new MemoryDrafts(), cfg);
    await st.load("ed_demo");
    const pid = st.state.active!;
    const orig = structuredClone(st.state.docs[pid]!);
    st.commit({ ...st.state.docs, [pid]: { ...orig, items: orig.items.slice(2).map((i) => ({ ...i, span: 1, image: undefined })) } }, [pid]);
    await st.saveNow();
    await st.restore(pid, 1);
    const back = st.state.docs[pid]!;
    expect(back.items).toEqual(orig.items);
    expect(b.pages.get(pid)!.doc.items).toEqual(orig.items);
    st.dispose();
  });
});

describe("api client", () => {
  it("turns failures into plain words", async () => {
    const { b } = mk("vic");
    const api = new Api({ base: "", fetch: mockFetch(b, "vic"), mockUser: "vic" });
    const p = [...b.pages.values()][0]!;
    const { plainError } = await import("../src/errors");
    const e = await api.savePage(p.id, p.doc, p.rev).catch((x) => x);
    expect(plainError(e)).toMatch(/can look but not change/);
    const net = await new Api({ base: "", fetch: async () => { throw new Error("x"); } }).me().catch((x) => x);
    expect(plainError(net)).toMatch(/safe on this device/);
  });
});
