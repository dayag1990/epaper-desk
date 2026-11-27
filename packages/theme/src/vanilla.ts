import { AlertFeed, browserStorage, connectAlerts, type AlertEvent, type FeedSnapshot } from "./live.js";

/**
 * Bell and toasts for server-rendered pages (the ops desk). Finds #ep-bell-btn, #ep-bell-count, #ep-bell-menu and
 * #ep-toasts (written by topBarHtml) and keeps them in step with one AlertFeed.
 */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const when = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function mountAlerts(o: { base: string; opsHref: string; withCredentials?: boolean }): AlertFeed {
  const feed = new AlertFeed({ storage: browserStorage(), autoDismissMs: 10_000 });
  const btn = document.getElementById("ep-bell-btn"), count = document.getElementById("ep-bell-count"), menu = document.getElementById("ep-bell-menu"), host = document.getElementById("ep-toasts");
  const render = (s: FeedSnapshot) => {
    if (count) { count.textContent = String(s.unread); count.hidden = s.unread === 0; }
    if (menu) {
      menu.innerHTML = `<h3>Alerts</h3>${s.items.length ? `<ul>${s.items.slice(0, 12).map((a: AlertEvent) => `<li class="${a.kind}"><b>${esc(a.title)}</b><span>${esc(a.text)}</span><small>${esc(when(a.at))}</small></li>`).join("")}</ul>` : `<p class="none">Nothing has gone wrong lately.</p>`}<footer><a class="ep-btn" href="${esc(o.opsHref)}alerts">Open in ops desk</a><button class="ep-btn quiet" type="button" data-read>Mark all as read</button></footer>`;
    }
    if (host) {
      const have = new Set(Array.from(host.children).map((c) => (c as HTMLElement).dataset.id));
      for (const t of s.toasts) if (!have.has(t.id)) {
        const el = document.createElement("div");
        el.className = `ep-toast ${t.tone}`; el.dataset.id = t.id; el.setAttribute("role", t.tone === "alert" ? "alert" : "status");
        el.innerHTML = `<b>${esc(t.title ?? "")}</b><p>${esc(t.text)}</p><div class="ep-row">${t.href ? `<a class="ep-btn" href="${esc(t.href)}">${esc(t.hrefLabel ?? "Open in ops desk")}</a>` : ""}<button class="ep-btn quiet" type="button" data-dismiss>Dismiss</button></div>`;
        host.appendChild(el);
      }
      const live = new Set(s.toasts.map((t) => t.id));
      Array.from(host.children).forEach((c) => { if (!live.has((c as HTMLElement).dataset.id!)) c.remove(); });
    }
  };
  feed.subscribe(() => render(feed.getSnapshot()));
  render(feed.getSnapshot());
  btn?.addEventListener("click", () => { if (!menu) return; const open = menu.hidden; menu.hidden = !open; btn.setAttribute("aria-expanded", String(open)); });
  menu?.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest("[data-read]")) feed.markAllRead(); });
  host?.addEventListener("click", (e) => { const t = (e.target as HTMLElement).closest("[data-dismiss]"); if (t) feed.dismiss((t.closest(".ep-toast") as HTMLElement).dataset.id!); });
  connectAlerts({ base: o.base, feed, withCredentials: o.withCredentials ?? false });
  return feed;
}
