// In-memory mock of the /v1 routes the admin console uses. Same paths, same shapes, same role checks as the real API
// (apps/api/src/routes). Used only by the Playwright tests. Loopback only.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

type Role = "owner" | "editor" | "sub" | "designer" | "viewer";
const PORT = Number(process.env.MOCK_PORT ?? 8171);
const USERS: Record<string, { id: string; name: string; password: string; role: Role; papers: Record<string, Role> }> = {
  "owner@desk.test": { id: "u-owner", name: "Olga Owner", password: "owner-pass-123", role: "owner", papers: { "daily-demo": "owner" } },
  "editor@desk.test": { id: "u-editor", name: "Ed Editor", password: "editor-pass-123", role: "editor", papers: { "daily-demo": "editor" } },
  "viewer@desk.test": { id: "u-viewer", name: "Vic Viewer", password: "viewer-pass-123", role: "viewer", papers: { "daily-demo": "viewer" } },
  // belongs to two papers: owner of the English one, editor of the Tamil one
  "multi@desk.test": { id: "u-multi", name: "Mala Multi", password: "multi-pass-123", role: "owner", papers: { "daily-demo": "owner", thenpothigai: "editor" } },
};
const PAPERS: Record<string, { id: string; name: string; lang: string; script: string }> = {
  "daily-demo": { id: "p1", name: "Daily Demo", lang: "en", script: "Latn" },
  thenpothigai: { id: "p2", name: "Thenpothigai", lang: "ta", script: "Taml" },
};
const WRITE: Role[] = ["owner", "editor", "sub", "designer"];

const mk = (n: number, headline: string, section: string, priority: number) => ({ id: `art_${n}`, headline, section, priority, url: `https://news.test/${n}`, lang: "en", source_id: "s0", published_at: "2026-11-23T05:00:00Z", deleted_at: null as string | null, data: { subhead: `Sub ${n}`, byline: "Staff", body: [{ text: `Body of ${headline}. `.repeat(8) }] } });
const sessions = new Map<string, { email: string; paper: string }>();
const states: Record<string, ReturnType<typeof fresh>> = {};
const freshAll = () => { for (const slug of Object.keys(PAPERS)) states[slug] = fresh(slug); sessions.clear(); };
let st: ReturnType<typeof fresh>;
function fresh(slug: string) {
  const P = PAPERS[slug]!;
  const ta = slug === "thenpothigai";
  return {
    paper: { id: P.id, slug, name: P.name, lang: P.lang, script: P.script, page_w_mm: 300, page_h_mm: 450, tz: "UTC", domain: null as string | null, ai_enabled: false },
    aiKey: process.env.MOCK_AI_KEY === "1",
    sources: [] as any[], articles: ta ? [mk(11, "கடலோரத்தில் வெள்ளம்", "news", 50), mk(12, "இன்று இரவு இறுதிப் போட்டி", "sport", 40)] : [mk(1, "Floods hit the coast", "news", 50), mk(2, "Cup final tonight", "sport", 40), mk(3, "Budget in brief", "business", 30)],
    editions: [] as any[], pages: new Map<string, any[]>(), exports: new Map<string, any[]>(), readers: new Map<string, any>(),
    members: Object.entries(USERS).filter(([, u]) => u.papers[slug]).map(([email, u]) => ({ user_id: u.id, role: u.papers[slug]!, name: u.name, email })),
    keys: [] as any[], hooks: [] as any[], deliveries: new Map<string, any[]>(), audit: [] as any[],
  };
}
const papersOf = (u: (typeof USERS)[string], cur: string) => Object.entries(u.papers).map(([slug, role]) => ({ slug, name: PAPERS[slug]!.name, lang: PAPERS[slug]!.lang, script: PAPERS[slug]!.script, role, current: slug === cur })).sort((a, b) => Number(b.current) - Number(a.current));
const log = (who: string, action: string, entity: string) => st.audit.unshift({ id: String(st.audit.length + 1), at: new Date().toISOString(), who, action, entity, entity_id: null });

