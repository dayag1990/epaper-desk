import type { Article, PageDoc } from "@epaper/core";
import type { Api } from "./api";
import type { EditorConfig } from "./config";
import type { Draft, DraftStore } from "./draft";
import { ApiError, plainError } from "./errors";
import { History } from "./history";
import type { FitState } from "./layout";
import type { Meter } from "./refit";
import { saveSig } from "./refit";
import { templateFor } from "./templates";
import type { Docs } from "./tools";
import type { AssetRecord, Me, Person, Template, VersionRecord } from "./types";

export type SaveState = "saved" | "saving" | "unsaved" | "offline" | "error";
export interface Access {
  mode: "edit" | "readonly";
  reason?: "viewer" | "locked" | "approved";
  holder?: Person;
}
export interface Conflict {
  pageId: string;
  mine: PageDoc;
  theirs: PageDoc;
  theirsRev: number;
}
export interface EditorState {
  phase: "loading" | "ready" | "failed";
  error: string | null;
  notice: string | null;
  edition: { id: string; name: string; date: string } | null;
  me: Me | null;
  order: string[];
  nos: Record<string, number>;
  docs: Docs;
  revs: Record<string, number>;
  serverFit: Record<string, number | null>;
  templates: Template[];
  articles: Article[];
  assets: Record<string, AssetRecord>;
  active: string | null;
  selected: string | null;
  access: Record<string, Access>;
  meters: Record<string, Meter>;
  save: { state: SaveState; message?: string; at?: number };
  conflict: Conflict | null;
  canUndo: boolean;
  canRedo: boolean;
  dirty: string[];
  /** How many times the page was measured and refitted (the fill meter exposes it so tests can see the refit run). */
  refits: number;
  /** The server's last measure of each page (from the worker): the tab colour for pages that are not open. */
  fitState: Record<string, FitState | null>;
  /** Pages someone else saved while this person has unsaved changes on them: page -> their version. Nothing is overwritten. */
  remote: Record<string, number>;
  /** The set of pages changed (planned again, a page deleted): the list on screen is out of date. */
  listChanged: boolean;
  /** The live-updates stream: connecting, live, or down (then the page checks every 15 s instead). */
  live: "connecting" | "live" | "down";
}

/** What the server tells every open editor (Server-Sent Events, see apps/api/src/events.ts). */
export type LiveEvent =
  | { type: "page.updated"; page_id: string; edition_id: string; rev: number; fill: number | null; status: string; by?: string | null }
  | { type: "page.fit"; page_id: string; edition_id: string; rev: number; fill: number | null; state: FitState | null; overflow: boolean }
  | { type: "edition.changed"; edition_id: string }
  | { type: "resync" };

type Timer = ReturnType<typeof setTimeout>;

export class EditorStore {
  state: EditorState = {
    phase: "loading", error: null, notice: null, edition: null, me: null, order: [], nos: {}, docs: {}, revs: {}, serverFit: {},
    templates: [], articles: [], assets: {}, active: null, selected: null, access: {}, meters: {},
    save: { state: "saved" }, conflict: null, canUndo: false, canRedo: false, dirty: [], refits: 0,
    fitState: {}, remote: {}, listChanged: false, live: "connecting",
  };
  private hist = new History<Docs>({});
  private saved: Record<string, string> = {};
  private inflight = new Set<string>();
  /** events about a page that arrived while this device was saving it: looked at when the save is done */
  private later = new Map<string, LiveEvent>();
  private listeners = new Set<() => void>();
  private saveTimer?: Timer;
  private retryTimer?: Timer;
  private beat?: ReturnType<typeof setInterval>;
  private poll?: ReturnType<typeof setInterval>;
  private lockedPage: string | null = null;
  private disposed = false;

  constructor(private api: Api, private drafts: DraftStore, private cfg: EditorConfig) {}

