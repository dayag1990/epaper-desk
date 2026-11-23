import { useCallback, useEffect, useState } from "react";
import type { Api } from "./api";
import type { Me } from "./types";
import { ApiError, plainError } from "./lib/words";
import { parseScreen, ROLE_WORDS, SCREEN_NAMES, screensFor, type Screen } from "./lib/roles";
import { PaperSwitcher } from "./PaperSwitcher";
import { Login } from "./screens/Login";
import { Sources } from "./screens/Sources";
import { Articles } from "./screens/Articles";
import { Editions } from "./screens/Editions";
import { People } from "./screens/People";
import { Connections } from "./screens/Connections";
import { Activity } from "./screens/Activity";
import { Settings } from "./screens/Settings";

const OPS_URL = (import.meta.env.VITE_OPS_URL as string | undefined) ?? "http://127.0.0.1:8101/";

function StatusLight({ api }: { api: Api }) {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    const tick = () => api.ready().then((v) => live && setOk(v));
    tick();
    const t = setInterval(tick, 20_000);
    return () => { live = false; clearInterval(t); };
  }, [api]);
  if (ok === null) return <span className="light grey" title="Checking">&nbsp;</span>;
  return ok ? <span className="light green" title="All systems are working" role="img" aria-label="All systems are working" />
    : <a className="light red" href={OPS_URL} title="Something is wrong. Open the ops desk." aria-label="Something is wrong. Open the ops desk.">Problem: open the ops desk</a>;
}

export function App({ api }: { api: Api }) {
  const [me, setMe] = useState<Me | null | "loading">("loading");
  const [hash, setHash] = useState(location.hash);

  useEffect(() => { api.me().then(setMe).catch((e) => setMe(e instanceof ApiError && e.status === 401 ? null : null)); }, [api]);
  useEffect(() => { const f = () => setHash(location.hash); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  const signedOut = useCallback(() => setMe(null), []);

  if (me === "loading") return <div className="center">Loading…</div>;
  if (!me) return <Login api={api} onIn={setMe} />;

  const screen: Screen = parseScreen(hash, me.role);
  const props = { api, me, onSignedOut: signedOut };
  const logout = async () => { try { await api.logout(); } catch (e) { void plainError(e); } setMe(null); location.hash = ""; };
  return (
    <div className="shell">
      <header className="top">
        <div className="brand"><strong data-testid="paper-name">{me.paper.name}</strong><StatusLight api={api} /><PaperSwitcher api={api} me={me} onSwitched={(m) => setMe(m)} /></div>
        <div className="who"><span data-testid="role" title={ROLE_WORDS[me.role]}>{me.role}</span><button className="link" onClick={logout}>Sign out</button></div>
      </header>
      <nav className="nav" aria-label="Sections">
        {screensFor(me.role).map((s) => <a key={s} href={`#/${s}`} aria-current={s === screen ? "page" : undefined}>{SCREEN_NAMES[s]}</a>)}
      </nav>
      {me.role === "viewer" && <div className="flash ok" role="note">You can look around, but not change anything. Ask an owner for more access.</div>}
      <main key={me.paper.slug}>
        {screen === "sources" && <Sources {...props} />}
        {screen === "articles" && <Articles {...props} />}
        {screen === "editions" && <Editions {...props} />}
        {screen === "people" && <People {...props} />}
        {screen === "connections" && <Connections {...props} />}
        {screen === "activity" && <Activity {...props} />}
        {screen === "settings" && <Settings {...props} />}
      </main>
    </div>
  );
}
export type ScreenProps = { api: Api; me: Me; onSignedOut: () => void };
