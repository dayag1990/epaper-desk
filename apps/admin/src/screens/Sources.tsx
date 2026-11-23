import { useState } from "react";
import type { Article } from "@epaper/core";
import type { ScreenProps } from "../App";
import type { Proposal, SourceRow, TestResult } from "../types";
import { caps } from "../lib/roles";
import { confidenceWords, FIELD_WORDS, mappingToRows, rowsToMapping } from "../lib/words";
import { FlashBar, Secret, useAction, useConfirm, useLoad } from "../ui";

const Samples = ({ items, title }: { items: Article[]; title: string }) => (
  <div className="samples" data-testid="samples">
    <h4>{title}</h4>
    {items.length === 0 ? <p className="muted">No stories came through.</p> : (
      <ol>{items.slice(0, 5).map((a) => <li key={a.id}><strong>{a.headline}</strong><span className="muted"> {a.section ? `· ${a.section}` : ""}</span><br /><span className="muted">{(a.body?.[0] as { text?: string } | undefined)?.text?.slice(0, 120) ?? ""}</span></li>)}</ol>
    )}
  </div>
);

function Wizard({ api, onSaved, onCancel }: Pick<ScreenProps, "api"> & { onSaved: () => void; onCancel: () => void }) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [prop, setProp] = useState<Proposal | null>(null);
  const { flash, busy, run } = useAction();
  const find = (e: React.FormEvent) => { e.preventDefault(); void run(async () => { const p = await api.wizard(url.trim()); setProp(p); if (!name) setName(new URL(p.site.startsWith("http") ? p.site : `https://${p.site}`).hostname); }); };
  const save = async () => {
    if (!prop) return;
    const r = await run(() => api.createSource({ kind: prop.kind, name: name.trim() || prop.site, config: prop.config, mapping: prop.mapping, schedule: "*/30 * * * *" }), "Saved. Press \"Sync now\" to fetch the stories.");
    if (r) onSaved();
  };
  const c = prop ? confidenceWords(prop.confidence) : null;
  return (
    <section className="card" aria-label="Add a source">
      <h2>Add a source</h2>
      <form onSubmit={find} className="row wrap">
        <label className="grow">Website address<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://newspaper.example" required inputMode="url" /></label>
        <button className="primary" disabled={busy}>{busy && !prop ? "Looking…" : "Find the stories"}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </form>
      <FlashBar flash={flash} />
      {prop && c && (
        <div data-testid="proposal">
          <h3>What we found</h3>
          <p className={`conf ${c.tone}`} data-testid="confidence">{c.label}</p>
          <p className="muted">Kind: {prop.kind === "wordpress" ? "WordPress site" : prop.kind === "rss" ? "News feed" : "Web pages"}</p>
          <ul className="fields">{Object.entries(prop.fields).map(([f, v]) => <li key={f}>{FIELD_WORDS[f] ?? f}: {Math.round(v * 100)}% of the sample had it</li>)}</ul>
          {prop.notes.map((n, i) => <p key={i} className="muted">{n}</p>)}
          <Samples items={prop.sample} title="Test: the first stories this would bring in (nothing is saved yet)" />
          <label>Name for this source<input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <div className="row"><button className="primary" onClick={save} disabled={busy}>Save this source</button><button onClick={() => setProp(null)}>Try another address</button></div>
        </div>
      )}
    </section>
  );
}

function EditMapping({ api, s, onDone }: Pick<ScreenProps, "api"> & { s: SourceRow; onDone: () => void }) {
  const [name, setName] = useState(s.name);
  const [rows, setRows] = useState(mappingToRows(s.mapping));
  const [test, setTest] = useState<TestResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { flash, busy, run } = useAction();
  const save = async () => {
    const { mapping, error } = rowsToMapping(rows);
    setErr(error);
    if (error) return;
    const r = await run(() => api.editSource(s.id, { name: name.trim() || s.name, mapping }), "Saved.");
    if (r) onDone();
  };
  return (
    <div className="card inner" aria-label={`Edit ${s.name}`}>
      <label>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <h4>How to read each part of a story</h4>
      {rows.map((r, i) => (
        <div className="row" key={i}>
          <input aria-label={`Field ${i + 1}`} value={r.field} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))} placeholder="field" />
          <input className="grow mono" aria-label={`Rule for ${r.field || "field " + (i + 1)}`} value={r.expr} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, expr: e.target.value } : x)))} placeholder="rule" />
          <button aria-label={`Remove rule ${r.field}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button onClick={() => setRows([...rows, { field: "", expr: "" }])}>Add a rule</button>
      {err && <div className="flash bad" role="alert">{err}</div>}
      <FlashBar flash={flash} />
      {test && <Samples items={test.articles} title={test.ok ? "Test: first 5 stories with the saved rules" : "Test finished with problems"} />}
      {test && test.errors.length > 0 && <p className="flash bad">{test.errors.length} stor{test.errors.length === 1 ? "y" : "ies"} could not be read: {test.errors[0]!.reasons[0]}</p>}
      <div className="row wrap">
        <button className="primary" onClick={save} disabled={busy}>Save</button>
        <button onClick={() => run(async () => setTest(await api.testSource(s.id)))} disabled={busy}>Test with 5 stories (saved rules)</button>
        <button onClick={onDone}>Close</button>
      </div>
    </div>
  );
}

export function Sources({ api, me }: ScreenProps) {
  const c = caps(me.role);
  const { data, error, reload } = useLoad(() => api.sources(), []);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const { flash, busy, run } = useAction();
  const { ask, node } = useConfirm();
  return (
    <>
      <div className="head"><h2>Sources</h2>{c.manageSources && !adding && <button className="primary" onClick={() => setAdding(true)}>Add a source</button>}</div>
      {error && <div className="flash bad" role="alert">{error}</div>}
      <FlashBar flash={flash} />
      {secret && <Secret title="New key" value={secret} onDone={() => setSecret(null)} />}
      {adding && <Wizard api={api} onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
      {data && data.items.length === 0 && !adding && <p className="muted">No sources yet. {c.manageSources ? "Add one with the button above: paste a website address and we do the rest." : "An editor or owner can add one."}</p>}
      <ul className="list">
        {data?.items.map((s) => (
          <li key={s.id} className="card" data-testid="source">
            <div className="row between wrap"><strong>{s.name}</strong><span className="muted">{s.kind === "wordpress" ? "WordPress" : s.kind === "rss" ? "Feed" : s.kind === "scrape" ? "Web pages" : s.kind}</span></div>
            <p className={`health ${s.health.state}`}>{s.health.text}</p>
            {c.manageSources && (
              <div className="row wrap">
                <button disabled={busy} onClick={async () => { if (await run(() => api.syncSource(s.id), "Fetching started. Check back in a minute.")) reload(); }}>Sync now</button>
                <button onClick={() => setEditing(editing === s.id ? null : s.id)}>Edit rules</button>
                {c.admin && <button disabled={busy} onClick={async () => { const r = await run(() => api.createKey(s.id)); if (r) setSecret(r.key); }}>New push key</button>}
                <button className="danger" disabled={busy} onClick={async () => { if (await ask(`Remove "${s.name}"? Its stories stay, but nothing new will be fetched.`, "Remove source")) { if (await run(() => api.deleteSource(s.id), "Removed.")) reload(); } }}>Remove</button>
              </div>
            )}
            {editing === s.id && <EditMapping api={api} s={s} onDone={() => { setEditing(null); reload(); }} />}
          </li>
        ))}
      </ul>
      {node}
    </>
  );
}
