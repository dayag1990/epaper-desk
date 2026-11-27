import { topBarHtml } from "@epaper/theme/html";
import type { AppLinks } from "@epaper/theme";
import type { ServiceStatus, Snapshot } from "./health.js";
import { esc } from "./md.js";
import type { BackupStatus } from "./backup.js";
import type { ClearItem } from "./fixes.js";
import type { AlertRecord } from "./alertlog.js";

/** What every page needs around its body: the shared top bar (who is signed in, links to the other apps) and which tab is lit. */
export interface Chrome {
  links: AppLinks;
  user?: { name: string; email?: string } | null;
  active?: "desk" | "alerts" | "history" | "build";
  /** If set, the page quietly signs the browser out of the API too (a no-cors POST); the desk never waits for it. */
  apiLogoutUrl?: string;
}

const SUBNAV: [NonNullable<Chrome["active"]>, string, string][] = [["desk", "/", "Desk"], ["alerts", "/alerts", "Alerts"], ["history", "/history", "History"], ["build", "/ops/build", "Build clock"]];

const page = (title: string, body: string, c: Chrome, signedIn = true) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="theme-color" content="#F4EFE6"><title>${esc(title)}</title><link rel="stylesheet" href="/assets/theme.css"><link rel="stylesheet" href="/assets/app.css"></head><body class="ep-app"${c.apiLogoutUrl ? ` data-signout="${esc(c.apiLogoutUrl)}"` : ""}>${topBarHtml({ app: "ops", links: c.links, user: signedIn ? c.user ?? { name: "Owner" } : null, isOwner: true, bell: signedIn, signOutHref: "/logout" })}<main>${signedIn ? `<nav class="ep-tabs" aria-label="Desk pages">${SUBNAV.map(([k, href, label]) => `<a class="ep-tab"${c.active === k ? ' aria-current="page"' : ""} href="${href}">${label}</a>`).join("")}</nav>` : ""}${body}</main><div id="toast" role="status"></div>
<dialog id="confirmDlg"><form method="dialog"><p id="confirmWhat"></p><p>Type <b id="confirmWord"></b> to go ahead.</p><input id="confirmInput" autocomplete="off" autocapitalize="characters"><div class="row"><button value="go" class="fix">Go ahead</button><button value="no" class="sec" formnovalidate>Cancel</button></div></form></dialog>
<script src="/assets/app.js"></script>${signedIn ? '<script type="module" src="/assets/boot.js"></script>' : ""}</body></html>`;

export const loginPage = (c: Chrome, msg?: string, sso?: { email: string } | "none" | null) => page("Ops desk login", `<h1>Ops desk</h1>${msg ? `<div class="card red"><b>${esc(msg)}</b></div>` : ""}${sso && sso !== "none" ? `<div class="card"><p>You are signed in to the newsroom apps as <b>${esc(sso.email)}</b>.</p><div class="row"><a class="btn fix" href="/stepup">Continue with this login</a></div></div><p class="mute">Or use the desk's own login below (it works even when the editor is down).</p>` : ""}<form method="post" action="/login"><label>Password<input type="password" name="password" autocomplete="current-password" required></label><label>6-digit code from your phone app (or a backup code)<input name="code" inputmode="text" autocomplete="one-time-code" required></label><div class="row"><button>Log in</button></div></form>${sso === "none" ? `<p class="mute">Already signed in to the editor? Open the editor, sign in there, then come back here and reload this page: the desk will then only ask for your 6-digit code.</p>` : ""}`, c, false);

/** The one extra step after the newsroom login: only the 6-digit code. */
export const stepUpPage = (c: Chrome, email: string, msg?: string) => page("Ops desk: one more step", `<h1>One more step</h1>${msg ? `<div class="card red"><b>${esc(msg)}</b></div>` : ""}<p>You are signed in as <b>${esc(email)}</b>. The ops desk can change and restore things, so it asks for your 6-digit code once.</p><form method="post" action="/stepup"><label>6-digit code from your phone app (or a backup code)<input name="code" inputmode="text" autocomplete="one-time-code" required autofocus></label><div class="row"><button class="fix">Open the desk</button><a class="btn sec" href="/login?own=1">Use the desk's own login</a></div></form>`, c, false);

export const setupPage = (c: Chrome, msg?: string) => page("Ops desk setup", `<h1>First-time setup</h1><p>Make the one login for this desk.</p>${msg ? `<div class="card red"><b>${esc(msg)}</b></div>` : ""}<form method="post" action="/setup"><label>Setup code (from the server settings)<input name="setup" required autocomplete="off"></label><label>Choose a password (12 or more characters)<input type="password" name="password" minlength="12" required autocomplete="new-password"></label><div class="row"><button>Continue</button></div></form>`, c, false);

