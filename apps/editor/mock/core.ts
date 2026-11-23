import type { PageDoc } from "@epaper/core";
import type { Article } from "@epaper/core";
import type { Person, Role, Template } from "../src/types";

/** In-memory stand-in for the real /v1 API (the real one is not merged yet). Same routes, same status codes the editor expects. */
export interface MockUser extends Person { role: Role }
export interface MockSeed {
  edition: { id: string; name: string; date: string };
  pages: { id: string; no: number; doc: PageDoc; template_id: string }[];
  templates: Template[];
  articles: Article[];
}
export interface MockReq {
  method: string;
  path: string;
  user?: string;
  body?: any;
}
export interface MockRes {
  status: number;
  json?: unknown;
}
interface PageRow { id: string; no: number; doc: PageDoc; rev: number; status: string; template_id: string; versions: { rev: number; at: string; user: Person; doc: PageDoc }[]; lock?: { user: Person; until: number } }

export const USERS: Record<string, MockUser> = {
  ana: { id: "usr_ana", name: "Ana Costa", role: "editor" },
  bea: { id: "usr_bea", name: "Bea Jones", role: "editor" },
  vic: { id: "usr_vic", name: "Vic Viewer", role: "viewer" },
};

export class MockBackend {
  pages = new Map<string, PageRow>();
  assets = new Map<string, { id: string; src: string; parent_id?: string | null }>();
  aiEnabled = false;
  cutoutBuilt = false;
  lockTtlMs = 5 * 60_000;
  now = () => Date.now();
  private n = 0;
  constructor(private seed: MockSeed, private origin = "") { this.reset(); }

  reset() {
    this.pages.clear();
    this.assets.clear();
    this.aiEnabled = false;
    this.cutoutBuilt = false;
    for (const p of this.seed.pages) {
      const doc = structuredClone(p.doc);
      this.pages.set(p.id, { id: p.id, no: p.no, doc, rev: doc.rev, status: doc.status, template_id: p.template_id, versions: [{ rev: doc.rev, at: new Date(this.now()).toISOString(), user: { id: "usr_system", name: "Auto-plan" }, doc: structuredClone(doc) }] });
    }
  }

  handle(r: MockReq): MockRes {
    const path = r.path.split("?")[0]!;
    if (path === "/healthz") return { status: 200, json: { ok: true } };
    if (path === "/__reset" && r.method === "POST") { this.reset(); return { status: 200, json: { ok: true } }; }
    if (path === "/__config" && r.method === "POST") {
      if (r.body?.ai !== undefined) this.aiEnabled = !!r.body.ai;
      if (r.body?.cutout !== undefined) this.cutoutBuilt = !!r.body.cutout;
      if (r.body?.lockTtlMs !== undefined) this.lockTtlMs = r.body.lockTtlMs;
      return { status: 200, json: { ok: true } };
    }
    const u = USERS[r.user ?? "ana"];
    if (!u) return err(401, "unauthorized", "Not signed in");
    let m: RegExpExecArray | null;
    if (path === "/v1/me" && r.method === "GET") return { status: 200, json: { user: { id: u.id, name: u.name }, role: u.role, ai_enabled: this.aiEnabled } };
    if ((m = /^\/v1\/editions\/([^/]+)$/.exec(path)) && r.method === "GET") {
      if (m[1] !== this.seed.edition.id) return err(404, "not_found", "No such edition");
      return { status: 200, json: { ...this.seed.edition, status: "open", pages: [...this.pages.values()].map((p) => this.pageOut(p)), templates: this.seed.templates, articles: this.seed.articles } };
    }
    if ((m = /^\/v1\/pages\/([^/]+)(?:\/(\w+))?$/.exec(path))) {
      const p = this.pages.get(m[1]!);
      if (!p) return err(404, "not_found", "No such page");
      return this.pageRoute(p, m[2], r, u);
    }
    if (path === "/v1/assets" && r.method === "POST") {
      if (u.role === "viewer") return err(403, "forbidden", "Viewers cannot upload");
      const id = `ast_up${++this.n}`;
      const a = { id, src: `${this.origin}/mock-assets/${id}.svg` };
      this.assets.set(id, a);
      return { status: 201, json: { asset: { ...a, w: 2400, h: 1600 } } };
    }
    if ((m = /^\/v1\/assets\/([^/]+)\/cutout$/.exec(path)) && r.method === "POST") {
      if (!this.cutoutBuilt) return err(501, "not_built", "Cut-out is not built yet");
      const id = `ast_cut${++this.n}`;
      return { status: 201, json: { asset: { id, src: `${this.origin}/mock-assets/${id}.svg`, parent_id: m[1], w: 2400, h: 1600 } } };
    }
    if (path === "/v1/ai/suggest" && r.method === "POST") {
      if (!this.aiEnabled) return err(403, "ai_disabled", "AI is off");
      const words = String(r.body?.text ?? "").split(/\s+/).filter(Boolean);
      return { status: 200, json: { options: [words.slice(0, Math.max(3, words.length - 2)).join(" "), words.slice(0, Math.max(3, words.length - 4)).join(" "), words.slice(0, 5).join(" ")].map((t) => ({ text: t })) } };
    }
    return err(404, "not_found", `No route ${r.method} ${path}`);
  }

