// Small pure helpers for the admin routes. No database here, so they are easy to test.

/** True when an AI key is present in the server's environment. The key itself is never returned. */
export const aiKeyPresent = (env: NodeJS.ProcessEnv = process.env): boolean => !!(env.ANTHROPIC_API_KEY ?? "").trim();

export type Health = { state: "ok" | "error" | "syncing" | "never" | "idle"; text: string };

/** The worker stores a sync result as "ok: 3 new, ..." or "error: reason". Say it in plain words. */
export function plainSourceStatus(status: string, last_sync_at: Date | string | null | undefined): Health {
  const s = (status ?? "").trim();
  if (s === "syncing") return { state: "syncing", text: "Fetching new stories now." };
  if (s.startsWith("error:")) return { state: "error", text: `The last fetch failed: ${s.slice(6).trim() || "unknown reason"}. Press "Sync now" to try again.` };
  if (s.startsWith("ok:")) {
    const when = last_sync_at ? ` (${new Date(last_sync_at).toISOString().slice(0, 16).replace("T", " ")} UTC)` : "";
    return { state: "ok", text: `Working. Last fetch: ${s.slice(3).trim()}${when}.` };
  }
  if (!last_sync_at) return { state: "never", text: "Nothing fetched yet. Press \"Sync now\"." };
  return { state: "idle", text: "Waiting for the next fetch." };
}

export const ROLES = ["owner", "editor", "sub", "designer", "viewer"] as const;