  /* ---------- plumbing ---------- */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getSnapshot = () => this.state;
  private set(patch: Partial<EditorState>) {
    this.state = { ...this.state, ...patch };
    this.state.canUndo = this.hist.canUndo;
    this.state.canRedo = this.hist.canRedo;
    this.state.dirty = this.dirtyPages();
    this.listeners.forEach((l) => l());
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.saveTimer);
    clearTimeout(this.retryTimer);
    clearInterval(this.beat);
    clearInterval(this.poll);
  }
  /** Let go of the page lock and stop the heartbeat (before leaving for another paper). Resume with setActive(). */
  async releaseLock(): Promise<void> {
    clearInterval(this.beat);
    clearInterval(this.poll);
    const old = this.lockedPage;
    this.lockedPage = null;
    if (old) await this.api.unlock(old).catch(() => undefined);
  }
  templateOf = (pid: string): Template => templateFor(this.state.docs[pid]!, this.state.templates);
  private isEditable(pid: string) {
    return this.state.access[pid]?.mode === "edit";
  }
  private dirtyPages(): string[] {
    return this.state.order.filter((p) => this.state.docs[p] && saveSig(this.state.docs[p]!) !== this.saved[p]);
  }

  /* ---------- load ---------- */
  async load(editionId: string, pageParam?: string | null) {
    this.set({ phase: "loading", error: null });
    try {
      const [me, ed] = await Promise.all([this.api.me(), this.api.edition(editionId)]);
      const pages = [...ed.pages].sort((a, b) => a.no - b.no);
      const docs: Docs = {}, revs: Record<string, number> = {}, nos: Record<string, number> = {}, fit: Record<string, number | null> = {};
      pages.forEach((p) => { docs[p.id] = p.doc; revs[p.id] = p.rev; nos[p.id] = p.no; fit[p.id] = p.fit_pct; this.saved[p.id] = saveSig(p.doc); });
      this.hist = new History<Docs>(docs);
      this.set({ phase: "ready", me, edition: { id: ed.id, name: ed.name, date: ed.date }, order: pages.map((p) => p.id), nos, docs, revs, serverFit: fit, templates: ed.templates ?? [], articles: ed.articles ?? [] });
      // Unsaved typing from an earlier visit (reload, crash, API down) comes back first.
      if (me.role !== "viewer") await this.recoverDrafts(pages.map((p) => p.id));
      const first = pages.find((p) => p.id === pageParam || String(p.no) === pageParam)?.id ?? pages[0]?.id ?? null;
      if (first) await this.setActive(first);
      this.scheduleSave();
    } catch (e) {
      // an edition id from another paper (or a removed one) is a plain "not found", never data
      this.set({ phase: "failed", error: e instanceof ApiError && e.status === 404 ? "That edition was not found. It may belong to another paper, or it may have been removed." : plainError(e, "open this edition") });
    }
  }

  private async recoverDrafts(ids: string[]) {
    for (const id of ids) {
      const d = await this.drafts.get(id);
      if (!d) continue;
      const server = this.state.docs[id]!;
      if (saveSig(d.doc) === saveSig(server)) { await this.drafts.del(id); continue; }
      if (d.baseRev === this.state.revs[id]) {
        this.hist.replace({ ...this.hist.present, [id]: { ...d.doc, rev: server.rev } });
        this.set({ docs: this.hist.present, notice: "Your unsaved changes from last time were put back." });
      } else {
        this.set({ conflict: { pageId: id, mine: d.doc, theirs: server, theirsRev: this.state.revs[id]! } });
      }
    }
  }

  /* ---------- locks ---------- */
  private baseAccess(pid: string): Access {
    const me = this.state.me;
    if (!me || me.role === "viewer") return { mode: "readonly", reason: "viewer" };
    if (this.state.docs[pid]?.status === "approved") return { mode: "readonly", reason: "approved" };
    return { mode: "edit" };
  }
  private setAccess(pid: string, a: Access) {
    this.set({ access: { ...this.state.access, [pid]: a } });
  }
  async setActive(pid: string) {
    if (this.lockedPage && this.lockedPage !== pid) {
      const old = this.lockedPage;
      this.lockedPage = null;
      this.api.unlock(old).catch(() => undefined);
    }
    this.set({ active: pid, selected: null });
    const base = this.baseAccess(pid);
    this.setAccess(pid, base);
    clearInterval(this.beat);
    clearInterval(this.poll);
    if (base.mode === "readonly") return;
    await this.tryLock(pid);
    this.beat = setInterval(() => void this.heartbeat(), this.cfg.heartbeatMs);
    this.poll = setInterval(() => { if (this.state.access[pid]?.reason === "locked") void this.tryLock(pid); }, this.cfg.lockPollMs);
  }
  private async tryLock(pid: string) {
    if (this.disposed) return;
    try {
      await this.api.lock(pid);
      this.lockedPage = pid;
      if (this.state.access[pid]?.reason === "locked") this.set({ notice: "You can edit this page now." });
      this.setAccess(pid, this.baseAccess(pid));
      if (this.dirtyPages().includes(pid)) this.scheduleSave(0);
    } catch (e) {
      if (e instanceof ApiError && e.status === 423) {
        const holder = (e.details as { locked_by?: Person } | undefined)?.locked_by;
        this.setAccess(pid, { mode: "readonly", reason: "locked", holder });
      } else if (e instanceof ApiError && e.status === 403) {
        this.setAccess(pid, { mode: "readonly", reason: "viewer" });
      }
      // network down: keep editing; the heartbeat tries again
    }
  }
  private async heartbeat() {
    const pid = this.state.active;
    if (pid && this.isEditable(pid)) await this.tryLock(pid);
  }

  /* ---------- editing ---------- */
  select(itemId: string | null) {
    if (this.state.selected !== itemId) this.set({ selected: itemId });
  }
  notify(msg: string | null) {
    this.set({ notice: msg });
  }
  /** Apply an edit. `touched` pages must be editable; read-only pages never change. */
  commit(next: Docs, touched: string[], key?: string, windowMs?: number): boolean {
    if (touched.some((p) => !this.isEditable(p))) {
      this.set({ notice: "This page is read-only right now, so that change was not made." });
      return false;
    }
    if (next === this.hist.present) return false;
    this.hist.push(next, key, Date.now(), windowMs);
    this.set({ docs: next });
    this.afterChange(touched);
    return true;
  }
  private afterChange(pages: string[]) {
    for (const p of pages) {
      const d = this.state.docs[p];
      if (d) void this.drafts.put(p, { doc: d, baseRev: this.state.revs[p] ?? 0, at: Date.now() } as Draft).catch(() => undefined);
    }
    this.set({ save: { state: this.state.save.state === "offline" ? "offline" : "unsaved" } });
    this.scheduleSave();
  }
  undo() { this.step(this.hist.undo()); }
  redo() { this.step(this.hist.redo()); }
  private step(d: Docs | null) {
    if (!d) return;
    const changed = this.state.order.filter((p) => d[p] !== this.state.docs[p]);
    // Never undo into a page someone else now holds.
    if (changed.some((p) => !this.isEditable(p))) { this.hist.replace(this.state.docs); return; }
    this.set({ docs: d });
    this.afterChange(changed);
  }
  /** Refit output: updates the fitted text size and the meter without an undo step. Clean pages stay clean. */
  refitted(pid: string, meter: Meter) {
    const d = this.state.docs[pid];
    if (!d) return;
    this.state = { ...this.state, refits: this.state.refits + 1 };
    const wasClean = saveSig(d) === this.saved[pid];
    let docs = this.state.docs;
    if (this.isEditable(pid) && Math.abs(d.page.body_pt - meter.pt) > 0.0005) {
      const nd = { ...d, page: { ...d.page, body_pt: meter.pt } };
      docs = { ...docs, [pid]: nd };
      this.hist.replace(docs);
      if (wasClean) this.saved[pid] = saveSig(nd);
      else this.afterChange([pid]);
    }
    const prev = this.state.meters[pid];
    if (docs === this.state.docs && prev && prev.pct === meter.pct && prev.pt === meter.pt && prev.lowRes.join() === meter.lowRes.join()) { this.set({}); return; }
    this.set({ docs, meters: { ...this.state.meters, [pid]: meter } });
  }
  addAsset(a: AssetRecord) {
    this.set({ assets: { ...this.state.assets, [a.id]: a } });
  }

  /* ---------- saving ---------- */
  scheduleSave(ms = this.cfg.autosaveMs) {
    clearTimeout(this.saveTimer);
    if (this.disposed) return;
    this.saveTimer = setTimeout(() => void this.saveNow(), ms);
  }
  async saveNow(): Promise<void> {
    if (this.disposed || this.state.conflict) return;
    const todo = this.dirtyPages().filter((p) => this.isEditable(p) && !this.inflight.has(p));
    if (!todo.length) {
      if (!this.inflight.size && this.state.save.state !== "offline" && this.state.save.state !== "error") this.set({ save: { state: "saved", at: this.state.save.at } });
      return;
    }
    this.set({ save: { state: "saving" } });
    let offline = false;
    for (const pid of todo) {
      this.inflight.add(pid);
      const sent = this.state.docs[pid]!;
      try {
        const res = await this.api.savePage(pid, sent, this.state.revs[pid]!);
        this.saved[pid] = saveSig(sent);
        const cur = this.state.docs[pid]!;
        const withRev = { ...cur, rev: res.rev };
        const docs = { ...this.state.docs, [pid]: withRev };
        this.hist.replace(docs);
        this.set({ docs, revs: { ...this.state.revs, [pid]: res.rev } });
        if (saveSig(cur) === this.saved[pid]) await this.drafts.del(pid);
        else void this.drafts.put(pid, { doc: cur, baseRev: res.rev, at: Date.now() });
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          await this.onConflict(pid, e);
        } else if (e instanceof ApiError && e.status === 423) {
          this.setAccess(pid, { mode: "readonly", reason: "locked", holder: (e.details as { locked_by?: Person })?.locked_by });
        } else if (e instanceof ApiError && e.status === 403) {
          this.setAccess(pid, { mode: "readonly", reason: "viewer" });
          this.set({ save: { state: "error", message: plainError(e) } });
        } else if (e instanceof ApiError && e.status === 0) {
          offline = true;
        } else {
          this.set({ save: { state: "error", message: plainError(e, "save this page") } });
        }
      } finally {
        this.inflight.delete(pid);
        const ev = this.later.get(pid);
        if (ev) { this.later.delete(pid); void this.onLive(ev); }
      }
    }
    if (offline) {
      this.set({ save: { state: "offline", message: plainError(new ApiError(0, "network", "")) } });
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => void this.saveNow(), this.cfg.retryMs);
    } else if (this.state.save.state === "saving") {
      if (this.dirtyPages().some((p) => this.isEditable(p))) this.scheduleSave(); // typed while saving
      else this.set({ save: { state: "saved", at: Date.now() } });
    }
  }
  /** Browser says the network is back. */
  online() {
    if (this.state.save.state === "offline") void this.saveNow();
    void this.heartbeat();
  }

  private async onConflict(pid: string, e: ApiError) {
    let d = e.details as { rev?: number; doc?: PageDoc } | undefined;
    if (!d?.doc) {
      const ed = await this.api.edition(this.state.edition!.id);
      const p = ed.pages.find((x) => x.id === pid);
      d = p ? { rev: p.rev, doc: p.doc } : undefined;
    }
    if (!d?.doc) return this.set({ save: { state: "error", message: plainError(e) } });
    this.set({ conflict: { pageId: pid, mine: this.state.docs[pid]!, theirs: d.doc, theirsRev: d.rev ?? d.doc.rev }, save: { state: "error", message: plainError(e) } });
  }
  async resolveConflict(keep: "mine" | "theirs") {
    const c = this.state.conflict;
    if (!c) return;
    const pid = c.pageId;
    const rest = { ...this.state.remote }; delete rest[pid];
    this.set({ conflict: null, remote: rest, save: { state: "unsaved" } });
    this.set({ revs: { ...this.state.revs, [pid]: c.theirsRev } });
    if (keep === "theirs") {
      const doc = { ...c.theirs, rev: c.theirsRev };
      this.saved[pid] = saveSig(doc);
      const docs = { ...this.state.docs, [pid]: doc };
      this.hist.push(docs, undefined);
      this.set({ docs, save: { state: "saved", at: Date.now() } });
      await this.drafts.del(pid);
    } else {
      const docs = { ...this.state.docs, [pid]: { ...c.mine, rev: c.theirsRev } };
      this.hist.push(docs, undefined);
      this.set({ docs });
      this.afterChange([pid]);
      await this.saveNow();
    }
  }

  /* ---------- live updates (another person, or the worker, changed something) ---------- */
  setLive(live: EditorState["live"]) {
    if (this.state.live !== live) this.set({ live });
  }
  /**
   * One event from the stream (or one change found by the 15 s check). It never overwrites what this person is typing:
   *  - a page nobody here has touched is replaced quietly by the server's version;
   *  - a page with unsaved changes is only marked ("Someone changed this page") and the person decides.
   */
  async onLive(ev: LiveEvent): Promise<void> {
    if (this.disposed || this.state.phase !== "ready") return;
    const edId = this.state.edition?.id;
    if (ev.type === "resync") return void (await this.refreshFromServer());
    if (ev.type === "edition.changed") {
      if (ev.edition_id === edId) this.set({ listChanged: true });
      return;
    }
    const pid = ev.page_id;
    if (!this.state.docs[pid]) return; // another edition
    if (ev.fill != null || ev.type === "page.fit") {
      this.set({
        serverFit: ev.fill != null ? { ...this.state.serverFit, [pid]: ev.fill } : this.state.serverFit,
        fitState: ev.type === "page.fit" ? { ...this.state.fitState, [pid]: ev.state } : this.state.fitState,
      });
    }
    if (ev.type !== "page.updated") return;
    const known = this.state.revs[pid] ?? 0;
    if (ev.rev <= known) return; // our own save, or old news
    if (this.inflight.has(pid)) { this.later.set(pid, ev); return; } // our own save is on its way: look again when it is done
    if (this.dirtyPages().includes(pid)) {
      if ((this.state.remote[pid] ?? 0) < ev.rev) this.set({ remote: { ...this.state.remote, [pid]: ev.rev } });
      return;
    }
    await this.pull(pid, ev.rev);
  }

  /** Take the server's version of a page nobody here has changed. */
  private async pull(pid: string, atLeast: number) {
    let p: Awaited<ReturnType<Api["page"]>>;
    try { p = await this.api.page(pid); } catch { return; } // a failed look is not an error: the next event or check tries again
    if (this.disposed || p.rev <= (this.state.revs[pid] ?? 0) || p.rev < atLeast) return;
    if (this.dirtyPages().includes(pid) || this.inflight.has(pid)) { // the person started typing while we looked
      this.set({ remote: { ...this.state.remote, [pid]: p.rev } });
      return;
    }
    const doc = { ...p.doc, rev: p.rev };
    this.saved[pid] = saveSig(doc);
    const docs = { ...this.state.docs, [pid]: doc };
    this.hist.replace(docs);
    const flipped = this.state.docs[pid]?.status !== doc.status;
    this.set({ docs, revs: { ...this.state.revs, [pid]: p.rev }, serverFit: { ...this.state.serverFit, [pid]: p.fit_pct } }); // the open page measures itself again
    void this.drafts.del(pid).catch(() => undefined);
    if (flipped) {
      this.setAccess(pid, this.baseAccess(pid));
      if (this.state.active === pid && this.isEditable(pid)) void this.tryLock(pid);
    }
  }

  /** The 15-second check (used while the stream is down, and after the stream came back): compare with what the server has. */
  async refreshFromServer(): Promise<void> {
    const ed = this.state.edition;
    if (!ed || this.disposed || this.state.phase !== "ready") return;
    let rec: Awaited<ReturnType<Api["edition"]>>;
    try { rec = await this.api.edition(ed.id); } catch { return; }
    const ids = rec.pages.map((p) => p.id).sort().join();
    if (ids !== [...this.state.order].sort().join()) this.set({ listChanged: true });
    for (const p of rec.pages) {
      if (!this.state.docs[p.id]) continue;
      await this.onLive({ type: "page.updated", page_id: p.id, edition_id: ed.id, rev: p.rev, fill: p.fit_pct, status: p.status });
    }
  }

  /** "Reload" on the notice: shows both versions side by side (the same choice as a save conflict). Nothing is thrown away. */
  async reviewRemote(pid: string): Promise<void> {
    try {
      const p = await this.api.page(pid);
      const mine = this.state.docs[pid]!;
      const rest = { ...this.state.remote }; delete rest[pid];
      this.set({ remote: rest, conflict: { pageId: pid, mine, theirs: p.doc, theirsRev: p.rev } });
    } catch (e) { this.set({ notice: plainError(e, "load the other version") }); }
  }

  /* ---------- versions, approve ---------- */
  versions(pid: string): Promise<VersionRecord[]> {
    return this.api.versions(pid);
  }
  async restore(pid: string, rev: number) {
    await this.saveNow(); // never lose the present when going back
    try {
      const r = await this.api.restore(pid, rev);
      const doc = { ...r.doc, rev: r.rev };
      this.saved[pid] = saveSig(doc);
      const docs = { ...this.state.docs, [pid]: doc };
      this.hist.push(docs);
      this.set({ docs, revs: { ...this.state.revs, [pid]: r.rev }, notice: `Went back to version ${rev}.` });
      await this.drafts.del(pid);
    } catch (e) {
      this.set({ notice: plainError(e, "go back to that version") });
    }
  }
  /**
   * Delete a page (the app has asked "are you sure?" first). Everything unsaved is saved first, so the kept version is the
   * page as you see it. The server renumbers the later pages; then the edition is loaded again so the page numbers, the
   * story tray and the fit meters are the server's truth, and the page that is now in this place is measured and refitted.
   */
  async deletePage(pid: string): Promise<boolean> {
    const ed = this.state.edition;
    if (!ed || !this.state.docs[pid]) return false;
    const no = this.state.nos[pid] ?? 1;
    await this.saveNow();
    if (this.state.dirty.includes(pid)) { this.set({ notice: "This page has changes that are not saved yet, so it was not deleted. Try again in a moment." }); return false; }
    await this.releaseLock();
    try {
      await this.api.deletePage(pid);
    } catch (e) {
      this.set({ notice: plainError(e, "delete this page") });
      await this.setActive(pid);
      return false;
    }
    await this.drafts.del(pid);
    delete this.saved[pid];
    const left = this.state.order.length - 1;
    await this.load(ed.id, String(Math.min(no, Math.max(left, 1))));
    this.set({ notice: `Page ${no} was deleted and a copy is kept. The pages after it moved up one number.` });
    return true;
  }
  /** Sub-editor tick: draft → subbed (no server call beyond the normal save). */
  async approve(pid: string, fitOk: boolean) {
    if (!fitOk) return this.set({ notice: "This page doesn't fit yet. Shorten or move a story, then approve." });
    await this.saveNow();
    try {
      const fit = await this.api.fit(pid);
      if (fit.state === "over" || fit.overflow) return this.set({ notice: `The server measured this page at ${fit.fill_pct}% full. Cut or move a story, then approve.` });
      const r = await this.api.approve(pid);
      const d = { ...this.state.docs[pid]!, status: r.status ?? "approved", rev: r.rev ?? this.state.revs[pid]! };
      this.saved[pid] = saveSig(d);
      this.hist.replace({ ...this.state.docs, [pid]: d });
      this.set({ docs: { ...this.state.docs, [pid]: d }, revs: { ...this.state.revs, [pid]: d.rev }, access: { ...this.state.access, [pid]: { mode: "readonly", reason: "approved" } }, notice: "Page approved and locked." });
    } catch (e) {
      this.set({ notice: plainError(e, "approve this page") });
    }
  }
}
