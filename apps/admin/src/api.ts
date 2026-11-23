import type { Article } from "@epaper/core";
import type { ArticleRow, AuditRow, DeliveryRow, EditionRow, HookRow, KeyRow, Me, Member, Overview, PaperView, Proposal, Role, SourceRow, TestResult } from "./types";
import { ApiError } from "./lib/words";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Client for the /v1 routes the console uses. Same origin, session cookie, no private doors. */
export class Api {
  constructor(private base = "", private f: FetchLike = (i, init) => fetch(i, init)) {}

  async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await this.f(this.base + path, { method, headers, credentials: "include", body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError(0, "network", "Can't reach the server");
    }
    const text = await res.text();
    let json: any;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    if (!res.ok) throw new ApiError(res.status, json?.code ?? `http_${res.status}`, json?.message ?? res.statusText, json?.details);
    return json as T;
  }
  private q = (o: Record<string, string | number | undefined>) => {
    const p = Object.entries(o).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
    return p ? `?${p}` : "";
  };

  login = (email: string, password: string, paper?: string) => this.req<{ ok: true; role: Role }>("POST", "/v1/auth/login", { email, password, ...(paper ? { paper } : {}) });
  logout = () => this.req<{ ok: true }>("POST", "/v1/auth/logout");
  me = () => this.req<Me>("GET", "/v1/auth/me");
  ready = async () => { try { return (await this.f(this.base + "/readyz")).ok; } catch { return false; } };

  paper = () => this.req<PaperView>("GET", "/v1/admin/paper");
  savePaper = (b: Partial<Pick<PaperView, "name" | "lang" | "script" | "page_w_mm" | "page_h_mm" | "tz" | "domain">>) => this.req<PaperView>("PATCH", "/v1/admin/paper", b);
  setAi = (enabled: boolean) => this.req<PaperView["ai"]>("PUT", "/v1/admin/ai", { enabled });

  sources = () => this.req<{ items: SourceRow[] }>("GET", "/v1/admin/sources");
  wizard = (url: string) => this.req<Proposal>("POST", "/v1/sources/wizard", { url });
  createSource = (b: { kind: string; name: string; config: Record<string, unknown>; mapping?: Record<string, string>; schedule?: string }) => this.req<{ id: string }>("POST", "/v1/sources", b);
  editSource = (id: string, b: { name?: string; mapping?: Record<string, string>; schedule?: string | null }) => this.req<SourceRow>("PATCH", `/v1/admin/sources/${id}`, b);
  testSource = (id: string) => this.req<TestResult>("POST", `/v1/sources/${id}/test`);
  syncSource = (id: string) => this.req<{ job_id: string }>("POST", `/v1/sources/${id}/sync`);
  deleteSource = (id: string) => this.req<{ ok: true }>("DELETE", `/v1/sources/${id}`);

  articles = (o: { q?: string; section?: string; hidden?: string }) => this.req<{ items: ArticleRow[] }>("GET", "/v1/admin/articles" + this.q(o));
  patchArticle = (id: string, b: { priority?: number; section?: string }) => this.req<Article>("PATCH", `/v1/articles/${encodeURIComponent(id)}`, b);
  hideArticle = (id: string, hidden: boolean) => this.req<{ id: string; hidden: boolean }>("PATCH", `/v1/admin/articles/${encodeURIComponent(id)}/hidden`, { hidden });

  editions = () => this.req<{ items: EditionRow[] }>("GET", "/v1/editions");
  createEdition = (date: string, name = "", template_set = "broadsheet-en") => this.req<{ id: string; existed: boolean }>("POST", "/v1/editions", { date, name, template_set });
  overview = (id: string) => this.req<Overview>("GET", `/v1/admin/editions/${id}/overview`);
  autoplan = (id: string) => this.req<{ job_id: string }>("POST", `/v1/editions/${id}/autoplan`, {});
  approveAll = (id: string) => this.req<{ approved: number; skipped: number }>("POST", `/v1/admin/editions/${id}/approve-all`);
  exportEdition = (id: string, format: "pdf_screen" | "cxml") => this.req<{ id: string }>("POST", `/v1/editions/${id}/exports`, { format });
  publish = (readerId: string, at?: string) => this.req<{ status: string }>("POST", `/v1/epaper/editions/${readerId}/publish`, at ? { at } : {});
  rollback = (readerId: string) => this.req<{ rolled_back: "page" | "edition"; no?: number }>("POST", `/v1/epaper/editions/${readerId}/rollback`);

  members = () => this.req<{ items: Member[] }>("GET", "/v1/admin/members");
  addMember = (b: { email: string; name: string; password: string; role: Role }) => this.req<{ user_id: string }>("POST", "/v1/members", b);
  setRole = (user_id: string, role: Role) => this.req<{ role: Role }>("PATCH", `/v1/admin/members/${user_id}`, { role });
  removeMember = (user_id: string) => this.req<{ ok: true }>("DELETE", `/v1/admin/members/${user_id}`);

  keys = () => this.req<{ items: KeyRow[] }>("GET", "/v1/admin/keys");
  createKey = (source_id: string) => this.req<{ id: string; key: string }>("POST", `/v1/sources/${source_id}/keys`);
  revokeKey = (id: string) => this.req<{ ok: true }>("DELETE", `/v1/admin/keys/${id}`);

  hooks = () => this.req<{ items: HookRow[] }>("GET", "/v1/webhooks");
  createHook = (url: string) => this.req<{ id: string; secret: string }>("POST", "/v1/webhooks", { url });
  testHook = (id: string) => this.req<{ delivery_id: string }>("POST", `/v1/admin/webhooks/${id}/test`);
  deleteHook = (id: string) => this.req<{ ok: true }>("DELETE", `/v1/admin/webhooks/${id}`);
  deliveries = (id: string) => this.req<{ items: DeliveryRow[] }>("GET", `/v1/webhooks/${id}/deliveries`);

  audit = () => this.req<{ items: AuditRow[] }>("GET", "/v1/admin/audit?limit=100");
}