  private pageOut(p: PageRow) {
    this.expire(p);
    return { id: p.id, no: p.no, doc: p.doc, rev: p.rev, status: p.status, fit_pct: null, locked_by: p.lock?.user ?? null, template_id: p.template_id };
  }
  private expire(p: PageRow) { if (p.lock && p.lock.until < this.now()) p.lock = undefined; }

  private pageRoute(p: PageRow, sub: string | undefined, r: MockReq, u: MockUser): MockRes {
    this.expire(p);
    const held = p.lock && p.lock.user.id !== u.id ? p.lock.user : null;
    if (sub === "lock") {
      if (u.role === "viewer") return err(403, "forbidden", "Viewers cannot lock pages");
      if (r.method === "DELETE") { if (!held) p.lock = undefined; return { status: 204 }; }
      if (held) return err(423, "locked", `${held.name} is editing this page`, { locked_by: held });
      p.lock = { user: { id: u.id, name: u.name }, until: this.now() + this.lockTtlMs };
      return { status: 200, json: { locked_by: p.lock.user, expires_at: new Date(p.lock.until).toISOString() } };
    }
    if (!sub && r.method === "PUT") {
      if (u.role === "viewer") return err(403, "forbidden", "Your role cannot save pages");
      if (held) return err(423, "locked", `${held.name} is editing this page`, { locked_by: held });
      if (p.status === "approved") return err(423, "approved", "This page is approved and locked", { locked_by: { id: "-", name: "Approval" } });
      if (r.body?.rev !== p.rev) return err(409, "stale_rev", "This page changed since you opened it", { rev: p.rev, doc: p.doc });
      p.rev += 1;
      p.doc = { ...structuredClone(r.body.doc), rev: p.rev };
      p.status = p.doc.status;
      p.versions.push({ rev: p.rev, at: new Date(this.now()).toISOString(), user: { id: u.id, name: u.name }, doc: structuredClone(p.doc) });
      return { status: 200, json: { rev: p.rev, doc: p.doc } };
    }
    if (sub === "versions" && r.method === "GET") return { status: 200, json: { versions: [...p.versions].reverse() } };
    if (sub === "restore" && r.method === "POST") {
      if (u.role === "viewer") return err(403, "forbidden", "Your role cannot restore pages");
      const v = p.versions.find((x) => x.rev === r.body?.rev);
      if (!v) return err(404, "not_found", "No such version");
      p.rev += 1;
      p.doc = { ...structuredClone(v.doc), rev: p.rev };
      p.status = p.doc.status;
      p.versions.push({ rev: p.rev, at: new Date(this.now()).toISOString(), user: { id: u.id, name: u.name }, doc: structuredClone(p.doc) });
      return { status: 200, json: { rev: p.rev, doc: p.doc } };
    }
    if (sub === "fit" && r.method === "POST") return { status: 200, json: { fill_pct: 92, state: "ok", overflow: false } }; // mocked: the real one measures in Chromium
    if (sub === "approve" && r.method === "POST") {
      if (u.role === "viewer") return err(403, "forbidden", "Your role cannot approve pages");
      p.rev += 1;
      p.status = "approved";
      p.doc = { ...p.doc, status: "approved", rev: p.rev };
      return { status: 200, json: { status: "approved", rev: p.rev } };
    }
    return err(404, "not_found", `No route ${r.method} /v1/pages/:id/${sub ?? ""}`);
  }
}
const err = (status: number, code: string, message: string, details?: unknown): MockRes => ({ status, json: { code, message, details } });

/** fetch() look-alike over a MockBackend, for unit tests and in-process use. */
export function mockFetch(b: MockBackend, user = "ana") {
  return async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input, "http://mock.local");
    const hdr = (init.headers ?? {}) as Record<string, string>;
    let body: unknown;
    if (typeof init.body === "string") body = JSON.parse(init.body);
    const res = b.handle({ method: init.method ?? "GET", path: url.pathname, user: hdr["x-mock-user"] ?? user, body });
    return new Response(res.status === 204 ? null : JSON.stringify(res.json ?? {}), { status: res.status, headers: { "content-type": "application/json" } });
  };
}
