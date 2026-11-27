# Forme colours and the joined-up product

One look and one login for the four apps (editor, admin, reader, ops desk). Code: `packages/theme` (look, top bar, toasts, live streams) and `packages/sso` (the shared sign-in cookie). The newspaper page itself keeps its own template colours; only the app chrome around it uses the palette.

## 1. Palette and tokens

| Name | Value | Use |
|---|---|---|
| press black | `#111111` | type, the logo, hard rules, borders |
| newsprint cream | `#F4EFE6` | page backgrounds |
| proof red | `#E63B2E` | accent, **sparingly**: the one primary action on a screen, the active tab marker, error and alert state. Never body text. |
| plate blue | `#1F4FFF` | links, focus ring, secondary (blue) panels |
| ink grey | `#5C5C5C` | secondary text |
| brass gold | `#B08D3C` | small touches only: a rule, a banner edge, the reader's strip line. Never text on cream, never the only carrier of a meaning |

Tints of the six, for surfaces and hairlines: `paper #FBF8F2` (a card on cream), `cream-2 #EBE4D6` (hover, zebra), `stage #CFC7B6` (the desk behind a page in the editor), `line #CBC2AE` (hairlines), `proof-hover #EE5A4E`.

**One colour the palette does not have:** `ok #1B6E3A`, a green for the status lights ("Working") and a "fixed" edge. The ops desk's lights are green, amber, red and the owner's 2 am guide says so; green carries no brand meaning, is always next to the word and a tick, and amber is brass plus the word "Check soon" and a triangle. Colour is never the only signal (every state also has a word and a mark).

Source of truth in code: `packages/theme/src/tokens.ts` (TypeScript) and `packages/theme/theme.css` (CSS custom properties `--press --cream --proof --plate --grey --brass --paper --cream-2 --stage --line --ok` and the meanings `--bg --surface --text --text-2 --link --accent --on-accent --focus`). A test keeps the two identical and fails if the CSS contains any other hex colour.

Usage rules:
- Red text on cream is **not allowed** (it fails AA for normal text). Red is a fill, an edge or a marker. Text on red is press black.
- Primary action = red button with black label, at most one per screen/card (editor: "Approve and lock"; ops: the "Fix it" button on a red light; admin: the submit button).
- The active tab/page/app is marked with a 4 px red underline.
- Links are blue and underlined; on the dark reader stage text is cream (blue fails on black).
- Errors: a red left edge and plain words in black. Never red text.
- Buttons are 44 px high at least; everything works at 360 px.
- Light only (no dark mode). The ops desk used a dark scheme before; it now follows the same newsprint look so the product reads as one.

## 2. Contrast (WCAG AA)

Computed by `packages/theme/src/tokens.ts` (`contrastTable()`); the test `packages/theme/test/theme.test.ts` fails if any listed pair drops below its limit. 4.5:1 for normal text, 3:1 for large text and for UI parts and graphics.

| Pair in use | Colours | Ratio | Needs | Result |
|---|---|---|---|---|
| Body text | `press` on `cream` | 16.49:1 | 4.5:1 (text) | pass |
| Body text on a card | `press` on `paper` | 17.81:1 | 4.5:1 (text) | pass |
| Body text on hover/zebra rows | `press` on `cream2` | 14.93:1 | 4.5:1 (text) | pass |
| Secondary text | `grey` on `cream` | 5.84:1 | 4.5:1 (text) | pass |
| Secondary text on a card | `grey` on `paper` | 6.31:1 | 4.5:1 (text) | pass |
| Secondary text on hover/zebra rows | `grey` on `cream2` | 5.29:1 | 4.5:1 (text) | pass |
| Links | `plate` on `cream` | 5.06:1 | 4.5:1 (text) | pass |
| Links on a card | `plate` on `paper` | 5.47:1 | 4.5:1 (text) | pass |
| Text on a blue secondary panel | `paper` on `plate` | 5.47:1 | 4.5:1 (text) | pass |
| Primary button label (red button) | `press` on `proof` | 4.52:1 | 4.5:1 (text) | pass |
| Alert count in the bell | `press` on `proof` | 4.52:1 | 4.5:1 (text) | pass |
| Text on the dark reader stage | `cream` on `press` | 16.49:1 | 4.5:1 (text) | pass |
| Secondary text on the dark reader stage | `stage` on `press` | 11.24:1 | 4.5:1 (text) | pass |
| Brass on the dark reader stage (small text) | `brass` on `press` | 6.04:1 | 4.5:1 (text) | pass |
| Status word: working | `ok` on `paper` | 5.93:1 | 4.5:1 (text) | pass |
| Red marker (active tab, alert edge) against cream | `proof` on `cream` | 3.65:1 | 3:1 (UI part) | pass |
| Red marker against a card | `proof` on `paper` | 3.94:1 | 3:1 (UI part) | pass |
| Focus ring (blue) against cream | `plate` on `cream` | 5.06:1 | 3:1 (UI part) | pass |
| Input and button borders (black) against cream | `press` on `cream` | 16.49:1 | 3:1 (UI part) | pass |
| Status dot: working | `ok` on `paper` | 5.93:1 | 3:1 (UI part) | pass |

