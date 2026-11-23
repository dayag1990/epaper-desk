import { useState } from "react";
import type { ScreenProps } from "../App";
import type { DeliveryRow } from "../types";
import { FlashBar, Secret, useAction, useConfirm, useLoad } from "../ui";

function Log({ api, id }: { api: ScreenProps["api"]; id: string }) {
  const { data, error, reload } = useLoad(() => api.deliveries(id), [id]);
  const words = (d: DeliveryRow) => (d.status === "delivered" ? "Delivered" : d.status === "failed" ? `Failed${d.last_error ? `: ${d.last_error}` : ""}` : "Waiting to be sent");
  return (
    <div className="card inner" data-testid="deliveries">
      <div className="row between"><h4>Recent deliveries</h4><button onClick={reload}>Refresh</button></div>
      {error && <p className="flash bad">{error}</p>}
      {data?.items.length === 0 && <p className="muted">Nothing sent yet.</p>}
      <ul className="plain">{data?.items.map((d) => <li key={d.id}>{d.event} · {words(d)} · {d.attempts} {d.attempts === 1 ? "try" : "tries"}</li>)}</ul>
    </div>
  );
}

export function Connections({ api }: ScreenProps) {
  const keys = useLoad(() => api.keys(), []);
  const hooks = useLoad(() => api.hooks(), []);
  const sources = useLoad(() => api.sources(), []);
  const { flash, busy, run } = useAction();
  const { ask, node } = useConfirm();
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);
  const [url, setUrl] = useState("");
  const [log, setLog] = useState<string | null>(null);
  const [src, setSrc] = useState("");
  const name = (id: string | null) => sources.data?.items.find((s) => s.id === id)?.name ?? "a source";
  return (
    <>
      <div className="head"><h2>Connections</h2></div>
      <FlashBar flash={flash} />
      {secret && <Secret title={secret.title} value={secret.value} onDone={() => setSecret(null)} />}

      <h3>Push keys</h3>
      <p className="muted">A key lets a website send stories to one source. Each key is shown once.</p>
      {(keys.error || hooks.error) && <div className="flash bad" role="alert">{keys.error ?? hooks.error}</div>}
      <div className="row wrap">
        <label>Source<select value={src} onChange={(e) => setSrc(e.target.value)}><option value="">Choose a source</option>{sources.data?.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <button disabled={busy || !src} onClick={async () => { const r = await run(() => api.createKey(src)); if (r) { setSecret({ title: `New key for ${name(src)}`, value: r.key }); keys.reload(); } }}>Make a key</button>
      </div>
      <ul className="list">
        {keys.data?.items.map((k) => (
          <li key={k.id} className="card" data-testid="key">
            <div className="row between wrap"><span><strong>{k.label || name(k.source_id)}</strong> <span className="muted">{k.last_used_at ? `last used ${k.last_used_at.slice(0, 10)}` : "never used"}</span></span>
              <button className="danger" disabled={busy} onClick={async () => { if (await ask("Stop this key working? The website using it will not be able to send stories.", "Stop the key")) { if (await run(() => api.revokeKey(k.id), "Key stopped.")) keys.reload(); } }}>Revoke</button></div>
          </li>
        ))}
        {keys.data?.items.length === 0 && <li className="muted">No keys yet.</li>}
      </ul>

      <h3>Webhooks</h3>
      <p className="muted">We call these addresses when an edition goes live or a file is ready.</p>
      <form className="row wrap" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => api.createHook(url.trim())); if (r) { setSecret({ title: "Webhook secret", value: r.secret }); setUrl(""); hooks.reload(); } }}>
        <label className="grow">Address to call<input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hook" required /></label>
        <button className="primary" disabled={busy}>Add webhook</button>
      </form>
      <ul className="list">
        {hooks.data?.items.map((h) => (
          <li key={h.id} className="card" data-testid="hook">
            <div className="row between wrap"><strong className="wrapany">{h.url}</strong>
              <span className="row wrap">
                <button disabled={busy} onClick={async () => { if (await run(() => api.testHook(h.id), "Test sent. See the log below in a moment.")) setLog(h.id); }}>Send a test</button>
                <button onClick={() => setLog(log === h.id ? null : h.id)}>Log</button>
                <button className="danger" disabled={busy} onClick={async () => { if (await ask(`Delete the webhook for ${h.url}? It stops getting calls.`, "Delete webhook")) { if (await run(() => api.deleteHook(h.id), "Deleted.")) hooks.reload(); } }}>Delete</button>
              </span></div>
            {log === h.id && <Log api={api} id={h.id} />}
          </li>
        ))}
        {hooks.data?.items.length === 0 && <li className="muted">No webhooks yet.</li>}
      </ul>
      {node}
    </>
  );
}
