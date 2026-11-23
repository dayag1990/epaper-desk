import type { Role } from "../types";

/** What each role may do. Mirrors the API's checks; the API still enforces them, this only hides what would be refused. */
export type Screen = "sources" | "articles" | "editions" | "people" | "connections" | "activity" | "settings";

const WRITE: Role[] = ["owner", "editor", "sub", "designer"];
export const caps = (r: Role) => ({
  manageSources: r === "owner" || r === "editor",
  editArticles: r === "owner" || r === "editor" || r === "sub",
  workEditions: WRITE.includes(r),
  publish: r === "owner" || r === "editor",
  admin: r === "owner",
});

export function screensFor(r: Role): Screen[] {
  const base: Screen[] = ["editions", "articles", "sources"];
  return r === "owner" ? [...base, "people", "connections", "activity", "settings"] : base;
}

export const SCREEN_NAMES: Record<Screen, string> = { sources: "Sources", articles: "Articles", editions: "Editions", people: "People", connections: "Connections", activity: "Activity", settings: "Settings" };
export const ROLE_WORDS: Record<Role, string> = {
  owner: "Owner: can do everything", editor: "Editor: sources, stories, pages, publishing", sub: "Sub-editor: stories and pages", designer: "Designer: pages", viewer: "Viewer: can look, not change",
};
export const parseScreen = (hash: string, role: Role): Screen => {
  const s = hash.replace(/^#\/?/, "").split("/")[0] as Screen;
  const ok = screensFor(role);
  return ok.includes(s) ? s : ok[0]!;
};
