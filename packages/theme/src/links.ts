/** Where the four apps live, so each one can link to the others. */
export type AppId = "editor" | "admin" | "reader" | "ops";
export type AppLinks = Record<AppId, string>;

export const APP_NAMES: Record<AppId, string> = { editor: "Editor", admin: "Admin", reader: "Reader", ops: "Ops desk" };
export const APP_ORDER: AppId[] = ["editor", "admin", "reader", "ops"];

export interface LocLike { protocol: string; hostname: string; port: string }

/**
 * Same host, the standard ports (editor and admin 8100, ops desk 8101, reader 8102), or on a real domain the
 * app. / ops. / epaper. names swapped in. Anything can be forced through `override` (window.__EPAPER_LINKS__ or a build setting).
 */
export function resolveLinks(loc: LocLike, override: Partial<AppLinks> = {}): AppLinks {
  const { protocol, hostname } = loc;
  const plainHost = /^(\d+\.\d+\.\d+\.\d+|localhost|\[.*\])$/.test(hostname);
  let base: AppLinks;
  if (plainHost) {
    base = { editor: `${protocol}//${hostname}:8100/`, admin: `${protocol}//${hostname}:8100/admin/`, reader: `${protocol}//${hostname}:8102/`, ops: `${protocol}//${hostname}:8101/` };
  } else {
    const m = /^(app|ops|epaper)\.(.+)$/.exec(hostname);
    const root = m ? m[2]! : hostname;
    base = { editor: `${protocol}//app.${root}/`, admin: `${protocol}//app.${root}/admin/`, reader: `${protocol}//epaper.${root}/`, ops: `${protocol}//ops.${root}/` };
  }
  return { ...base, ...Object.fromEntries(Object.entries(override).filter(([, v]) => !!v)) } as AppLinks;
}

/** Origins the ops desk should accept for its alert stream (CORS), from the same rule. */
export const originOf = (url: string) => { try { return new URL(url).origin; } catch { return ""; } };
