import { useState } from "react";
import type { Api } from "./api";
import type { Me } from "./types";
import { plainError } from "./lib/words";

const LANGS: Record<string, string> = { en: "English", ta: "Tamil", hi: "Hindi" };
export const langName = (l: string) => LANGS[l] ?? l;

/** Shown only when the person belongs to more than one paper. A plain select: keyboard and phone friendly. */
export function PaperSwitcher({ api, me, onSwitched }: { api: Api; me: Me; onSwitched: (m: Me) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const papers = me.papers ?? [];
  if (papers.length < 2) return null;
  const cur = papers.find((p) => p.current) ?? papers[0]!;
  const change = async (slug: string) => {
    if (slug === cur.slug) return;
    setBusy(true); setErr("");
    try {
      await api.switchPaper(slug);
      onSwitched(await api.me()); // everything below re-mounts for the new paper
    } catch (e) { setErr(plainError(e)); } finally { setBusy(false); }
  };
  return (
    <span className="switcher">
      <label>
        <span className="sr">Switch paper</span>
        <select aria-label="Switch paper" value={cur.slug} disabled={busy} onChange={(e) => void change(e.target.value)}>
          {[...papers].sort((a, b) => a.name.localeCompare(b.name)).map((p) => <option key={p.slug} value={p.slug}>{p.name} ({langName(p.lang)})</option>)}
        </select>
      </label>
      {err && <span role="alert" className="bad">{err}</span>}
    </span>
  );
}