Pairs that are **deliberately not used** (the test asserts they really fail, so nobody "fixes" the rule by accident):

| Pair | Colours | Ratio | Needs | Result |
|---|---|---|---|---|
| Red text on cream (fails for normal-size text) | `proof` on `cream` | 3.65:1 | 4.5:1 (text) | **fail** |
| White-on-red labels (fails for normal-size text) | `paper` on `proof` | 3.94:1 | 4.5:1 (text) | **fail** |
| Brass text on cream | `brass` on `cream` | 2.73:1 | 4.5:1 (text) | **fail** |
| Blue text on press black | `plate` on `press` | 3.26:1 | 4.5:1 (text) | **fail** |

The proof-red button with a black label passes only just (4.52:1); do not lighten the red or shrink the label below 16 px bold.

## 3. The shared top bar

One component, two forms with the same markup and classes (`.ep-top`):
- React: `TopBar` in `@epaper/theme/react` (editor, admin; the reader is Preact and maps `react` to `preact/compat`).
- HTML string: `topBarHtml()` in `@epaper/theme/html` (the ops desk renders HTML on the server).

Contents: logo mark (`packages/theme/logo.svg`, press black) and name; a slot for the paper name and the paper switcher where the app has one (editor, admin); links Editor / Admin / Reader / Ops desk (the ops link and the alert bell are shown **only to owners**); the signed-in person and Sign out; the alert bell with the unread count. The current app has the red marker. Where the other apps live is worked out from the address (`resolveLinks`: same host and ports 8100/8101/8102, or `app.`/`ops.`/`epaper.` on a domain) and can be forced with `window.__EPAPER_LINKS__` or `OPS_LINK_EDITOR|ADMIN|READER` on the desk.

Toasts (`ToastHost`, and `mountAlerts` for the ops desk) slide in at the top right: plain-words title and text, **Dismiss**, **Open in ops desk**. A red alert stays until dismissed; "fixed" and test notes go away after 10 s.

## 4. One login (SSO)

Account database = the API's users. No second user list.

```
 editor / admin ──POST /v1/auth/login──▶ API
                                        │  sets  epaper_session   (the API's own session, 14 days, HttpOnly, Lax)
                                        │  sets  epaper_sso       (signed statement, 12 h, HttpOnly, Lax, Path=/)
                                        ▼
 browser keeps both cookies (cookies are shared across ports on one host; with SSO_COOKIE_DOMAIN, across sub-domains)

 ops desk, no ops session yet:
   GET /   ── epaper_sso valid + owner? ──▶ /stepup  "One more step: your 6-digit code"
                                              │ POST code (TOTP or a backup code; same lock-out and "a code works once" rules)
                                              ▼
                                         ops_session (12 h) that REMEMBERS which sign-in it rests on
   every later request: session ok AND the same epaper_sso still present, else back to the login page
```

The cookie `epaper_sso` is `base64url(JSON claims) "." base64url(HMAC-SHA256(SSO_SECRET, claims))`. Claims: `uid`, `email`, `owner` (owns at least one paper), `exp` (12 h). The ops desk checks it **without calling the API or Postgres**. It accepts it only for owners (and, if `OPS_OWNER_EMAILS` is set, only for those addresses). The 6-digit code is the second factor, asked once per ops session; enrolment (setup code, password, authenticator, backup codes) is unchanged.

- **Break glass:** the desk's own login (password + code) always works, with the API or Postgres down or `SSO_SECRET` unset. Its sessions do not depend on any cookie of the API.
- **Sign out anywhere signs out everywhere.** API logout (`POST /v1/auth/logout`) revokes the session and clears `epaper_sso` and `ops_session`. Desk logout (`GET /logout`) clears `ops_session`, `epaper_sso` and `epaper_session` (one cookie jar on one host) and the login page then calls the API's logout in the background (a fire-and-forget request; the desk never waits for it). A desk session made through the newsroom login ends as soon as the shared cookie is gone. A break-glass desk session is only ended by the desk itself or the API logout on the same host.
- **Refresh:** `GET /v1/me` hands out a new `epaper_sso` when it is missing or has under 6 h left, so people who work all day are not asked again.
- **Honest limits:** the cookie is a bearer statement for 12 h. Removing a person or revoking their API session elsewhere does not reach the desk before it expires (the desk cannot ask the API; that is the point). The shared secret signs everybody: keep it only in `.env`. A paper owner of any paper counts as an "owner" for the desk; use `OPS_OWNER_EMAILS` to narrow it to the real owner. Everyone shares the desk's one TOTP secret.
- Env vars: `SSO_SECRET` (API and ops), `SSO_COOKIE_DOMAIN`, `OPS_OWNER_EMAILS`, `OPS_APP_ORIGINS`. See `docs/RUNBOOK.md`.