export const setupStep2 = (c: Chrome, secret: string, uri: string, codes: string[], msg?: string) => page("Ops desk setup", `<h1>Step 2: link your phone</h1>${msg ? `<div class="card red"><b>${esc(msg)}</b></div>` : ""}<p>1. Tap this to open your authenticator app: <a class="btn" href="${esc(uri)}">Add to authenticator</a></p><p>Or type this key into the app by hand:</p><p class="codes">${esc(secret)}</p><h2>2. Save these backup codes now</h2><p><b>They are shown only this once.</b> Each works one time if you lose your phone. Screenshot them or write them down.</p><p class="codes">${codes.map(esc).join("<br>")}</p><form method="post" action="/setup/confirm"><label>3. Type the 6-digit code your app shows now<input name="code" inputmode="numeric" autocomplete="one-time-code" required></label><div class="row"><button>Finish setup</button></div></form>`, c, false);

const FIX_LABEL: Record<string, string> = {
  restart: "Fix it (restart)", retry_jobs: "Retry failed jobs", clear_disk: "Free disk space", run_now: "Back up now", verify_now: "Check backups now", restart_all: "Restart everything",
};

function card(s: ServiceStatus): string {
  const b: string[] = [];
  for (const f of s.fixes) {
    if (f === "restart") b.push(`<button class="${s.state === "red" ? "fix" : ""}" data-post="/ops/services/${esc(s.name)}/restart">${s.state === "red" ? "Fix it (restart)" : "Restart"}</button>`);
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
  const mark = { green: "\u2713", amber: "\u25B2", red: "\u25A0" }[s.state];
  return `<div class="card ${s.state}"><h3><span class="dot ${s.state}" aria-hidden="true">${mark}</span>${esc(s.title)}: ${word}</h3><div>${esc(s.plain)}</div>${s.todo ? `<div class="todo">What to do: ${esc(s.todo)}</div>` : ""}<div class="mute">${s.state === "green" ? "Fine" : "Like this"} since ${esc(s.since)}</div>${b.length ? `<div class="row">${b.join("")}</div>` : ""}</div>`;
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
  const row = (label: string, s: { at: string; size_bytes: number } | null) => `<tr><td>${label}</td><td>${s ? `${ago(s.at)}, ${mb(s.size_bytes)}` : '<b class="bad">NONE</b>'}</td></tr>`;
  return `<h2>Backups</h2><div class="card ${err || !b || !b.files ? "red" : "green"}">${err ? `<div class="todo">${esc(err)}</div>` : ""}<div class="tbl"><table>${row("Files", b?.files ?? null)}${row("Database log (WAL)", b?.wal ?? null)}${row("Database base copy", b?.base ?? null)}<tr><td>Restore check</td><td>${b?.drill ? `${esc(b.drill.result.toUpperCase())}, ${ago(b.drill.at)}` : '<b class="bad">NEVER RUN</b>'}</td></tr></table></div><div class="row"><button data-post="/ops/backups/run">Back up now</button><button class="sec" data-post="/ops/backups/verify">Check backups now</button></div></div>`;
}

export function dashboard(o: { snap: Snapshot; releases: string[]; current: string | null; alertChannel: string }, c: Chrome): string {
  const rel = o.releases.length
    ? o.releases.map((t) => `<div class="row center"><span><b>${esc(t)}</b>${t === o.current ? " (running now)" : ""}</span><button class="danger" data-post="/ops/releases/${esc(t)}/rollback" data-confirm="ROLLBACK" data-what="Go back to release ${esc(t)}. A safety copy is taken first. Your data is not touched.">Go back to this</button></div>`).join("")
    : `<p class="mute">No earlier releases are stored on this box yet. After the next release is built there will be buttons here.</p>`;
  return page("Ops desk", `<h1>E-Paper Desk, ops</h1><div id="lights">${lightsFragment(o.snap)}</div>
<h2>Fix everything</h2><div class="card"><div class="row"><button data-post="/ops/up">Bring everything up</button><button class="sec" data-post="/ops/restart-all">Restart everything (in order)</button></div><p class="mute">Both are safe to press twice. They wait until each part is healthy.</p></div>
${backupPanel(o.snap.backup, o.snap.backupError)}
<h2 id="restore">Go back in time</h2><div class="card"><p class="mute">Builds a second copy beside the live one. Nothing is replaced until you press Switch.</p>
<form id="dbForm" data-nosubmit="1"><label>Database as it was at<input type="datetime-local" name="to"></label></form><div class="row"><button class="danger" data-form="dbForm" data-post="/ops/db/restore" data-confirm="RESTORE" data-what="Build a copy of the database at that time. The live one stays as it is.">Build the copy</button></div>
<form id="swForm" data-nosubmit="1"><label>Copy id (filled in after building)<input id="restoreId" name="id"></label></form><div class="row"><button class="danger" id="switchBtn" data-post="/ops/db/restore/SWITCH/switch" data-confirm="SWITCH" data-what="Make the restored copy the live database. The old one is kept for 7 days.">Switch to the copy</button></div>
<form id="fForm" data-nosubmit="1"><label>Files: what<select name="scope"><option value="file">One file</option><option value="edition">One edition</option><option value="all">Everything</option></select></label><label>As they were at<input type="datetime-local" name="at"></label></form><div class="row"><button class="danger" data-form="fForm" data-post="/ops/files/restore" data-confirm="RESTORE" data-what="Bring files back as they were. Nothing is overwritten.">Bring files back</button></div></div>
<h2>Earlier releases</h2><div class="card">${rel}</div>
<h2>Phone alerts</h2><div class="card ${o.alertChannel === "telegram" ? "green" : "red"}">${o.alertChannel === "telegram" ? "Alerts go to Telegram." : "<b>Alerts do NOT reach your phone.</b> Telegram is not set up, so they are only written to a file. Ask for ALERT_TELEGRAM_TOKEN and ALERT_TELEGRAM_CHAT to be set."}<div class="row"><button class="sec" data-post="/ops/alerts/test">Send a test alert</button><a class="btn sec" href="/alerts">See every alert</a></div></div>
`, { ...c, active: "desk" });
}

export const logsPage = (name: string, text: string, tail: number, c: Chrome) => page(`Log ${name}`, `<h1>Log: ${esc(name)}</h1><p class="mute">Last ${tail} lines. Passwords and keys are hidden.</p><div class="row"><a class="btn sec" href="/logs/${esc(name)}?tail=${tail}">Refresh</a><a class="btn sec" href="/logs/${esc(name)}?tail=${tail * 2}">Show more</a></div><pre>${esc(text || "(empty)")}</pre>`, { ...c, active: "desk" });

export const diskPage = (items: ClearItem[], total: number, kept: { what: string; reason: string }[], c: Chrome) => page("Free disk space", `<h1>Free disk space</h1><p>This removes only copies that can be made again, safety dumps and restored databases older than 7 days, and never the 2 newest safety dumps. <b>Originals and backups are never touched, and nothing that the off-box bucket does not hold yet.</b></p><div class="card">${items.length ? `<h2>These will be removed</h2><table>${items.map((i) => `<tr><td>${esc(i.path)}<div class="mute">${esc(i.what)}</div></td><td>${mb(i.bytes)}</td></tr>`).join("")}</table><p><b>Total about ${mb(total)}</b>, plus Docker's build cache.</p>` : "<p>No old copies found. Docker's build cache will still be cleared.</p>"}${kept.length ? `<h2>These stay</h2><table>${kept.map((k) => `<tr><td>${esc(k.what)}</td><td class="mute">${esc(k.reason)}</td></tr>`).join("")}</table>` : ""}<div class="row"><button class="danger" data-post="/ops/disk/clear" data-confirm="CLEAR" data-what="Remove the listed copies and Docker's build cache.">Free the space</button></div></div>`, { ...c, active: "desk" });

export const historyPage = (rows: { at: string; who: string; action: string; target?: string; result: string; note?: string }[], c: Chrome) => page("History", `<h1>Who pressed what</h1><div class="tbl"><table><tr><th>When</th><th>Who</th><th>What</th><th>Result</th></tr>${rows.map((r) => `<tr><td>${esc(r.at.replace("T", " ").slice(0, 19))}</td><td>${esc(r.who)}</td><td>${esc(r.action)} ${esc(r.target ?? "")}</td><td>${esc(r.result)}${r.note ? `<div class="mute">${esc(r.note)}</div>` : ""}</td></tr>`).join("")}</table></div>`, { ...c, active: "history" });

export const buildPage = (inner: string, c: Chrome) => page("Build clock", `<h1>Build clock</h1>${inner}`, { ...c, active: "build" });
export const errorPage = (msg: string, c: Chrome, signedIn = true) => page("Problem", `<h1>Something is not right</h1><div class="card red">${esc(msg)}</div><div class="row"><a class="btn" href="/">Back to the desk</a></div>`, c, signedIn);

const when = (iso: string) => esc(iso.replace("T", " ").slice(0, 19));
const KIND: Record<AlertRecord["kind"], string> = { fired: "Started", reminder: "Still broken", resolved: "Fixed", test: "Test" };
/** The ops desk's own alert list: every alert that was sent, once, newest first. */
export const alertsPage = (rows: AlertRecord[], channel: string, c: Chrome) => page("Alerts", `<h1>Alerts</h1><p class="mute">${channel === "telegram" ? "Every alert is also sent to Telegram." : "Telegram is not set up (WAITING ON OWNER), so alerts are shown here and written to the alerts file."} Each one appears once.</p>${rows.length ? `<div class="tbl"><table data-testid="alert-list"><tr><th>When (UTC)</th><th>What</th><th>State</th></tr>${rows.map((r) => `<tr data-alert-id="${esc(r.id)}"><td>${when(r.at)}</td><td><b>${esc(r.title)}</b><div>${esc(r.text)}</div></td><td><span class="ep-badge ${r.kind === "fired" || r.kind === "reminder" ? "alert" : r.kind === "resolved" ? "ok" : ""}">${KIND[r.kind]}</span></td></tr>`).join("")}</table></div>` : `<div class="card green">Nothing has gone wrong lately.</div>`}`, { ...c, active: "alerts" });
