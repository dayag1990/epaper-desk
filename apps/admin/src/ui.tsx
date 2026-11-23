import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { plainError } from "./lib/words";

export type Flash = { kind: "ok" | "bad"; text: string } | null;

/** Run an action, show its result in plain words. */
export function useAction() {
  const [flash, setFlash] = useState<Flash>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, okText?: string | ((r: T) => string)): Promise<T | undefined> => {
    setBusy(true);
    setFlash(null);
    try {
      const r = await fn();
      if (okText) setFlash({ kind: "ok", text: typeof okText === "function" ? okText(r) : okText });
      return r;
    } catch (e) {
      setFlash({ kind: "bad", text: plainError(e) });
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { flash, setFlash, busy, run };
}

export const FlashBar = ({ flash }: { flash: Flash }) => (flash ? <div className={`flash ${flash.kind}`} role={flash.kind === "bad" ? "alert" : "status"}>{flash.text}</div> : null);

/** Load data; reload on demand or on a timer while `poll` is true. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[], poll = false) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let live = true;
    fnRef.current().then((d) => live && (setData(d), setError(null))).catch((e) => live && setError(plainError(e)));
    return () => { live = false; };
  }, [...deps, n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!poll) return;
    const t = setInterval(() => setN((x) => x + 1), 2500);
    return () => clearInterval(t);
  }, [poll]);
  return { data, error, reload: () => setN((x) => x + 1) };
}

/** Our own confirmation box (the browser's confirm() is not available in every viewer). */
export function useConfirm() {
  const [st, setSt] = useState<{ text: string; label: string; resolve: (v: boolean) => void } | null>(null);
  const ask = useCallback((text: string, label = "Yes, do it") => new Promise<boolean>((resolve) => setSt({ text, label, resolve })), []);
  const close = (v: boolean) => { st?.resolve(v); setSt(null); };
  const node: ReactNode = st ? (
    <div className="scrim" role="presentation">
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label="Please confirm">
        <p>{st.text}</p>
        <div className="row">
          <button className="danger" onClick={() => close(true)}>{st.label}</button>
          <button onClick={() => close(false)}>Cancel</button>
        </div>
      </div>
    </div>
  ) : null;
  return { ask, node };
}

export const Secret = ({ title, value, onDone }: { title: string; value: string; onDone: () => void }) => (
  <div className="card secret" role="status">
    <strong>{title}</strong>
    <p>Copy it now. It is shown once and cannot be shown again.</p>
    <code className="mono" data-testid="secret">{value}</code>
    <div className="row"><button onClick={onDone}>I have copied it</button></div>
  </div>
);
