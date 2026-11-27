import { APP_NAMES, APP_ORDER, type AppId, type AppLinks } from "./links.js";
import { logoSvg } from "./logo.js";

/** The HTML-string version of the shared top bar, for pages the server renders (the ops desk). Same markup and classes as the React one. */
export const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const BELL_SVG = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 8H4c0-1 2-2 2-8z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>`;

export interface TopBarHtmlOpts {
  /** The app this page belongs to (gets the red marker). */
  app: AppId;
  links: AppLinks;
  /** Signed-in person; omit on the login page. */
  user?: { name: string; email?: string } | null;
  /** Only owners see the ops desk link. The ops desk itself is only open to owners, so it passes true. */
  isOwner: boolean;
  /** Extra HTML after the logo (paper name, switcher). */
  slotHtml?: string;
  /** Where "Sign out" goes. */
  signOutHref?: string;
  /** Show the bell (owners only). */
  bell?: boolean;
  /** Ops desk pages stay on their own links (`/alerts` for the list). */
  alertsHref?: string;
}

export function topBarHtml(o: TopBarHtmlOpts): string {
  const apps = APP_ORDER.filter((a) => a !== "ops" || o.isOwner);
  const links = apps.map((a) => `<li><a href="${escHtml(o.links[a])}"${a === o.app ? ' aria-current="page"' : ""}>${APP_NAMES[a]}</a></li>`).join("");
  const user = o.user
    ? `<span class="ep-user"><b title="${escHtml(o.user.email ?? o.user.name)}">${escHtml(o.user.name)}</b>${o.signOutHref ? `<a class="ep-btn quiet" href="${escHtml(o.signOutHref)}">Sign out</a>` : ""}</span>`
    : "";
  const bell = o.bell
    ? `<div class="ep-bell" id="ep-bell"><button type="button" aria-haspopup="true" aria-expanded="false" aria-label="Alerts" id="ep-bell-btn">${BELL_SVG}<span class="ep-count" id="ep-bell-count" hidden>0</span></button><div class="ep-menu" id="ep-bell-menu" hidden role="region" aria-label="Recent alerts"></div></div>`
    : "";
  return `<header class="ep-top"><a class="ep-brand" href="${escHtml(o.links[o.app])}">${logoSvg(28)}<span class="ep-word">E-Paper Desk</span></a>${o.slotHtml ? `<span class="ep-slot">${o.slotHtml}</span>` : ""}<ul class="ep-links" aria-label="Apps">${links}</ul><span class="ep-grow"></span>${bell}${user}</header><div class="ep-toasts" id="ep-toasts" role="region" aria-label="Alerts" aria-live="polite"></div>`;
}
