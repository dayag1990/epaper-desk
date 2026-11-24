import type { PageDoc } from "@epaper/core";
import { ApiError } from "./errors";
import type { AssetRecord, EditionListItem, EditionRecord, FitReportLite, LockInfo, Me, VersionRecord } from "./types";

/**
 * Client for the /v1 routes the editor uses. Route list = docs/build-spec.json `api`, exactly:
 *   GET  /v1/editions/:id            PUT  /v1/pages/:id {doc, rev}        POST /v1/pages/:id/fit
 *   POST /v1/pages/:id/approve       GET  /v1/pages/:id/versions          POST /v1/pages/:id/restore {rev}
 *   POST /v1/assets                  POST /v1/assets/:id/cutout           POST /v1/ai/suggest
 * Routes the spec does NOT list but the editor needs (flagged for the API author):
 *   GET  /v1/me                      -> who am I, my role, is AI on
 *   POST /v1/auth/switch {paper}     -> move the session to another paper of mine; GET /v1/editions -> the current paper's editions
 *   POST /v1/pages/:id/lock          -> take / refresh the page lock (heartbeat); 423 when someone else has it
 *   DELETE /v1/pages/:id/lock        -> let go of the lock
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiOptions {
  base: string;
  fetch?: FetchLike;
  mockUser?: string;
}

export class Api {
  private f: FetchLike;
  constructor(private o: ApiOptions) {
    this.f = o.fetch ?? ((i, init) => fetch(i, init));
  }

  private async req<T>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.o.mockUser) headers["x-mock-user"] = this.o.mockUser;
    let payload: BodyInit | undefined;
    if (form) payload = form;
    else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    let res: Response;
    try {
      res = await this.f(this.o.base + path, { method, headers, body: payload, credentials: "include" });
    } catch {
      throw new ApiError(0, "network", "Can't reach the server");
    }
    const text = await res.text();
    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }
    if (!res.ok) {
      const j = (json ?? {}) as { code?: string; message?: string; details?: unknown };
      throw new ApiError(res.status, j.code ?? `http_${res.status}`, j.message ?? res.statusText, j.details);
    }
    return json as T;
  }

  me = () => this.req<Me>("GET", "/v1/me");
  /** Move this session to another paper the person belongs to (the server answers 403 in plain words otherwise). */
  switchPaper = (paper: string) => this.req<Me>("POST", "/v1/auth/switch", { paper });
  editions = async () => (await this.req<{ items: EditionListItem[] }>("GET", "/v1/editions")).items;
  edition = (id: string) => this.req<EditionRecord>("GET", `/v1/editions/${enc(id)}`);
  savePage = (id: string, doc: PageDoc, rev: number) =>
    this.req<{ rev: number; doc?: PageDoc; fit_pct?: number }>("PUT", `/v1/pages/${enc(id)}`, { doc, rev });
  fit = (id: string) => this.req<FitReportLite>("POST", `/v1/pages/${enc(id)}/fit`, {});
  approve = (id: string) => this.req<{ status: string; rev?: number }>("POST", `/v1/pages/${enc(id)}/approve`, {});
  versions = async (id: string) => (await this.req<{ versions: VersionRecord[] }>("GET", `/v1/pages/${enc(id)}/versions`)).versions;
  restore = (id: string, rev: number) => this.req<{ rev: number; doc: PageDoc }>("POST", `/v1/pages/${enc(id)}/restore`, { rev });
  uploadAsset = async (file: File | Blob, name = "photo") => {
    const fd = new FormData();
    fd.append("file", file, (file as File).name ?? name);
    return (await this.req<{ asset: AssetRecord }>("POST", "/v1/assets", undefined, fd)).asset;
  };
  cutout = async (assetId: string) => (await this.req<{ asset: AssetRecord }>("POST", `/v1/assets/${enc(assetId)}/cutout`, {})).asset;
  suggest = async (p: { task: "headline"; text: string; max_chars?: number; article_id?: string }) =>
    (await this.req<{ options: { text: string }[] }>("POST", "/v1/ai/suggest", p)).options;
  /** Delete a page: the server keeps a version and a copy, later pages move up one number. */
  deletePage = (id: string) => this.req<{ deleted: { id: string; no: number; rev: number }; pages: { id: string; no: number; rev: number }[] }>("DELETE", `/v1/pages/${enc(id)}`);
  lock = (id: string) => this.req<LockInfo>("POST", `/v1/pages/${enc(id)}/lock`, {});
  unlock = (id: string) => this.req<unknown>("DELETE", `/v1/pages/${enc(id)}/lock`);
}
const enc = encodeURIComponent;
