import { useState } from "react";
import type { ScreenProps } from "../App";
import type { ArticleRow } from "../types";
import { caps } from "../lib/roles";
import { FlashBar, useAction, useConfirm, useLoad } from "../ui";

function Detail({ a, api, can, onChanged }: { a: ArticleRow; api: ScreenProps["api"]; can: boolean; onChanged: () => void }) {
  const [priority, setPriority] = useState(a.priority);
  const [section, setSection] = useState(a.section);
  const { flash, busy, run } = useAction();
  const { ask, node } = useConfirm();
  const d = a.data as { subhead?: string; byline?: string; body?: { text?: string }[] };
  return (
    <div className="card inner" data-testid="article-detail">
      {d.subhead && <p><em>{d.subhead}</em></p>}
      {d.byline && <p className="muted">By {d.byline}</p>}
      <p>{(d.body ?? []).slice(0, 3).map((b) => b.text).join(" ").slice(0, 600) || "No text."}</p>
      <p><a href={a.url} target="_blank" rel="noreferrer">Open the original story</a></p>
      {can && (
        <>
          <div className="row wrap">
            <label>Priority (0 to 100, higher goes on the front page first)<input type="number" min={0} max={100} value={priority} onChange={(e) => setPriority(Number(e.target.value))} /></label>
            <label>Section<input value={section} onChange={(e) => setSection(e.target.value)} /></label>
          </div>
          <FlashBar flash={flash} />
          <div className="row wrap">
            <button className="primary" disabled={busy} onClick={async () => { if (await run(() => api.patchArticle(a.id, { priority, section: section.trim() || a.section }), "Saved.")) onChanged(); }}>Save</button>
            {!a.hidden ? (
              <button className="danger" disabled={busy} onClick={async () => { if (await ask("Hide this story? It will not be used when pages are planned. You can bring it back.", "Hide it")) { if (await run(() => api.hideArticle(a.id, true), "Hidden.")) onChanged(); } }}>Hide</button>
            ) : (
              <button disabled={busy} onClick={async () => { if (await run(() => api.hideArticle(a.id, false), "Brought back.")) onChanged(); }}>Bring back</button>
            )}
          </div>
        </>
      )}
      {node}
    </div>
  );
}

export function Articles({ api, me }: ScreenProps) {
  const can = caps(me.role).editArticles;
  const [q, setQ] = useState("");
  const [section, setSection] = useState("");
  const [hidden, setHidden] = useState("no");
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, reload } = useLoad(() => api.articles({ q: q.trim(), section, hidden }), [q, section, hidden]);
  const sections = [...new Set((data?.items ?? []).map((a) => a.section))].sort();
  return (
    <>
      <div className="head"><h2>Articles</h2></div>
      <div className="row wrap filters">
        <label className="grow">Search headlines<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="for example: flood" /></label>
        <label>Section<select value={section} onChange={(e) => setSection(e.target.value)}><option value="">All</option>{[...new Set([section, ...sections].filter(Boolean))].map((s) => <option key={s}>{s}</option>)}</select></label>
        <label>Show<select value={hidden} onChange={(e) => setHidden(e.target.value)}><option value="no">Stories in use</option><option value="yes">Hidden stories</option><option value="all">Everything</option></select></label>
      </div>
      {error && <div className="flash bad" role="alert">{error}</div>}
      {data && data.items.length === 0 && <p className="muted">No stories match. Try a different search, or add a source and sync it.</p>}
      <ul className="list">
        {data?.items.map((a) => (
          <li key={a.id} className="card" data-testid="article">
            <button className="rowbtn" aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)}>
              <strong>{a.headline}</strong>
              <span className="muted">{a.section} · priority {a.priority}{a.hidden ? " · hidden" : ""}</span>
            </button>
            {open === a.id && <Detail a={a} api={api} can={can} onChanged={reload} />}
          </li>
        ))}
      </ul>
    </>
  );
}
