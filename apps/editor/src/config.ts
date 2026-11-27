export interface EditorConfig {
  /** Base URL of the API. "" means same origin (production: the api serves the editor at / on 127.0.0.1:8100). */
  apiBase: string;
  /** Dev/test only: which fake user the mock API should treat us as. */
  mockUser?: string;
  edition?: string;
  /** First editor zoom (default 0.5). Used by tests that must look at the page at an exact zoom. */
  zoom?: number;
  /** Where the ops desk lives (for the alert bell). Normally worked out from this page's address. */
  opsUrl?: string;
  autosaveMs: number;
  heartbeatMs: number;
  lockPollMs: number;
  livePollMs: number;
  retryMs: number;
}
declare global {
  interface Window {
    __EPAPER_CONFIG__?: Partial<EditorConfig>;
  }
}
export function loadConfig(): EditorConfig {
  const w = typeof window === "undefined" ? undefined : window;
  const q = w ? new URLSearchParams(w.location.search) : new URLSearchParams();
  const injected = w?.__EPAPER_CONFIG__ ?? {};
  const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};
  return {
    apiBase: (injected.apiBase ?? env.VITE_API_BASE ?? "").replace(/\/$/, ""),
    mockUser: injected.mockUser ?? q.get("as") ?? undefined,
    edition: injected.edition ?? q.get("edition") ?? env.VITE_EDITION ?? undefined,
    zoom: injected.zoom ?? (q.get("zoom") ? Number(q.get("zoom")) : undefined),
    opsUrl: injected.opsUrl ?? q.get("ops") ?? undefined,
    autosaveMs: injected.autosaveMs ?? 2000, // spec: 2 s debounce
    heartbeatMs: injected.heartbeatMs ?? 120_000, // spec: 2 min heartbeat
    lockPollMs: injected.lockPollMs ?? 15_000,
    /** Poll for other people's changes this often while the live stream is not working (spec: 15 s). */
    livePollMs: injected.livePollMs ?? 15_000,
    retryMs: injected.retryMs ?? 5000,
  };
}

/** Where the page fonts come from: the API's /fonts route (same files the server renders with). */
export const fontBase = (): string => `${loadConfig().apiBase}/fonts`;
