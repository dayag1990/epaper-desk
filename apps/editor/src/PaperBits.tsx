import { useEffect, useState } from "react";
import type { Api } from "./api";
import { ApiError, plainError } from "./errors";
import type { EditionListItem, Me } from "./types";

const LANGS: Record<string, string> = { en: "English", ta: "Tamil", hi: "Hindi" };
const langName = (l: string) => LANGS[l] ?? l;
const here = () => location.pathname;

/** Words for a failed switch: the server's own plain sentence when it refused, else the usual plain error. */
export const switchError = (e: unknown) => (e instanceof ApiError && e.status === 403 ? e.message : plainError(e, "switch paper"));

/** Leave the old paper's edition behind: back to the edition list of whichever paper the session is in now. */
export const goToEditionList = () => location.assign(here());

/**
 * A compact select, shown only when the person belongs to two or more papers. `onPick` does the work (it may ask first);
 * the select shows the current paper again if the switch does not happen.
 */
export function PaperSwitcher({ me, onPick, busy, error }: { me: Me | null; onPick: (slug: string) => void; busy?: boolean; error?: string | null }) {
  const papers = me?.papers ?? [];
  if (papers.length < 2) return null;
  const cur = papers.find((p) => p.current) ?? papers[0]!;
  return (
    <span className="switcher">
      <select aria-label="Switch paper" data-testid="paper-switch" value={cur.slug} disabled={busy} onChange={(e) => onPick(e.target.value)}>
        {[...papers].sort((a, b) => a.name.localeCompare(b.name)).map((p) => <option key={p.slug} value={p.slug}>{p.name} ({langName(p.lang)})</option>)}
      </select>
      {error && <span className="err" role="alert" data-testid="switch-error">{error}</span>}
    </span>
  );
}

/** The editions of the paper the session is in. Opens with no ?edition=, and after a paper switch. */
export function EditionPicker({ api }: { api: Api }) {
  const [me, setMe] = useState<Me | null>(null);
  const [items, setItems] = useState<EditionListItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [swErr, setSwErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.me().then(setMe, () => undefined);
    api.editions().then(setItems, (e) => setErr(plainError(e, "list the editions")));
  }, [api]);
  const pick = async (slug: string) => {
    setBusy(true); setSwErr(null);
    try { await api.switchPaper(slug); goToEditionList(); } catch (e) { setSwErr(switchError(e)); setBusy(false); }
  };
  const cur = me?.papers?.find((p) => p.current);
  return (
    <div className="picker">
      <header className="top">
        <div className="title" data-testid="picker-paper">{cur ? cur.name : ""}</div>
        <div className="spacer" />
        <PaperSwitcher me={me} onPick={(s) => void pick(s)} busy={busy} error={swErr} />
      </header>
      <main className="center">
        <h1>Editions</h1>
        {err && <p className="err" role="alert">{err}</p>}
        {!items && !err && <p role="status">Loading…</p>}
        {items && items.length === 0 && <p>There are no editions yet. Make one in the desk console.</p>}
        <ul className="list" data-testid="edition-list">
          {items?.map((e) => <li key={e.id}><span>{e.name || "Edition"} · {e.date}</span><a className="btn" href={`?edition=${encodeURIComponent(e.id)}`}>Open</a></li>)}
        </ul>
      </main>
    </div>
  );
}
