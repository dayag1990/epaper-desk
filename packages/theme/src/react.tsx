import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { BELL_SVG } from "./html.js";
import { AlertFeed, browserStorage, connectAlerts, type AlertEvent, type FeedSnapshot } from "./live.js";
import { APP_NAMES, APP_ORDER, resolveLinks, type AppId, type AppLinks } from "./links.js";
import { LOGO_PATHS } from "./logo.js";

/* The React version of the shared top bar and toasts. The ops desk uses the HTML-string twin (html.ts): same markup, same classes. */

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg className="ep-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width={size} height={size} role="img" aria-label="E-Paper Desk" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round">
      <path d={LOGO_PATHS.page} /><path d={LOGO_PATHS.lines} /><path d="M21 3v6h6" />
    </svg>
  );
}

declare global { interface Window { __EPAPER_LINKS__?: Partial<AppLinks> } }
/** Where the other apps are. Reads window.__EPAPER_LINKS__ (set by tests or a deployment) on top of the standard places. */
export function useAppLinks(): AppLinks {
  return useMemo(() => resolveLinks(location, window.__EPAPER_LINKS__), []);
}

const useFeed = (feed: AlertFeed | null): FeedSnapshot => {
  const empty = useMemo(() => new AlertFeed(), []);
  const f = feed ?? empty;
  return useSyncExternalStore(f.subscribe, f.getSnapshot, f.getSnapshot);
};

/** Owners get the alert stream from the ops desk (signed in by the shared cookie). Returns the feed, or null for everyone else. */
export function useAlertFeed(opsBase: string | null | undefined, enabled: boolean): AlertFeed | null {
  const feed = useMemo(() => (enabled && opsBase ? new AlertFeed({ storage: browserStorage(), autoDismissMs: 10_000 }) : null), [enabled, opsBase]);
  useEffect(() => {
    if (!feed || !opsBase) return;
    const s = connectAlerts({ base: opsBase, feed, withCredentials: true });
    return () => s.close();
  }, [feed, opsBase]);
  return feed;
}

export interface TopBarProps {
  app: AppId;
  user?: { name: string; email?: string } | null;
  /** Owners only: shows the Ops desk link and the alert bell. */
  isOwner?: boolean;
  /** Paper name and the paper switcher (each app has its own, it just goes here). */
  children?: React.ReactNode;
  onSignOut?: () => void | Promise<void>;
  feed?: AlertFeed | null;
  links?: AppLinks;
}

export function TopBar({ app, user, isOwner, children, onSignOut, feed, links: given }: TopBarProps) {
  const auto = useAppLinks();
  const links = given ?? auto;
  const [open, setOpen] = useState(false);
  const snap = useFeed(feed ?? null);
  const apps = APP_ORDER.filter((a) => a !== "ops" || isOwner);
  return (
    <>
      <header className="ep-top" data-testid="topbar">
        <a className="ep-brand" href={links[app]} data-testid="brand"><Logo /><span className="ep-word">E-Paper Desk</span></a>
        {children && <span className="ep-slot">{children}</span>}
        <ul className="ep-links" aria-label="Apps">
          {apps.map((a) => <li key={a}><a href={links[a]} aria-current={a === app ? "page" : undefined} data-testid={`link-${a}`}>{APP_NAMES[a]}</a></li>)}
        </ul>
        <span className="ep-grow" />
        {isOwner && feed && (
          <div className="ep-bell">
            <button type="button" aria-haspopup="true" aria-expanded={open} aria-label={snap.unread ? `Alerts, ${snap.unread} unread` : "Alerts"} data-testid="bell" onClick={() => setOpen(!open)}>
              <span dangerouslySetInnerHTML={{ __html: BELL_SVG }} />
              {snap.unread > 0 && <span className="ep-count" data-testid="bell-count">{snap.unread}</span>}
            </button>
            {open && (
              <div className="ep-menu" role="region" aria-label="Recent alerts" data-testid="bell-menu">
                <h3>Alerts</h3>
                {snap.items.length === 0 ? <p className="none">Nothing has gone wrong lately.</p> : (
                  <ul>{snap.items.slice(0, 12).map((a: AlertEvent) => <li key={a.id} className={a.kind}><b>{a.title}</b><span>{a.text}</span><small>{new Date(a.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></li>)}</ul>
                )}
                <footer>
                  <a className="ep-btn" href={`${links.ops}alerts`}>Open in ops desk</a>
                  <button className="ep-btn quiet" type="button" onClick={() => feed.markAllRead()}>Mark all as read</button>
                </footer>
              </div>
            )}
          </div>
        )}
        {user && (
          <span className="ep-user">
            <b title={user.email ?? user.name} data-testid="who">{user.name}</b>
            {onSignOut && <button className="ep-btn quiet" type="button" data-testid="sign-out" onClick={() => void onSignOut()}>Sign out</button>}
          </span>
        )}
      </header>
      <ToastHost feed={feed ?? null} links={links} />
    </>
  );
}

/** The red-edged slide-in notes for alerts. "Open in ops desk" goes to the fix page. */
export function ToastHost({ feed, links }: { feed: AlertFeed | null; links?: AppLinks }) {
  const snap = useFeed(feed);
  const auto = useAppLinks();
  const ops = (links ?? auto).ops;
  return (
    <div className="ep-toasts" role="region" aria-label="Alerts" aria-live="polite" data-testid="toasts">
      {snap.toasts.map((t) => (
        <div key={t.id} className={`ep-toast ${t.tone}`} role={t.tone === "alert" ? "alert" : "status"} data-testid="alert-toast">
          {t.title && <b>{t.title}</b>}
          <p>{t.text}</p>
          <div className="ep-row">
            <a className="ep-btn" href={t.href ?? ops}>{t.hrefLabel ?? "Open in ops desk"}</a>
            <button className="ep-btn quiet" type="button" onClick={() => feed?.dismiss(t.id)}>Dismiss</button>
          </div>
        </div>
      ))}
    </div>
  );
}
