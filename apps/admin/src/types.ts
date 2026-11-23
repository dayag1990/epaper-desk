import type { Article, Mapping } from "@epaper/core";

export type Role = "owner" | "editor" | "sub" | "designer" | "viewer";
export interface Me { paper: { id: string; slug: string; name: string }; role: Role; user_id: string | null }
export interface Health { state: "ok" | "error" | "syncing" | "never" | "idle"; text: string }
export interface SourceRow { id: string; name: string; kind: string; config: Record<string, unknown>; mapping: Mapping | null; schedule: string | null; last_sync_at: string | null; health: Health }
export interface Proposal { site: string; kind: string; config: Record<string, unknown>; mapping: Mapping; confidence: number; fields: Record<string, number>; sample: Article[]; notes: string[]; errors: { ref: unknown; reasons: string[] }[] }
export interface TestResult { ok: boolean; count: number; articles: Article[]; errors: { ref: unknown; reasons: string[] }[] }
export interface ArticleRow { id: string; headline: string; section: string; priority: number; url: string; lang: string; source_id: string; published_at: string; hidden: boolean; data: Partial<Article> & Record<string, unknown> }
export interface EditionRow { id: string; name: string; date: string; status: string; rev: number }
export interface PageRow { id: string; no: number; fit_pct: number | null; status: string }
export interface ExportRow { id: string; format: string; status: string; url: string | null }
export interface Overview { id: string; date: string; name: string; status: string; pages: PageRow[]; exports: ExportRow[]; reader: { id: string; status: string; version: number; publish_at: string | null } | null }
export interface PaperView { id: string; slug: string; name: string; lang: string; script: string; page_w_mm: number; page_h_mm: number; tz: string; domain: string | null; ai: { configured: boolean; enabled: boolean; switch: boolean; reason: string | null } }
export interface Member { user_id: string; role: Role; name: string; email: string; you: boolean }
export interface KeyRow { id: string; source_id: string | null; label: string; last_used_at: string | null; created_at: string }
export interface HookRow { id: string; url: string; events: string[]; active: boolean }
export interface DeliveryRow { id: string; event: string; status: string; attempts: number; last_error: string | null }
export interface AuditRow { id: string; at: string; who: string; action: string; entity: string; entity_id: string | null }
