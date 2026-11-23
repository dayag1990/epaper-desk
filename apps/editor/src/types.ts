import type { Article, PageDoc } from "@epaper/core";
import type { Template } from "./layout";

export type { PageDoc, Article, Template };
export type Role = "owner" | "editor" | "sub" | "designer" | "viewer";
export interface Person {
  id: string;
  name: string;
}
export interface Me {
  user: Person & { email?: string };
  role: Role;
  /** True only when a key/model is present AND an admin switched AI on. Off by default. */
  ai_enabled: boolean;
}
export interface PageRecord {
  id: string;
  no: number;
  doc: PageDoc;
  rev: number;
  status: string;
  fit_pct: number | null;
  locked_by: Person | null;
  template_id?: string;
}
export interface EditionRecord {
  id: string;
  name: string;
  date: string;
  status?: string;
  rev?: number;
  pages: PageRecord[];
  templates?: Template[];
  articles?: Article[];
}
export interface AssetRecord {
  id: string;
  src: string;
  w?: number;
  h?: number;
  parent_id?: string | null;
}
export interface VersionRecord {
  rev: number;
  at: string;
  user?: Person | null;
  doc: PageDoc;
}
export interface FitReportLite {
  fill_pct: number;
  state: "ok" | "low" | "over";
  overflow: boolean;
  body_pt?: number;
}
export interface LockInfo {
  locked_by: Person;
  expires_at?: string;
}
