import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Article } from "@epaper/core";
import type { Api } from "./api";
import { plainError } from "./errors";
import { PageView } from "./PageView";
import { PAGE_SIZES, addStory, applyTool, ensureSlot, moveTo, resizeItem, placeArticle, setCutout, setFocal, setPageSize, setPhoto, setRatio, setStatus, EMPTY_ASSET, type ToolAction } from "./tools";
import type { EditorStore } from "./store";
import type { EditorConfig } from "./config";
import { KEY_RUN_MS } from "./flow";
import type { VersionRecord } from "./types";

const CROPS: [string, number][] = [["Wide 3:1", 3], ["16:9", 16 / 9], ["3:2", 1.5], ["4:3", 4 / 3], ["Square", 1], ["Tall 3:4", 0.75]];
type Panel = null | "photo" | "tray" | "versions" | "ai";

export function App({ store, api, cfg }: { store: EditorStore; api: Api; cfg: EditorConfig }) {
  const s = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [editing, setEditing] = useState(() => window.innerWidth >= 900);
  const [zoom, setZoomRaw] = useState(0.5);
  const anchor = useRef<{ r: number; ax: number; ay: number; vx: number; vy: number } | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [delArmed, setDelArmed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pickFor = useRef<string | null>(null);

  /**
   * Zoom keeps one point of the page still on screen: the middle of the selected block (so it never scrolls out of view),
   * else the middle of the visible area. The scroll position is corrected after the page has been re-laid out.
   */
  const setZoom = useCallback((f: (z: number) => number) => {
    setZoomRaw((z) => {
      const nz = f(z);
      const sc = scroller.current;
      if (sc && nz !== z) {
        const sr = sc.getBoundingClientRect();
        const sel = sc.querySelector<HTMLElement>(".story.sel");
        const r = sel?.getBoundingClientRect();
        const vx = r ? r.left + r.width / 2 - sr.left : sc.clientWidth / 2;
        const vy = r ? r.top + r.height / 2 - sr.top : sc.clientHeight / 2;
        anchor.current = { r: nz / z, ax: sc.scrollLeft + vx, ay: sc.scrollTop + vy, vx, vy };
      }
      return nz;
    });
  }, []);
  useLayoutEffect(() => {
    const a = anchor.current, sc = scroller.current;
    anchor.current = null;
    if (!a || !sc) return;
    // content coordinates scale with the zoom (the stage has 8px padding that does not)
    sc.scrollLeft = (a.ax - 8) * a.r + 8 - a.vx;
    sc.scrollTop = (a.ay - 8) * a.r + 8 - a.vy;
  }, [zoom]);

  const pid = s.active;
  const doc = pid ? s.docs[pid] : undefined;
  const access = pid ? s.access[pid] : undefined;
  const canEdit = access?.mode === "edit";
  const isEditing = editing && canEdit;
  const template = pid && doc ? store.templateOf(pid) : null;
  const item = doc?.items.find((i) => i.id === s.selected);

  // pictures: article images plus anything uploaded in this session
  const renderArticles = useMemo<Article[]>(() => {
    const up = Object.values(s.assets).map((a) => ({ asset_id: a.id, src: a.src }));
    return [...s.articles, { images: up } as unknown as Article];
  }, [s.articles, s.assets]);
  const hasSrc = useCallback((id: string) => renderArticles.some((a) => a.images.some((i) => i.asset_id === id && !!i.src)), [renderArticles]);

  // toast from store notices
  useEffect(() => {
    if (!s.notice) return;
    setToast(s.notice);
    const t = setTimeout(() => { setToast(null); store.notify(null); }, 5000);
    return () => clearTimeout(t);
  }, [s.notice, store]);
  useEffect(() => { setDelArmed(false); }, [s.selected]);

  // fit the page to the screen width
  const fitZoom = useCallback(() => {
    if (!template || !scroller.current) return;
    setZoom(() => Math.max(0.15, Math.min(1, (scroller.current!.clientWidth - 16) / template.canvas_px)));
  }, [template]);
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (template && fitted.current !== pid) { fitted.current = pid; fitZoom(); }
  }, [template, pid, fitZoom]);

  // keyboard undo / redo, browser online, leaving with unsaved work
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); store.redo(); }
    };
    const online = () => store.online();
    const beforeUnload = (e: BeforeUnloadEvent) => { if (store.state.dirty.length && store.state.save.state !== "saved") { void store.saveNow(); e.preventDefault(); } };
    addEventListener("keydown", key); addEventListener("online", online); addEventListener("beforeunload", beforeUnload);
    return () => { removeEventListener("keydown", key); removeEventListener("online", online); removeEventListener("beforeunload", beforeUnload); };
  }, [store]);

  if (s.phase === "loading") return <div className="center" role="status">Opening the edition…</div>;
  if (s.phase === "failed") return <div className="center err" role="alert"><p>{s.error}</p><button className="btn" onClick={() => location.reload()}>Try again</button></div>;
  if (!pid || !doc || !template) return <div className="center">This edition has no pages yet.</div>;

  const edit = (docs: ReturnType<typeof ensureSlot>, touched: string[], key?: string) => store.commit(docs, touched, key);
  const tool = (a: ToolAction, run?: string) => {
    if (!s.selected) return;
    if (run) { /* keyboard step: no delete arming */ } else if (a === "del") {
      if (!delArmed) { setDelArmed(true); return; }
      setDelArmed(false);
    } else setDelArmed(false);
    const r = applyTool(s.docs, pid, s.selected, a, { order: s.order, templateOf: store.templateOf, hasSrc });
    if (!r) return;
    if (!store.commit(r.docs, r.touched, run, run ? KEY_RUN_MS : undefined)) return;
    if (a === "del") store.select(null);
    if (r.pageId !== pid) { void store.setActive(r.pageId).then(() => store.select(s.selected)); }
    if (r.note) store.notify(r.note);
  };
  const afterGesture = (r: { docs: typeof s.docs; touched: string[] } | null, key?: string) => {
    if (r) store.commit(r.docs, r.touched, key, key ? KEY_RUN_MS : undefined);
  };
  const toolCtx = { order: s.order, templateOf: store.templateOf, hasSrc };
  const pickImage = (itemId: string) => { pickFor.current = itemId; fileRef.current?.click(); };
  const onFile = async (f: File | undefined) => {
    const id = pickFor.current;
    if (!f || !id) return;
    try {
      const a = await api.uploadAsset(f);
      store.addAsset(a);
      edit(setPhoto(store.state.docs, pid, id, a.id), [pid]);
    } catch (e) { store.notify(plainError(e, "add that photo")); }
  };
  const cutOut = async () => {
    if (!item?.image || !s.selected) return;
    try {
      const a = await api.cutout(item.image.asset_id);
      store.addAsset(a);
      edit(setCutout(store.state.docs, pid, s.selected, a.id), [pid]);
      store.notify("Background removed.");
    } catch (e) {
      // the rule-based way: crop by hand
      store.notify(plainError(e, "cut out this photo") + " Crop it by hand instead.");
      setPanel("photo");
    }
  };

  const m = s.meters[pid];
  const fillPct = m?.pct ?? s.serverFit[pid] ?? null;
  const saveText = { saved: "Saved", saving: "Saving…", unsaved: "Not saved yet", offline: "Offline: kept on this device", error: s.save.message ?? "Couldn't save" }[s.save.state];
  const placed = new Set(s.order.flatMap((p) => s.docs[p]!.items.map((i) => i.article_id)));
  const unplaced = s.articles.filter((a) => !placed.has(a.id));
  const stale = s.articles.filter((a) => s.order.some((p) => s.docs[p]!.items.some((i) => i.article_id === a.id && (i.article_rev ?? 0) < a.rev)));

  return (
    <div className="app">
      <header className="top">
        <div className="title" title={s.edition?.name}>{s.edition?.name}</div>
        <nav className="tabs" aria-label="Pages">
          {s.order.map((p) => {
            const mm = s.meters[p];
            const pc = mm?.pct ?? s.serverFit[p] ?? null;
            return (
              <button key={p} data-testid={`page-tab-${s.nos[p]}`} className={`tab ${p === pid ? "on" : ""} ${mm ? mm.state : ""}`} onClick={() => void store.setActive(p)}>
                Page {s.nos[p]}{pc != null && <small> {pc}%</small>}{s.docs[p]!.status !== "draft" && <small> · {s.docs[p]!.status}</small>}
              </button>
            );
          })}
        </nav>
        <div className="spacer" />
        <span className={`save ${s.save.state}`} data-testid="save-state" role="status">{saveText}</span>
        <button className="btn" data-testid="undo" disabled={!s.canUndo} onClick={() => store.undo()} aria-label="Undo">Undo</button>
        <button className="btn" data-testid="redo" disabled={!s.canRedo} onClick={() => store.redo()} aria-label="Redo">Redo</button>
        {canEdit && <button className="btn" data-testid="save-now" onClick={() => void store.saveNow()} disabled={!s.dirty.length}>Save now</button>}
        {canEdit && <button className={`btn ${isEditing ? "on" : ""}`} data-testid="mode" onClick={() => setEditing(!editing)}>{isEditing ? "Reading view" : "Edit"}</button>}
      </header>

      {access?.mode === "readonly" && (
        <div className="banner" data-testid="lock-banner" role="status">
          {access.reason === "locked" && <>This page is being edited by <b>{access.holder?.name ?? "someone else"}</b>. You can read it. It will open for you when they're done.</>}
          {access.reason === "viewer" && <>You can read this edition but not change or save it. Ask an editor if you need to make a change.</>}
          {access.reason === "approved" && <>This page is approved and locked. Nothing can change until it is re-opened.</>}
        </div>
      )}
      {s.save.state === "offline" && <div className="banner warn" role="alert">Can't reach the server. Keep going: every word is kept on this device and saves by itself when it is back.</div>}

      <div className="bar2">
        <span className={`meter ${m?.state ?? ""}`} data-testid="fill-meter" data-refits={s.refits} data-pct={m?.pct ?? ""} data-zoom={zoom.toFixed(4)} role="status">
          {m ? m.label : fillPct != null ? `${fillPct}% full` : "Measuring…"}
        </span>
        {m?.lowRes.map((t) => <span key={t} className="meter over">{t}</span>)}
        <span className="grp">
          <button className="btn" onClick={() => setZoom((z) => Math.max(0.15, z / 1.25))} aria-label="Zoom out">−</button>
          <button className="btn" onClick={() => setZoom((z) => Math.min(2, z * 1.25))} aria-label="Zoom in">+</button>
          <button className="btn" onClick={fitZoom}>Fit</button>
        </span>
        {isEditing && (
          <select aria-label="Page size" value={doc.page.size} onChange={(e) => edit(setPageSize(s.docs, pid, e.target.value), [pid])}>
            {PAGE_SIZES.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
          </select>
        )}
        {isEditing && <button className="btn" data-testid="add-story" onClick={() => { const id = `it_${Date.now().toString(36)}`; if (edit(addStory(s.docs, pid, s.selected, id), [pid])) store.select(id); }}>Add story</button>}
        {canEdit && <button className="btn" onClick={() => setPanel(panel === "tray" ? null : "tray")}>Story tray{unplaced.length ? ` (${unplaced.length})` : ""}{stale.length ? " •" : ""}</button>}
        <button className="btn" data-testid="versions-btn" onClick={() => setPanel(panel === "versions" ? null : "versions")}>Versions</button>
        {s.me?.ai_enabled && canEdit && <button className="btn ai" data-testid="ai-btn" onClick={() => setPanel(panel === "ai" ? null : "ai")}>AI suggestions</button>}
        {canEdit && <button className="btn" data-testid="status-btn" onClick={() => edit(setStatus(s.docs, pid, doc.status === "draft" ? "subbed" : "draft"), [pid])}>{doc.status === "draft" ? "Mark as subbed" : "Back to draft"}</button>}
        {canEdit && doc.status === "subbed" && <button className="btn y" data-testid="approve" onClick={() => void store.approve(pid, !m || m.state !== "over")}>Approve and lock</button>}
      </div>

      <div className="stage" ref={scroller} data-testid="stage" onClick={(e) => { if (e.target === e.currentTarget) store.select(null); }}>
        <PageView
          doc={doc}
          template={template}
          articles={renderArticles}
          editable={isEditing}
          zoom={zoom}
          selected={s.selected}
          onEdit={(nd, key) => edit({ ...s.docs, [pid]: nd }, [pid], key)}
          onSelect={(id) => store.select(id)}
          onPickImage={pickImage}
          onMeter={(mt) => store.refitted(pid, mt)}
          onKeyStep={(a, id) => tool(a, `kbd:${id}:${a}`)}
          onMoveTo={(id, to) => afterGesture({ docs: moveTo(s.docs, pid, id, to), touched: [pid] })}
          onResize={(id, edge, v) => afterGesture(resizeItem(s.docs, pid, id, edge, v, toolCtx))}
        />
      </div>

      {isEditing && item && (
        <div className="tool" data-testid="toolbar" role="toolbar" aria-label="Story tools">
          <Grp label="Width"><B a="span-" t={tool}>−</B><B a="span+" t={tool}>+</B></Grp>
          <Grp label="Text cols"><B a="cols-" t={tool}>−</B><B a="cols+" t={tool}>+</B></Grp>
          <Grp label="Headline"><B a="hs-" t={tool}>A−</B><B a="hs+" t={tool}>A+</B></Grp>
          <Grp label="Move"><B a="mv-" t={tool}>◀</B><B a="mv+" t={tool}>▶</B></Grp>
          <Grp label="Photo">
            <button className="btn" data-testid="tool-img" onClick={() => { if (!item.image) edit(ensureSlot(s.docs, pid, item.id), [pid]); setPanel("photo"); }}>Photo…</button>
            <B a="ar-" t={tool}>Taller</B><B a="ar+" t={tool}>Shorter</B><B a="imgx" t={tool}>Remove</B>
          </Grp>
          <Grp>
            <button className="btn r" data-testid="tool-del" onClick={() => tool("del")}>{delArmed ? "Tap again to delete" : "Delete story"}</button>
            <button className="btn" onClick={() => store.select(null)}>Done</button>
          </Grp>
        </div>
      )}

      {panel && (
        <aside className="panel" data-testid={`panel-${panel}`}>
          <button className="btn close" onClick={() => setPanel(null)} aria-label="Close panel">Close</button>
          {panel === "photo" && <PhotoPanel
            item={item} hasSrc={hasSrc} srcOf={(id) => renderArticles.flatMap((a) => a.images).find((i) => i.asset_id === id)?.src}
            onPick={() => item && pickImage(item.id)}
            onFocal={(x, y) => item && edit(setFocal(s.docs, pid, item.id, x, y), [pid], `focal:${item.id}`)}
            onCrop={(r) => item && edit(setRatio(s.docs, pid, item.id, r), [pid])}
            onCutout={cutOut}
          />}
          {panel === "tray" && <Tray unplaced={unplaced} stale={stale} onPlace={(a) => {
            const imgs = renderArticles.find((x) => x.id === a.id)?.images[0] ?? a.images[0];
            edit(placeArticle(s.docs, pid, { id: a.id, rev: a.rev, kicker: a.kicker ?? null, headline: a.headline, subhead: a.subhead ?? null, paras: a.body.filter((b) => b.t === "p").map((b) => b.text), image: imgs ? { asset_id: imgs.asset_id } : undefined }), [pid]);
          }} onMerge={(a) => {
            const d = { ...s.docs };
            for (const p of s.order) d[p] = { ...d[p]!, items: d[p]!.items.map((i) => i.article_id === a.id ? { ...i, article_rev: a.rev, text: { kicker: a.kicker ?? null, head: a.headline, sub: a.subhead ?? null, body: a.body.filter((b) => b.t === "p").map((b) => b.text) } } : i) };
            edit(d, s.order.filter((p) => d[p] !== s.docs[p]));
          }} />}
          {panel === "versions" && <Versions store={store} pid={pid} canEdit={!!canEdit} key={pid + s.revs[pid]} />}
          {panel === "ai" && s.me?.ai_enabled && <AiPanel api={api} headline={item?.text?.head ?? ""} articleId={item?.article_id} onUse={(t) => item && edit({ ...s.docs, [pid]: { ...doc, items: doc.items.map((i) => i.id === item.id && i.text ? { ...i, text: { ...i.text, head: t } } : i) } }, [pid])} />}
        </aside>
      )}

      {s.conflict && (
        <div className="modal" role="alertdialog" aria-labelledby="cf-t" data-testid="conflict">
          <div className="card">
            <h3 id="cf-t">Someone else saved this page</h3>
            <p>Both versions are kept. Pick the one you want; nothing is deleted either way, and the other stays in Versions.</p>
            <div className="two">
              <DocSummary title="Yours (on this device)" doc={s.conflict.mine} />
              <DocSummary title="Theirs (on the server)" doc={s.conflict.theirs} />
            </div>
            <div className="row">
              <button className="btn y" onClick={() => void store.resolveConflict("mine")}>Keep mine</button>
              <button className="btn" onClick={() => void store.resolveConflict("theirs")}>Take theirs</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast" role="status" data-testid="toast">{toast}</div>}
      <input ref={fileRef} type="file" accept="image/*" hidden data-testid="file-input" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void onFile(f); }} />
    </div>
  );
}

const Grp = ({ label, children }: { label?: string; children: React.ReactNode }) => <div className="grp">{label && <span>{label}</span>}{children}</div>;
const B = ({ a, t, children }: { a: ToolAction; t(a: ToolAction): void; children: React.ReactNode }) => (
  <button className="btn" data-testid={`tool-${a}`} onClick={() => t(a)}>{children}</button>
);

function DocSummary({ title, doc }: { title: string; doc: import("@epaper/core").PageDoc }) {
  return (
    <div className="sum">
      <h4>{title}</h4>
      <ul>{doc.items.map((i) => <li key={i.id}>{i.text?.head || <i>(no headline)</i>}</li>)}</ul>
    </div>
  );
}

function PhotoPanel(p: { item?: import("@epaper/core").PageItem; hasSrc(id: string): boolean; srcOf(id: string): string | undefined; onPick(): void; onFocal(x: number, y: number): void; onCrop(r: number): void; onCutout(): void }) {
  const it = p.item;
  if (!it) return <p>Tap a story first.</p>;
  const img = it.image;
  const src = img && img.asset_id !== EMPTY_ASSET ? p.srcOf(img.asset_id) : undefined;
  return (
    <div className="pp">
      <h3>Photo</h3>
      <button className="btn y" data-testid="swap-photo" onClick={p.onPick}>{src ? "Swap photo" : "Add photo"}</button>
      {img && src && (
        <>
          <h4>Focal point</h4>
          <p className="hint">Tap the part of the photo that must stay in the frame.</p>
          <div className="focal" data-testid="focal-picker" onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            p.onFocal((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
          }}>
            <img src={src} alt="" draggable={false} />
            <span className="dot" style={{ left: `${img.focal[0] * 100}%`, top: `${img.focal[1] * 100}%` }} />
          </div>
          <h4>Crop</h4>
          <p className="hint">Pick a shape. The focal point decides what is kept.</p>
          <div className="crops">{CROPS.map(([l, r]) => <button key={l} className={`btn ${Math.abs(img.ratio - r) < 0.02 ? "on" : ""}`} onClick={() => p.onCrop(r)}>{l}</button>)}</div>
          <h4>Cut out</h4>
          <button className="btn" data-testid="cutout" onClick={p.onCutout}>{img.cutout ? "Cut out (done)" : "Cut out the background"}</button>
          <p className="hint">If automatic cut-out isn't available, crop by hand above.</p>
        </>
      )}
    </div>
  );
}

function Tray(p: { unplaced: Article[]; stale: Article[]; onPlace(a: Article): void; onMerge(a: Article): void }) {
  return (
    <div>
      <h3>Story tray</h3>
      {p.stale.length > 0 && (
        <>
          <h4>Source updated</h4>
          <p className="hint">The website changed these stories. Take the new copy (it replaces your edits to the story's text) or leave yours.</p>
          <ul className="list">{p.stale.map((a) => <li key={a.id}><span>{a.headline}</span><button className="btn" onClick={() => p.onMerge(a)}>Take new copy</button></li>)}</ul>
        </>
      )}
      <h4>Not on a page yet</h4>
      {p.unplaced.length === 0 ? <p className="hint">Every story is placed.</p> : (
        <ul className="list">{p.unplaced.map((a) => <li key={a.id}><span>{a.headline}</span><button className="btn" data-testid="place" onClick={() => p.onPlace(a)}>Add to this page</button></li>)}</ul>
      )}
    </div>
  );
}

function Versions({ store, pid, canEdit }: { store: EditorStore; pid: string; canEdit: boolean }) {
  const [list, setList] = useState<VersionRecord[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [armed, setArmed] = useState<number | null>(null);
  useEffect(() => { store.versions(pid).then(setList, (e) => setErr(plainError(e, "load the versions"))); }, [store, pid]);
  return (
    <div>
      <h3>Versions</h3>
      {err && <p className="err">{err}</p>}
      {!list && !err && <p>Loading…</p>}
      <ul className="list" data-testid="version-list">
        {list?.map((v) => (
          <li key={v.rev}>
            <span>Version {v.rev} · {new Date(v.at).toLocaleString()}{v.user ? ` · ${v.user.name}` : ""}<br /><small>{v.doc.items.map((i) => i.text?.head).filter(Boolean).slice(0, 2).join(" / ")}</small></span>
            {canEdit && <button className="btn" data-testid={`restore-${v.rev}`} onClick={() => { if (armed !== v.rev) setArmed(v.rev); else { setArmed(null); void store.restore(pid, v.rev); } }}>{armed === v.rev ? "Tap again to go back" : "Restore"}</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AiPanel({ api, headline, articleId, onUse }: { api: Api; headline: string; articleId?: string; onUse(t: string): void }) {
  const [opts, setOpts] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const ask = async () => {
    setMsg(null);
    try { setOpts((await api.suggest({ task: "headline", text: headline, max_chars: Math.max(20, headline.length - 10), article_id: articleId })).map((o) => o.text)); }
    catch { setOpts(null); setMsg("The suggestions aren't available right now. Your page is unaffected; shorten the headline by hand."); }
  };
  return (
    <div>
      <h3>AI suggestions</h3>
      <p className="hint">Options only. Nothing changes until you tap one.</p>
      <button className="btn y" disabled={!headline} onClick={() => void ask()} data-testid="ai-ask">Suggest shorter headlines</button>
      {msg && <p className="err">{msg}</p>}
      <ul className="list">{opts?.map((o) => <li key={o}><span>{o}</span><button className="btn" onClick={() => onUse(o)}>Use</button></li>)}</ul>
      {opts && <button className="btn" onClick={() => setOpts(null)}>Reject all</button>}
    </div>
  );
}
