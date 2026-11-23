import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Viewer } from "./Viewer";
import { searchEdition, type Hit } from "./lib/search";
import { loadConfig, makeSource } from "./lib/source";
import type { EditionInfo, EditionSource, PageInfo, TextPage, Zone, ZoneSet } from "./lib/types";
import type { Rect } from "./lib/zones";
import { zoneText } from "./lib/zones";

const embed = new URLSearchParams(location.search).get("embed") === "1";
const parseHash = () => {
  const m = /^#\/([^/]+)\/(\d+)/.exec(location.hash);
  return { date: m ? m[1] : "latest", page: m ? +m[2] : 1 };
};

interface Data { ed: EditionInfo; pages: PageInfo[]; zones: Record<number, ZoneSet | undefined>; text: Record<number, TextPage | null | undefined> }

async function precache(urls: string[], onDone: (n: number) => void) {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  navigator.serviceWorker.addEventListener("message", (e) => { if (e.data?.type === "edition-cached") onDone(e.data.count); });
  reg.active?.postMessage({ type: "cache-edition", urls });
}

export function App() {
  const [src, setSrc] = useState<EditionSource | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [route, setRoute] = useState(parseHash());
  const [sheet, setSheet] = useState<{ zone: Zone; lines: string[] } | null>(null);
  const [toast, setToast] = useState("");
  const [q, setQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [marks, setMarks] = useState<Rect[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [offline, setOffline] = useState(0);
  const dataRef = useRef<Data | null>(null);
  dataRef.current = data;

  useEffect(() => {
    const h = () => { setRoute(parseHash()); setSheet(null); setMarks([]); };
    addEventListener("hashchange", h);
    return () => removeEventListener("hashchange", h);
  }, []);

  useEffect(() => { loadConfig().then((c) => setSrc(makeSource(c))).catch((e) => setErr(String(e.message ?? e))); }, []);

  // load the edition once per date
  useEffect(() => {
    if (!src) return;
    let dead = false;
    (async () => {
      try {
        const ed = await src.edition(route.date);
        const pages = await src.pages(ed);
        if (dead) return;
        setData({ ed, pages, zones: {}, text: {} });
        const urls = pages.flatMap((p) => [p.zonesUrl, p.textUrl, p.images[400], p.images[1600]].filter(Boolean) as string[]);
        precache(urls, setOffline).catch(() => {});
        if (embed) return;
        // zones and text for every page: needed for search and cheap (small json)
        await Promise.all(pages.map(async (p) => {
          const [z, t] = await Promise.all([src.zones(p).catch(() => undefined), src.text(p).catch(() => null)]);
          if (dead) return;
          setData((d) => d && d.ed.id === ed.id ? { ...d, zones: { ...d.zones, [p.no]: z }, text: { ...d.text, [p.no]: t } } : d);
        }));
      } catch (e: any) { if (!dead) setErr(String(e.message ?? e)); }
    })();
    return () => { dead = true; };
  }, [src, route.date]);

  const pageNo = data ? Math.min(Math.max(route.page, 1), data.pages.length || 1) : 1;
  const go = (n: number) => {
    if (!data) return;
    const c = Math.min(Math.max(n, 1), data.pages.length);
    history.replaceState(null, "", `#/${route.date}/${c}`);
    setRoute({ date: route.date, page: c }); setSheet(null); setMarks([]);
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "ArrowRight") go(pageNo + 1);
      if (e.key === "ArrowLeft") go(pageNo - 1);
      if (e.key === "Escape") setSheet(null);
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });

  const page = data?.pages[pageNo - 1];
  const zones = (page && data?.zones[page.no]?.zones) || [];

  const hits = useMemo(() => !data || !q ? [] : searchEdition(data.pages.map((p) => ({ page: p.no, text: data.text[p.no] ?? null, zones: data.zones[p.no]?.zones ?? [] })), q), [data, q]);

  const onZone = (z: Zone) => {
    if (z.url) {
      setToast(z.title);
      const w = window.open(z.url, "_blank");
      if (w) w.opener = null; else setSheet({ zone: z, lines: [] });
      return;
    }
    const t = page ? data?.text[page.no] : null;
    setSheet({ zone: z, lines: t ? zoneText(t, z) : [] });
  };
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 2500); return () => clearTimeout(t); }, [toast]);

  if (err) return <div class="msg" role="alert">Could not load the edition: {err}</div>;
  if (!data || !page) return <div class="msg">Loading…</div>;

  if (embed) {
    const open = () => {
      const url = location.origin + location.pathname + `#/${route.date}/1`;
      if (parent !== window) parent.postMessage({ type: "epaper:open", url }, "*"); else location.href = url;
    };
    return (
      <button class="cover" data-testid="cover" onClick={open}
        onLoad={() => parent.postMessage({ type: "epaper:height", height: document.documentElement.scrollHeight }, "*")}>
        <img src={data.pages[0].images[1600] ?? data.pages[0].images[400]} alt={`Front page, ${data.ed.date}`}
          onLoad={() => parent.postMessage({ type: "epaper:height", height: document.documentElement.scrollHeight }, "*")} />
        <span class="cap">{data.ed.date} · {data.pages.length} pages · Open edition</span>
      </button>
    );
  }

  return (
    <div class="app">
      <header>
        <strong class="title">{data.ed.paper}</strong>
        <span class="date">{data.ed.date}</span>
        <span class="grow" />
        <button aria-pressed={showAll} onClick={() => setShowAll(!showAll)} title="Show tappable stories">Stories</button>
        <button onClick={() => setSearchOpen(!searchOpen)} aria-label="Search">Search</button>
        {page.pdfUrl && <a class="btn" href={page.pdfUrl} target="_blank" rel="noopener">PDF</a>}
        {offline > 0 && <span class="badge" data-testid="offline-ready" title="Saved for offline">Offline ready</span>}
      </header>
      {searchOpen && (
        <div class="search">
          <input type="search" placeholder="Search this edition" value={q} autoFocus
            onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
          <ul data-testid="hits">
            {hits.map((h: Hit, i) => (
              <li key={i}><button onClick={() => { history.replaceState(null, "", `#/${route.date}/${h.page}`); setRoute({ date: route.date, page: h.page }); setMarks(h.rects); setSheet(null); }}>
                <b>p.{h.page}</b> {h.snippet}</button></li>
            ))}
            {q.length > 1 && hits.length === 0 && <li class="none">No matches</li>}
          </ul>
        </div>
      )}
      <main>
        <Viewer page={page} zones={zones} marks={marks} showAll={showAll}
          onSwipe={(d) => go(pageNo + d)} onZone={onZone} onEmpty={() => setSheet(null)} />
        <button class="nav prev" aria-label="Previous page" disabled={pageNo <= 1} onClick={() => go(pageNo - 1)}>‹</button>
        <button class="nav next" aria-label="Next page" disabled={pageNo >= data.pages.length} onClick={() => go(pageNo + 1)}>›</button>
        {toast && <div class="toast" role="status">Opening: {toast}</div>}
        {sheet && (
          <aside class="story" data-testid="story-sheet">
            <button class="x" aria-label="Close" onClick={() => setSheet(null)}>×</button>
            <h2>{sheet.zone.title}</h2>
            {sheet.zone.url && <p><a href={sheet.zone.url} target="_blank" rel="noopener">Read on site</a></p>}
            {sheet.lines.length ? sheet.lines.map((l, i) => <p key={i}>{l}</p>) : !sheet.zone.url && <p class="none">No text available for this story.</p>}
          </aside>
        )}
      </main>
      <nav class="strip" aria-label="Pages" data-testid="strip">
        {data.pages.map((p) => (
          <button key={p.no} class={p.no === pageNo ? "on" : ""} aria-label={`Page ${p.no}`} aria-current={p.no === pageNo} onClick={() => go(p.no)}>
            <img loading="lazy" src={p.images[400]} alt="" draggable={false} /><i>{p.no}</i>
          </button>
        ))}
      </nav>
      <div class="pageno" data-testid="pageno" aria-live="polite">Page {pageNo} / {data.pages.length}</div>
    </div>
  );
}
