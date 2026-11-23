import type { ServiceStatus, Snapshot } from "./health.js";
import { esc } from "./md.js";
import type { BackupStatus } from "./backup.js";
import type { ClearItem } from "./fixes.js";

const page = (title: string, body: string, nav = true) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><link rel="stylesheet" href="/assets/app.css"></head><body><main>${nav ? `<nav><a href="/">Desk</a><a href="/history">History</a><a href="/ops/build">Build clock</a><a href="/logout">Log out</a></nav>` : ""}${body}</main><div id="toast" role="status"></div>
<dialog id="confirmDlg"><form method="dialog"><p id="confirmWhat"></p><p>Type <b id="confirmWord"></b> to go ahead.</p><input id="confirmInput" autocomplete="off" autocapitalize="characters"><div class="row"><button value="go">Go ahead</button><button value="no" class="sec" formnovalidate>Cancel</button></div></form></dialog>
<script src="/assets/app.js"></script></body></html>`;

export const loginPage = (msg?: string) => page("Ops desk login", `<h1>Ops desk</h1>${msg ? `<div class="card red"><b>${esc(msg)}</b></div>` : ""}<form method="post" action="/login"><label>Password<input type="password" name="password" autocomplete="current-password" required></label><label>6-digit code from your phone app (or a backup code)<input name="code" inputmode="text" autocomplete="one-time-code" required></label><div class="row"><button>Log in</button></div></form>`, false);

export const setupPage = (msg?: string) => page("Ops desk setup", `<h1>First-time setup</h1><p>Make the one login for this desk.</p>${msg ? `<div class="card red"><b>${esc(msg)}</b></div>` : ""}<form method="post" action="/setup"><label>Setup code (from the server settings)<input name="setup" required autocomplete="off"></label><label>Choose a password (12 or more characters)<input type="password" name="password" minlength="12" required autocomplete="new-password"></label><div class="row"><button>Continue</button></div></form>`, false);

export const setupStep2 = (secret: string, uri: string, codes: string[], msg?: string) => page("Ops desk setup", `<h1>Step 2: link your phone</h1>${msg ? `<div class="card red"><b>${esc(msg)}</b></div>` : ""}<p>1. Tap this to open your authenticator app: <a class="btn" href="${esc(uri)}">Add to authenticator</a></p><p>Or type this key into the app by hand:</p><p class="codes">${esc(secret)}</p><h2>2. Save these backup codes now</h2><p><b>They are shown only this once.</b> Each works one time if you lose your phone. Screenshot them or write them down.</p><p class="codes">${codes.map(esc).join("<br>")}</p><form method="post" action="/setup/confirm"><label>3. Type the 6-digit code your app shows now<input name="code" inputmode="numeric" autocomplete="one-time-code" required></label><div class="row"><button>Finish setup</button></div></form>`, false);

const FIX_LABEL: Record<string, string> = {
  restart: "Fix it (restart)", retry_jobs: "Retry failed jobs", clear_disk: "Free disk space", run_now: "Back up now", verify_now: "Check backups now", restart_all: "Restart everything",
};

function card(s: ServiceStatus): string {
  const b: string[] = [];
  for (const f of s.fixes) {
    if (f === "restart") b.push(`<button data-post="/ops/services/${esc(s.name)}/restart">${s.state === "red" ? "Fix it (restart)" : "Restart"}</button>`);
    else if (f === "logs") b.push(`<a class="btn sec" href="/logs/${esc(s.name)}">Look at the log</a>`);
    else if (f === "retry_jobs") b.push(`<button data-post="/ops/jobs/retry">Retry failed jobs</button>`);
    else if (f === "clear_disk") b.push(`<a class="btn" href="/disk">Free disk space</a>`);
    else if (f === "run_now") b.push(`<button data-post="/ops/backups/run">Back up now</button>`);
    else if (f === "verify_now") b.push(`<button data-post="/ops/backups/verify">Check backups now</button>`);
    else if (f === "restart_all") b.push(`<button data-post="/ops/restart-all">Restart everything</button>`);
    else if (f === "pause") b.push(`<button class="sec" data-post="/ops/queues/export/pause">Pause line</button>`);
    else if (f === "resume") b.push(`<button class="sec" data-post="/ops/queues/export/resume">Resume line</button>`);
    else if (f === "restore_to_minute") b.push(`<a class="btn sec" href="/#restore">Go back in time</a>`);
  }
  const word = { green: "Working", amber: "Check soon", red: "Needs you" }[s.state];
  return `<div class="card ${s.state}"><h3><span class="dot ${s.state}"></span>${esc(s.title)}: ${word}</h3><div>${esc(s.plain)}</div>${s.todo ? `<div class="todo">What to do: ${esc(s.todo)}</div>` : ""}<div class="mute">${s.state === "green" ? "Fine" : "Like this"} since ${esc(s.since)}</div>${b.length ? `<div class="row">${b.join("")}</div>` : ""}</div>`;
}

export function lightsFragment(snap: Snapshot): string {
  const sorted = [...snap.services].sort((a, b) => "rag".indexOf(a.state[0]!) - "rag".indexOf(b.state[0]!));
  const reds = snap.services.filter((s) => s.state === "red").length, ambers = snap.services.filter((s) => s.state === "amber").length;
  const banner = reds ? `<div class="banner red">${reds} thing${reds > 1 ? "s" : ""} need${reds > 1 ? "" : "s"} you. Start at the top.</div>` : ambers ? `<div class="banner amber">Working, but ${ambers} thing${ambers > 1 ? "s" : ""} to check soon.</div>` : `<div class="banner green">Everything is working.</div>`;
  return banner + sorted.map(card).join("");
}

const ago = (iso?: string) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 120 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`;
};
const mb = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${(n / 1e6).toFixed(1)} MB`);

export function backupPanel(b: BackupStatus | null, err: string | null): string {
  const row = (label: string, s: { at: string; size_bytes: number } | null) => `<tr><td>${label}</td><td>${s ? `${ago(s.at)}, ${mb(s.size_bytes)}` : '<b style="color:var(--red)">NONE</b>'}</td></tr>`;
  return `<h2>Backups</h2><div class="card ${err || !b || !b.files ? "red" : "green"}">${err ? `<div class="todo">${esc(err)}</div>` : ""}<div class="tbl"><table>${row("Files", b?.files ?? null)}${row("Database log (WAL)", b?.wal ?? null)}${row("Database base copy", b?.base ?? null)}<tr><td>Restore check</td><td>${b?.drill ? `${esc(b.drill.result.toUpperCase())}, ${ago(b.drill.at)}` : '<b style="color:var(--red)">NEVER RUN</b>'}</td></tr></table></div><div class="row"><button data-post="/ops/backups/run">Back up now</button><button class="sec" data-post="/ops/backups/verify">Check backups now</button></div></div>`;
}

export function dashboard(o: { snap: Snapshot; releases: string[]; current: string | null; alertChannel: string }): string {
  const rel = o.releases.length
    ? o.releases.map((t) => `<div class="row" style="align-items:center"><span><b>${esc(t)}</b>${t === o.current ? " (running now)" : ""}</span><button class="danger" data-post="/ops/releases/${esc(t)}/rollback" data-confirm="ROLLBACK" data-what="Go back to release ${esc(t)}. A safety copy is taken first. Your data is not touched.">Go back to this</button></div>`).join("")
    : `<p class="mute">No earlier releases are stored on this box yet. After the next release is built there will be buttons here.</p>`;
  return page("Ops desk", `<h1>E-Paper Desk, ops</h1><div id="lights">${lightsFragment(o.snap)}</div>
