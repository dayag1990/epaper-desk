import type { PageDoc } from "@epaper/core";

/** Unsaved typing kept in the browser, so a crash, a reload or a dead network loses nothing. */
export interface Draft {
  doc: PageDoc;
  baseRev: number;
  at: number;
}
export interface DraftStore {
  get(pageId: string): Promise<Draft | undefined>;
  put(pageId: string, d: Draft): Promise<void>;
  del(pageId: string): Promise<void>;
}
export class MemoryDrafts implements DraftStore {
  m = new Map<string, Draft>();
  async get(id: string) { return this.m.get(id); }
  async put(id: string, d: Draft) { this.m.set(id, d); }
  async del(id: string) { this.m.delete(id); }
}

const DB = "epaper-editor", STORE = "drafts";
export class IdbDrafts implements DraftStore {
  private fallback = new MemoryDrafts();
  private db: Promise<IDBDatabase | null>;
  constructor(factory: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB) {
    this.db = new Promise((res) => {
      try {
        if (!factory) return res(null);
        const r = factory.open(DB, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE);
        r.onsuccess = () => res(r.result);
        r.onerror = () => res(null);
        r.onblocked = () => res(null);
      } catch {
        res(null);
      }
    });
  }
  private async run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
    const db = await this.db;
    if (!db) return undefined;
    return new Promise<T | undefined>((res) => {
      try {
        const rq = f(db.transaction(STORE, mode).objectStore(STORE));
        rq.onsuccess = () => res(rq.result as T);
        rq.onerror = () => res(undefined);
      } catch {
        res(undefined);
      }
    });
  }
  async get(id: string) {
    if (!(await this.db)) return this.fallback.get(id);
    return this.run<Draft>("readonly", (s) => s.get(id));
  }
  async put(id: string, d: Draft) {
    if (!(await this.db)) return this.fallback.put(id, d);
    await this.run("readwrite", (s) => s.put(d, id));
  }
  async del(id: string) {
    if (!(await this.db)) return this.fallback.del(id);
    await this.run("readwrite", (s) => s.delete(id));
  }
}