## 5. Live updates without refresh (editor and reader)

```
 API route / worker job
   1. write the row (Postgres)
   2. SELECT pg_notify('epaper_events', '{"type":..., "paper_id":...}')      ← AFTER the write; failure never fails the save
                              │
                              ▼  LISTEN epaper_events (one connection per API process; reconnects with 1..30 s back-off,
                              │  and tells every screen to "resync" when it comes back)
                       EventHub.dispatch ──▶ per-paper subscribers
                              │
        GET /v1/events (signed in, this paper)      GET /v1/public/papers/:slug/events (public: published/updated only)
                              │                                     │
                           editor                                 reader
```

| Event | Sent by | Carries |
|---|---|---|
| `page.updated` | API after save, approve, restore; worker when the fit changes the text size | `page_id, edition_id, rev, fill, status, by` |
| `page.fit` | worker when a measure finishes | `page_id, edition_id, rev, fill, state (ok/low/over), overflow` |
| `edition.changed` | API after a page is deleted, worker after auto-plan | `edition_id` |
| `edition.exported` | worker when an export (PDF, ContentXML, IDML) or the e-paper build finishes or fails | `export_id, edition_id, format, status` |
| `edition.published` / `edition.updated` | API on publish and rollback, worker on scheduled publish and page replacement | `ep_edition_id, edition_id, date, version` |

Client (`openStream` in `packages/theme/src/live.ts`): `EventSource` with credentials, reconnect with back-off, and if the stream is blocked or down it **polls every 15 s** (editor: `refreshFromServer()`, reader: re-reads the edition). Caddy passes the streams unbuffered (`flush_interval -1`); the service worker never touches `/events`.

Editor rule: **never overwrite unsaved work.** A page nobody here touched is replaced quietly (and its tab shows the new fill %). A page with unsaved changes only gets a banner: "Someone changed this page. Your changes here are not saved over theirs. [Reload to compare]"; the button opens the same both-versions choice as a save conflict. The reader reloads the open edition's pages and says "This edition was updated" while staying on the page being read.

## 6. One alerts stream

```
 ops desk alert engine (apps/ops/src/alerts.ts, works with no Postgres/API; looks every 15 s)
        │  each change: <alert>@<start>:fired | :remind:<t> | :resolved   (the id is stable)
        ▼
 AlertHub.emit(id, ...)   (apps/ops/src/alertlog.ts)   ← the ONLY place that fans out; an id already taken does nothing
   1. append to _ops/alerts.jsonl                 ─▶ the desk's Alerts page and GET /ops/alerts
   2. push to open streams  GET /ops/alerts/stream ─▶ bell + toast in editor, admin, reader (owners) and on the desk
   3. phone channel: Telegram, else alerts.log    (Telegram keys not set yet: WAITING ON OWNER)
```

The stream is authenticated with the desk session or the shared `epaper_sso` cookie (owners only) and has CORS only for the known app origins (`OPS_APP_ORIGINS`) with credentials. A page that reconnects gets `snapshot` (recent and still-firing alerts); the feed in the browser (`AlertFeed`) takes each id once, so one alert is one toast, one bell count, one list row, one Telegram message. The `alerts` test (`apps/ops/test/alerts-stream.test.ts`) fires one alert and checks the three consumers see it exactly once, also after a reconnect.

## 7. Motion

Everything uses `--motion: 180ms ease-out`. Buttons, tabs, the fill bar and the chip colours ease; panels, modals, notes and toasts slide or fade in. In the editor, blocks glide to their new place and size on a refit, a move or a resize (`apps/editor/src/motion.ts`, a FLIP animation on the blocks of the rendered page; the paper CSS is untouched). No glide while a drag is in progress, while someone types (900 ms quiet), when the set of blocks differs (another page) and, above all, when the person's system asks for **reduced motion**: then nothing animates anywhere.

## 8. Where things are

| What | Where |
|---|---|
| Tokens, CSS, logo, top bar, toasts, streams, alert feed | `packages/theme` (`src/tokens.ts`, `theme.css`, `logo.svg`, `src/react.tsx`, `src/html.ts`, `src/live.ts`, `src/vanilla.ts`) |
| Signed sign-in cookie | `packages/sso`, used by `apps/api/src/sso.ts` and `apps/ops/src/app.ts` |
| Events | `apps/api/src/events.ts`, `apps/api/src/routes/events.ts`, `apps/worker/src/events.ts` |
| Alerts | `apps/ops/src/alertlog.ts`, `apps/ops/src/alerts.ts` |
| Editor live + motion | `apps/editor/src/store.ts` (`onLive`), `apps/editor/src/motion.ts` |