<h2>Fix everything</h2><div class="card"><div class="row"><button data-post="/ops/up">Bring everything up</button><button class="sec" data-post="/ops/restart-all">Restart everything (in order)</button></div><p class="mute">Both are safe to press twice. They wait until each part is healthy.</p></div>
${backupPanel(o.snap.backup, o.snap.backupError)}
<h2 id="restore">Go back in time</h2><div class="card"><p class="mute">Builds a second copy beside the live one. Nothing is replaced until you press Switch.</p>
<form id="dbForm" data-nosubmit="1"><label>Database as it was at<input type="datetime-local" name="to"></label></form><div class="row"><button class="danger" data-form="dbForm" data-post="/ops/db/restore" data-confirm="RESTORE" data-what="Build a copy of the database at that time. The live one stays as it is.">Build the copy</button></div>
<form id="swForm" data-nosubmit="1"><label>Copy id (filled in after building)<input id="restoreId" name="id"></label></form><div class="row"><button class="danger" id="switchBtn" data-post="/ops/db/restore/SWITCH/switch" data-confirm="SWITCH" data-what="Make the restored copy the live database. The old one is kept for 7 days.">Switch to the copy</button></div>
<form id="fForm" data-nosubmit="1"><label>Files: what<select name="scope"><option value="file">One file</option><option value="edition">One edition</option><option value="all">Everything</option></select></label><label>As they were at<input type="datetime-local" name="at"></label></form><div class="row"><button class="danger" data-form="fForm" data-post="/ops/files/restore" data-confirm="RESTORE" data-what="Bring files back as they were. Nothing is overwritten.">Bring files back</button></div></div>
<h2>Earlier releases</h2><div class="card">${rel}</div>
<h2>Phone alerts</h2><div class="card ${o.alertChannel === "telegram" ? "green" : "red"}">${o.alertChannel === "telegram" ? "Alerts go to Telegram." : "<b>Alerts do NOT reach your phone.</b> Telegram is not set up, so they are only written to a file. Ask for ALERT_TELEGRAM_TOKEN and ALERT_TELEGRAM_CHAT to be set."}<div class="row"><button class="sec" data-post="/ops/alerts/test">Send a test alert</button></div></div>
`);
}

export const logsPage = (name: string, text: string, tail: number) => page(`Log ${name}`, `<h1>Log: ${esc(name)}</h1><p class="mute">Last ${tail} lines. Passwords and keys are hidden.</p><div class="row"><a class="btn sec" href="/logs/${esc(name)}?tail=${tail}">Refresh</a><a class="btn sec" href="/logs/${esc(name)}?tail=${tail * 2}">Show more</a></div><pre>${esc(text || "(empty)")}</pre>`);

export const diskPage = (items: ClearItem[], total: number) => page("Free disk space", `<h1>Free disk space</h1><p>This removes only copies that can be made again. <b>Originals and backups are never touched.</b></p><div class="card">${items.length ? `<table>${items.map((i) => `<tr><td>${esc(i.path)}<div class="mute">${esc(i.what)}</div></td><td>${mb(i.bytes)}</td></tr>`).join("")}</table><p><b>Total about ${mb(total)}</b>, plus Docker's build cache.</p>` : "<p>No old copies found. Docker's build cache will still be cleared.</p>"}<div class="row"><button class="danger" data-post="/ops/disk/clear" data-confirm="CLEAR" data-what="Remove the listed copies and Docker's build cache.">Free the space</button></div></div>`);

export const historyPage = (rows: { at: string; who: string; action: string; target?: string; result: string; note?: string }[]) => page("History", `<h1>Who pressed what</h1><div class="tbl"><table><tr><th>When</th><th>Who</th><th>What</th><th>Result</th></tr>${rows.map((r) => `<tr><td>${esc(r.at.replace("T", " ").slice(0, 19))}</td><td>${esc(r.who)}</td><td>${esc(r.action)} ${esc(r.target ?? "")}</td><td>${esc(r.result)}${r.note ? `<div class="mute">${esc(r.note)}</div>` : ""}</td></tr>`).join("")}</table></div>`);

export const buildPage = (inner: string) => page("Build clock", `<h1>Build clock</h1>${inner}`);
export const errorPage = (msg: string) => page("Problem", `<h1>Something is not right</h1><div class="card red">${esc(msg)}</div><div class="row"><a class="btn" href="/">Back to the desk</a></div>`);
