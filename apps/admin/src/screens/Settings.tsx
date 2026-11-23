import { useEffect, useState } from "react";
import type { ScreenProps } from "../App";
import type { PaperView } from "../types";
import { FlashBar, useAction, useConfirm, useLoad } from "../ui";

export function Settings({ api }: ScreenProps) {
  const { data, error, reload } = useLoad(() => api.paper(), []);
  const [f, setF] = useState<PaperView | null>(null);
  const { flash, busy, run } = useAction();
  const { ask, node } = useConfirm();
  useEffect(() => { if (data) setF(data); }, [data]);
  if (!data || !f) return <p className="muted">{error ?? "Loading…"}</p>;
  const ai = data.ai;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await run(() => api.savePaper({ name: f.name, lang: f.lang, script: f.script, page_w_mm: Number(f.page_w_mm), page_h_mm: Number(f.page_h_mm), tz: f.tz, domain: f.domain || null }), "Saved.")) reload();
  };
  return (
    <>
      <div className="head"><h2>Settings</h2></div>
      <FlashBar flash={flash} />
      <section className="card" aria-label="AI help">
        <h3>AI help</h3>
        <p data-testid="ai-state">{!ai.configured ? "AI is not available: no key has been added to the server." : ai.enabled ? "AI help is on for this paper." : "AI help is off for this paper."}</p>
        {ai.reason && <p className="muted" data-testid="ai-reason">{ai.reason}</p>}
        <p className="muted">Everything in the console works with AI off. AI only adds extra suggestions.</p>
        <label className="switch"><input type="checkbox" role="switch" aria-label="AI help" checked={ai.enabled} disabled={!ai.configured || busy}
          onChange={async (e) => { const on = e.target.checked; if (on && !(await ask("Turn AI help on for this paper? Story text may be sent to the AI service for suggestions.", "Turn on"))) return; if (await run(() => api.setAi(on), on ? "AI help is on." : "AI help is off.")) reload(); }} /> {ai.enabled ? "On" : "Off"}</label>
      </section>
      <form className="card" onSubmit={save} aria-label="Paper details">
        <h3>The paper</h3>
        <div className="grid2">
          <label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
          <label>Language code<input value={f.lang} onChange={(e) => setF({ ...f, lang: e.target.value })} required /></label>
          <label>Script<input value={f.script} onChange={(e) => setF({ ...f, script: e.target.value })} required /></label>
          <label>Time zone<input value={f.tz} onChange={(e) => setF({ ...f, tz: e.target.value })} required /></label>
          <label>Page width (mm)<input type="number" value={f.page_w_mm} onChange={(e) => setF({ ...f, page_w_mm: Number(e.target.value) })} /></label>
          <label>Page height (mm)<input type="number" value={f.page_h_mm} onChange={(e) => setF({ ...f, page_h_mm: Number(e.target.value) })} /></label>
          <label>Website<input value={f.domain ?? ""} onChange={(e) => setF({ ...f, domain: e.target.value })} placeholder="news.example.com" /></label>
        </div>
        <button className="primary" disabled={busy}>Save</button>
      </form>
      {node}
    </>
  );
}
