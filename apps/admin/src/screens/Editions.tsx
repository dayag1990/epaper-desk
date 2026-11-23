import { useState } from "react";
import type { ScreenProps } from "../App";
import type { Overview } from "../types";
import { caps } from "../lib/roles";
import { checkDate, EDITION_WORDS, EXPORT_WORDS, FORMAT_WORDS, fillTone, fillWords, isBusy, nextStep, PAGE_WORDS, READER_WORDS, tomorrow } from "../lib/words";
import { FlashBar, useAction, useConfirm, useLoad } from "../ui";

function Detail({ api, id, me }: Pick<ScreenProps, "api" | "me"> & { id: string }) {
  const c = caps(me.role);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [at, setAt] = useState("");
  const { error, reload } = useLoad(async () => { const o = await api.overview(id); setOverview(o); return o; }, [id], isBusy(overview));
  const { flash, busy, run } = useAction();
  const { ask, node } = useConfirm();
  const o = overview?.id === id ? overview : null;
  if (!o) return <p className="muted">{error ?? "Loading…"}</p>;
  const pdf = o.exports.find((e) => e.format === "pdf_screen");
  const cxml = o.exports.find((e) => e.format === "cxml");
  const idml = o.exports.find((e) => e.format === "idml");
  const approved = o.pages.length > 0 && o.pages.every((p) => p.status === "approved");
  const act = (fn: () => Promise<unknown>, ok: string) => async () => { if (await run(fn, ok)) reload(); };
  return (
    <section className="card" aria-label="Edition" data-testid="edition-detail">
      <div className="row between wrap"><h3>{o.date}{o.name ? ` · ${o.name}` : ""}</h3><span className="pill" data-testid="edition-status">{EDITION_WORDS[o.status] ?? o.status}</span></div>
      <p className="next" data-testid="next-step">{nextStep(o)}</p>
      <FlashBar flash={flash} />
      {c.workEditions && <div className="row wrap"><button className="primary" disabled={busy || o.status === "planning"} onClick={act(() => api.autoplan(id), "Planning started.")}>{o.pages.length ? "Plan again" : "Auto-plan"}</button></div>}
      {o.pages.length > 0 && (
        <ul className="pages">
          {o.pages.map((p) => (
            <li key={p.id} data-testid="page" className={`page ${fillTone(p.fit_pct)}`}>
              <strong>Page {p.no}</strong>
              <span>{fillWords(p.fit_pct)}</span>
              <span className="bar"><i style={{ width: `${Math.min(100, p.fit_pct ?? 0)}%` }} /></span>
              <span className="pill">{PAGE_WORDS[p.status] ?? p.status}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="row wrap">
        {o.pages.length > 0 && <a className="btn" href={`/?edition=${o.id}`}>Open in the editor</a>}
        {c.workEditions && o.pages.length > 0 && !approved && <button disabled={busy} onClick={async () => { if (await ask("Approve every page that is not approved yet? Approved pages are locked until someone reopens them.", "Approve all")) await act(() => api.approveAll(id), "Pages approved.")(); }}>Approve all pages</button>}
      </div>

      {c.workEditions && o.pages.length > 0 && (
        <>
          <h4>Export</h4>
          <div className="row wrap">
            <button disabled={busy} onClick={act(() => api.exportEdition(id, "pdf_screen"), "Making the PDF.")}>Make PDF</button>
            <button disabled={busy} onClick={act(() => api.exportEdition(id, "cxml"), "Making ContentXML.")}>Make ContentXML</button>
            <button disabled={busy} title="A zip with the .idml file and its Links folder, for InDesign" onClick={act(() => api.exportEdition(id, "idml"), "Making the InDesign file.")}>Make InDesign file (IDML)</button>
          </div>
        </>
      )}
      {o.exports.length > 0 && (
        <ul className="plain">
          {[pdf, cxml, idml].filter(Boolean).map((e) => <li key={e!.id} data-testid="export">{FORMAT_WORDS[e!.format] ?? e!.format}: {EXPORT_WORDS[e!.status] ?? e!.status} {e!.url && <a href={e!.url} download>Download</a>}</li>)}
        </ul>
      )}

      <h4>Readers</h4>
      <p data-testid="reader-status">{o.reader ? `${READER_WORDS[o.reader.status] ?? o.reader.status}${o.reader.version > 1 ? ` · version ${o.reader.version}` : ""}` : "No reader copy yet. Making the PDF builds it."}</p>
      {c.publish && o.reader && (o.reader.status === "ready" || o.reader.status === "published" || o.reader.status === "scheduled") && (
        <div className="row wrap">
          {o.reader.status !== "published" && (
            <>
              <label>Go live at (leave empty for now)<input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></label>
              <button className="primary" disabled={busy} onClick={async () => { if (await ask(at ? "Schedule this edition to go live at the time you chose?" : "Publish to readers now? Anyone with the link can read it.", at ? "Schedule it" : "Publish now")) await act(() => api.publish(o.reader!.id, at ? new Date(at).toISOString() : undefined), at ? "Scheduled." : "Published. Readers can see it now.")(); }}>{at ? "Schedule" : "Publish to readers"}</button>
            </>
          )}
          <button className="danger" disabled={busy} onClick={async () => { if (await ask("Roll back? The newest page fix is undone. If there is none, the edition goes back to not published.", "Roll back")) await act(() => api.rollback(o.reader!.id), "Rolled back.")(); }}>Roll back</button>
        </div>
      )}
      {node}
    </section>
  );
}

export function Editions({ api, me }: ScreenProps) {
  const c = caps(me.role);
  const { data, error, reload } = useLoad(() => api.editions(), []);
  const [date, setDate] = useState(tomorrow());
  const [sel, setSel] = useState<string | null>(null);
  const { flash, busy, run } = useAction();
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const bad = checkDate(date);
    if (bad) return void run(async () => { throw new Error(bad); });
    const r = await run(() => api.createEdition(date), (x) => (x.existed ? "That date already has an edition. Opened it." : "Edition created."));
    if (r) { setSel(r.id); reload(); }
  };
  return (
    <>
      <div className="head"><h2>Editions</h2></div>
      {c.workEditions && (
        <form className="row wrap card" onSubmit={create} aria-label="New edition">
          <label>Date of the edition<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
          <button className="primary" disabled={busy}>Create edition</button>
        </form>
      )}
      <FlashBar flash={flash} />
      {error && <div className="flash bad" role="alert">{error}</div>}
      {data && data.items.length === 0 && <p className="muted">No editions yet.{c.workEditions ? " Pick a date and press Create edition." : ""}</p>}
      <ul className="list">
        {data?.items.map((e) => (
          <li key={e.id} data-testid="edition-row">
            <button className={`rowbtn card ${sel === e.id ? "sel" : ""}`} aria-expanded={sel === e.id} onClick={() => setSel(sel === e.id ? null : e.id)}>
              <strong>{e.date}{e.name ? ` · ${e.name}` : ""}</strong><span className="muted">{EDITION_WORDS[e.status] ?? e.status}</span>
            </button>
            {sel === e.id && <Detail api={api} id={e.id} me={me} />}
          </li>
        ))}
      </ul>
    </>
  );
}