const send = (res: ServerResponse, code: number, body: unknown, headers: Record<string, string> = {}) => { res.writeHead(code, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(body)); };
const err = (res: ServerResponse, code: number, c: string, message: string) => send(res, code, { code: c, message, details: {} });
const health = (s: any) => (s.last_sync_at ? { state: "ok", text: `Working. Last fetch: ${s.status.replace(/^ok: /, "")}.` } : s.status === "syncing" ? { state: "syncing", text: "Fetching new stories now." } : { state: "never", text: 'Nothing fetched yet. Press "Sync now".' });
const srcView = (s: any) => ({ id: s.id, name: s.name, kind: s.kind, config: s.config, mapping: s.mapping, schedule: s.schedule, last_sync_at: s.last_sync_at, health: health(s) });
const aiView = () => ({ configured: st.aiKey, enabled: st.aiKey && st.paper.ai_enabled, switch: st.paper.ai_enabled, reason: st.aiKey ? null : "No AI key has been added to the server, so AI cannot be turned on. Everything else works without it." });
const sample = () => st.articles.slice(0, 3).map((a) => ({ id: a.id, headline: a.headline, section: a.section, body: a.data.body }));

async function body(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const t = Buffer.concat(chunks).toString();
  return t ? JSON.parse(t) : {};
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");
  const p = url.pathname, m = req.method ?? "GET";
  if (p === "/healthz") return send(res, 200, { ok: true });
  if (p === "/readyz") return send(res, 200, { ok: true });
  if (p === "/__reset") { freshAll(); return send(res, 200, { ok: true }); }
  if (p === "/__ai") { st.aiKey = url.searchParams.get("key") === "1"; return send(res, 200, { ok: true }); }
  const b = ["POST", "PUT", "PATCH"].includes(m) ? await body(req) : {};

  if (p === "/v1/auth/login" && m === "POST") {
    const u = USERS[String(b.email).toLowerCase()];
    const slug = b.paper ? String(b.paper) : Object.keys(u?.papers ?? {})[0];
    if (!u || u.password !== b.password || !slug || !u.papers[slug]) return err(res, 401, "bad_login", "That email and password do not match.");
    const tok = randomUUID();
    sessions.set(tok, { email: String(b.email).toLowerCase(), paper: slug });
    st = states[slug]!;
    log(u.name, "login", "session");
    return send(res, 200, { ok: true, paper_id: st.paper.id, role: u.papers[slug] }, { "set-cookie": `mock_session=${tok}; Path=/; HttpOnly; SameSite=Lax` });
  }
  const tok = /mock_session=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
  const sess = tok ? sessions.get(tok) : undefined;
  const base = sess ? USERS[sess.email] : undefined;
  if (sess) st = states[sess.paper]!;
  const user = base && sess ? { ...base, role: base.papers[sess.paper]! } : undefined;
  if (p === "/v1/auth/logout") { if (tok) sessions.delete(tok); return send(res, 200, { ok: true }, { "set-cookie": "mock_session=; Path=/; Max-Age=0" }); }
  if (!user) return err(res, 401, "not_signed_in", "Please sign in first.");
  const need = (...roles: Role[]) => { if (roles.length && !roles.includes(user.role)) { err(res, 403, "forbidden", user.role === "viewer" ? "Viewers can look but not save. Ask an editor or the owner." : "Your role does not allow this."); return false; } return true; };
  const who = user.name;
  const seg = p.split("/").filter(Boolean); // v1, ...
  const key = `${m} ${p.replace(/\/[0-9a-f-]{8,}(?=\/|$)/g, "/:id").replace(/\/(art_\d+|s\d+|u-\w+|e\d+)(?=\/|$)/g, "/:id")}`;
  const id = seg.find((x, i) => i > 1 && /^([0-9a-f-]{8,}|art_\d+|s\d+|u-\w+|e\d+)$/.test(x))!;

  switch (key) {
    case "GET /v1/auth/me": return send(res, 200, { paper: { id: st.paper.id, slug: st.paper.slug, name: st.paper.name, lang: st.paper.lang, script: st.paper.script }, role: user.role, user_id: user.id, papers: papersOf(base!, sess!.paper) });
    case "GET /v1/me/papers": return send(res, 200, { items: papersOf(base!, sess!.paper) });
    case "POST /v1/auth/switch": {
      const to = PAPERS[String(b.paper)] && base!.papers[String(b.paper)] ? String(b.paper) : null;
      if (!to) return err(res, 403, "no_access", "You do not have access to that paper.");
      const old = sess!.paper;
      sessions.set(tok!, { email: sess!.email, paper: to }); // (the real API issues a new cookie; the mock keeps one)
      states[old]!.audit.unshift({ id: String(states[old]!.audit.length + 1), at: new Date().toISOString(), who: user.name, action: "switch.away", entity: "session", entity_id: null });
      states[to]!.audit.unshift({ id: String(states[to]!.audit.length + 1), at: new Date().toISOString(), who: user.name, action: "switch.in", entity: "session", entity_id: null });
      return send(res, 200, { ok: true });
    }
    case "GET /v1/admin/paper": return send(res, 200, { ...st.paper, ai: aiView() });
    case "PATCH /v1/admin/paper": if (!need("owner")) return; Object.assign(st.paper, b); log(who, "update", "paper"); return send(res, 200, { ...st.paper, ai: aiView() });
    case "PUT /v1/admin/ai":
      if (!need("owner")) return;
      if (b.enabled && !st.aiKey) return err(res, 409, "ai_no_key", "AI cannot be turned on: no AI key has been added to the server. Everything still works without it.");
      st.paper.ai_enabled = !!b.enabled; log(who, b.enabled ? "ai.on" : "ai.off", "paper"); return send(res, 200, aiView());

    case "GET /v1/admin/sources": return send(res, 200, { items: st.sources.map(srcView) });
    case "POST /v1/sources/wizard":
      if (!need("owner", "editor")) return;
      if (/nowhere|bad/.test(b.url)) return err(res, 422, "wizard_failed", "We could not open that address. Check it is spelled right and the site is online.");
      return send(res, 200, { site: b.url, kind: "wordpress", config: { site: b.url }, mapping: { headline: "title.rendered", body: "content.rendered", published_at: "date" }, confidence: 0.86, fields: { headline: 1, body: 1, published_at: 1, "images[0].src": 0.6 }, sample: sample(), notes: [], errors: [] });
    case "POST /v1/sources": {
      if (!need("owner", "editor")) return;
      const s = { id: `s${st.sources.length + 1}`, kind: b.kind, name: b.name, config: b.config, mapping: b.mapping ?? null, schedule: b.schedule ?? null, last_sync_at: null as string | null, status: "idle" };
      st.sources.push(s); log(who, "create", "source"); return send(res, 201, s);
    }
    case "PATCH /v1/admin/sources/:id": { if (!need("owner", "editor")) return; const s = st.sources.find((x) => x.id === id); if (!s) return err(res, 404, "not_found", "That source was not found."); Object.assign(s, b); log(who, "update", "source"); return send(res, 200, srcView(s)); }
    case "POST /v1/sources/:id/test": { if (!need("owner", "editor")) return; return send(res, 200, { ok: true, count: 3, articles: sample(), errors: [], skipped: 0 }); }
    case "POST /v1/sources/:id/sync": { if (!need("owner", "editor")) return; const s = st.sources.find((x) => x.id === id); if (!s) return err(res, 404, "not_found", "That source was not found."); s.status = "ok: 3 new, 0 changed, 0 same"; s.last_sync_at = new Date().toISOString(); log(who, "sync", "source"); return send(res, 202, { job_id: "j1", queue: "ingest" }); }
    case "DELETE /v1/sources/:id": { if (!need("owner", "editor")) return; st.sources = st.sources.filter((x) => x.id !== id); log(who, "delete", "source"); return send(res, 200, { ok: true }); }
    case "POST /v1/sources/:id/keys": { if (!need("owner")) return; const k = { id: randomUUID(), source_id: id, label: st.sources.find((x) => x.id === id)?.name ?? "", last_used_at: null, created_at: new Date().toISOString() }; st.keys.push(k); log(who, "create", "api_key"); return send(res, 201, { id: k.id, key: `epk_${randomUUID().replace(/-/g, "")}`, note: "Copy this key now. It is shown once." }); }

    case "GET /v1/admin/articles": {
      const q = (url.searchParams.get("q") ?? "").toLowerCase(), sec = url.searchParams.get("section") ?? "", hid = url.searchParams.get("hidden") ?? "no";
      const items = st.articles.filter((a) => (!q || a.headline.toLowerCase().includes(q)) && (!sec || a.section === sec) && (hid === "all" || (hid === "yes") === !!a.deleted_at)).map((a) => ({ ...a, hidden: !!a.deleted_at }));
      return send(res, 200, { items });
    }
    case "PATCH /v1/articles/:id": { if (!need("owner", "editor", "sub")) return; const a = st.articles.find((x) => x.id === id); if (!a) return err(res, 404, "not_found", "That article was not found."); Object.assign(a, b); log(who, "update", "article"); return send(res, 200, a.data); }
    case "PATCH /v1/admin/articles/:id/hidden": { if (!need("owner", "editor", "sub")) return; const a = st.articles.find((x) => x.id === id); if (!a) return err(res, 404, "not_found", "That article was not found."); a.deleted_at = b.hidden ? new Date().toISOString() : null; log(who, b.hidden ? "hide" : "unhide", "article"); return send(res, 200, { id, hidden: !!b.hidden }); }

    case "GET /v1/editions": return send(res, 200, { items: st.editions.map((e) => ({ id: e.id, name: e.name, date: e.date, status: e.status, rev: 1 })) });
    case "POST /v1/editions": {
      if (!need(...WRITE)) return;
      const ex = st.editions.find((e) => e.date === b.date && e.name === (b.name ?? ""));
      if (ex) return send(res, 200, { id: ex.id, existed: true });
      const e = { id: `e${st.editions.length + 1}`, name: b.name ?? "", date: b.date, status: "draft" };
      st.editions.push(e); st.pages.set(e.id, []); st.exports.set(e.id, []); log(who, "create", "edition"); return send(res, 201, { id: e.id, date: b.date, existed: false });
    }
    case "POST /v1/editions/:id/autoplan": {
      if (!need(...WRITE)) return;
      const e = st.editions.find((x) => x.id === id)!; e.status = "planning"; const sx = st;
      setTimeout(() => { sx.pages.set(e.id, [92, 78, 105, 88].map((f, i) => ({ id: `${e.id}-p${i + 1}`, no: i + 1, fit_pct: f, status: "draft" }))); e.status = "draft"; }, 700);
      log(who, "autoplan", "edition"); return send(res, 202, { job_id: "j2", queue: "layout" });
    }
    case "GET /v1/admin/editions/:id/overview": {
      const e = st.editions.find((x) => x.id === id); if (!e) return err(res, 404, "not_found", "That edition was not found.");
      return send(res, 200, { id: e.id, date: e.date, name: e.name, status: e.status, pages: st.pages.get(e.id), exports: st.exports.get(e.id), reader: st.readers.get(e.id) ?? null });
    }
    case "POST /v1/admin/editions/:id/approve-all": {
      if (!need(...WRITE)) return;
      const pages = st.pages.get(id) ?? []; const n = pages.filter((x) => x.status !== "approved").length; pages.forEach((x) => (x.status = "approved")); log(who, "approve_all", "edition"); return send(res, 200, { approved: n, skipped: 0 });
    }
    case "POST /v1/editions/:id/exports": {
      if (!need(...WRITE)) return;
      const list = st.exports.get(id)!; const sx = st; const x: any = { id: randomUUID(), format: b.format, status: "running", url: null };
      list.unshift(x);
      setTimeout(() => { x.status = "done"; x.url = `/v1/exports/${x.id}/download`; if (b.format === "pdf_screen") sx.readers.set(id, { id, status: "ready", version: 1, publish_at: null }); }, 600);
      return send(res, 202, { id: x.id, status: "queued", job_id: "j3" });
    }
    case "POST /v1/epaper/editions/:id/publish": {
      if (!need("owner", "editor")) return;
      const eid = id.replace(/^r-/, ""); const r = st.readers.get(eid); if (!r) return err(res, 404, "not_found", "That e-paper edition was not found.");
      r.status = "published"; log(who, "publish", "ep_edition"); return send(res, 200, { status: "published" });
    }
    case "POST /v1/epaper/editions/:id/rollback": {
      if (!need("owner", "editor")) return;
      const eid = id.replace(/^r-/, ""); const r = st.readers.get(eid); if (!r) return err(res, 404, "not_found", "That e-paper edition was not found.");
      r.status = "ready"; log(who, "rollback", "ep_edition"); return send(res, 200, { rolled_back: "edition" });
    }

    case "GET /v1/admin/members": if (!need("owner")) return; return send(res, 200, { items: st.members.map((x) => ({ ...x, you: x.user_id === user.id })) });
    case "POST /v1/members": if (!need("owner")) return; st.members.push({ user_id: randomUUID(), role: b.role, name: b.name, email: b.email }); log(who, "member.set", "membership"); return send(res, 201, { role: b.role });
    case "PATCH /v1/admin/members/:id": { if (!need("owner")) return; const x = st.members.find((y) => y.user_id === id); if (!x) return err(res, 404, "not_found", "That person was not found."); x.role = b.role; log(who, "member.role", "membership"); return send(res, 200, { role: b.role }); }
    case "DELETE /v1/admin/members/:id": { if (!need("owner")) return; st.members = st.members.filter((y) => y.user_id !== id); log(who, "member.remove", "membership"); return send(res, 200, { ok: true }); }
    case "GET /v1/admin/keys": if (!need("owner")) return; return send(res, 200, { items: st.keys });
    case "DELETE /v1/admin/keys/:id": if (!need("owner")) return; st.keys = st.keys.filter((k) => k.id !== id); log(who, "revoke", "api_key"); return send(res, 200, { ok: true });
    case "GET /v1/webhooks": if (!need("owner")) return; return send(res, 200, { items: st.hooks });
    case "POST /v1/webhooks": { if (!need("owner")) return; const h = { id: randomUUID(), url: b.url, events: ["edition.published"], active: true }; st.hooks.push(h); st.deliveries.set(h.id, []); return send(res, 201, { id: h.id, secret: `whsec_${randomUUID().replace(/-/g, "")}` }); }
    case "POST /v1/admin/webhooks/:id/test": { if (!need("owner")) return; const d = { id: randomUUID(), event: "test", status: "delivered", attempts: 1, last_error: null }; st.deliveries.get(id)?.unshift(d); log(who, "test", "webhook"); return send(res, 202, { delivery_id: d.id }); }
    case "DELETE /v1/admin/webhooks/:id": if (!need("owner")) return; st.hooks = st.hooks.filter((h) => h.id !== id); log(who, "delete", "webhook"); return send(res, 200, { ok: true });
    case "GET /v1/webhooks/:id/deliveries": if (!need("owner")) return; return send(res, 200, { items: st.deliveries.get(id) ?? [] });
    case "GET /v1/admin/audit": if (!need("owner")) return; return send(res, 200, { items: st.audit.slice(0, 100) });
  }
  return err(res, 404, "not_found", "There is nothing at this address.");
}

freshAll();
createServer((req, res) => { handle(req, res).catch(() => err(res, 500, "server_error", "Something went wrong on our side. Nothing was lost; please try again.")); }).listen(PORT, "127.0.0.1", () => console.log(`admin mock on 127.0.0.1:${PORT}`));
