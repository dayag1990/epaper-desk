# E-Paper Desk: standing rules for the build agent

This file is for the build session on the project server.
Any other session: read it, do not act on it.

## What you are building

Any website's articles → editable newspaper pages → IDML for InDesign → final PDF → tappable e-paper.
Many papers, any language, new sites plug in by configuration.

One requirement outranks every feature:
**the owner must be able to fix any breakage alone, from the ops desk, at any hour, without losing data.**

## Read in this order

1. This file, fully.
2. `epaper-desk-architecture.svg`. Open it as text. The JSON inside `<metadata id="build-spec">` is the whole spec; the drawing repeats it for people. Extract it once to `docs/build-spec.json` and work from that.
3. `epaper-desk-prototype.html`. A working single-file editor. Its first comment (PORT MAP) says which function moves to which module. Port it. Do not rewrite it.

## The deal

- The clock starts when the owner writes **build**.
- Your first action: create `STATUS.md` with the start time and the deadline (start + 72 h), both in UTC and IST.
- In scope: every module marked BUILD NOW or PART-BUILT (M0–M10, M12, M13). M11 is PHASE 2 and out of scope.
- M3 AI assist is optional for this demo. Build M3 last, only if `ANTHROPIC_API_KEY` is set and time remains. If M3 is skipped, demo beat 3 becomes: edit a headline live, the page refits.
- The demo is due at start + 48 h (owner's target). The contract deadline stays start + 72 h. Follow "48-hour plan" below.

## AI is optional and OFF by default

- Every AI feature (LLM calls, ML models, AI cut-out) ships switched OFF. It turns on only when its key or model is present AND an admin switches it on.
- The full pipeline runs on rule-based automation alone, with no API key: ingest, mapping, auto-plan, layout, fit, refit, cut-out, IDML, PDF, e-paper, reader, ops desk.
- Each AI feature has a rule-based path that does the same job: headline fit by rules (trim, condense, size step-down), the cut-out by manual crop, mapping by selectors. AI only adds extras on top.
- No AI call sits on the critical path. Timeout, error, missing key or exhausted credit: fall back to the rule path silently, log it, never block a page.
- Tests run the whole pipeline with no key set. A test that needs a key is marked optional and never gates "done".
- Demo content: English articles first (beats 1–7), then the client's ContentXML sample in `fixtures/blinkcms-poc.cxml` (beat 8).
- Finished means all four:
  1. Every in-scope module passes its `done_when` list, as automated tests wherever a test can check it.
  2. The 8 demo beats (`demo_path`) run end to end with no terminal in sight.
  3. Every M13 break-it drill is fixed from the ops desk with nothing lost.
  4. The owner fixes a planted fault alone, from a phone.
- A true red in `STATUS.md` is worth more than a false green. Never report a check as passed unless you ran it and saw it pass.

## Hour budget

| Hours | Block | Modules | Exit check |
|---|---|---|---|
| 0–8 | Floor + safety net | M0 · M13 | The first restore drill passes |
| 8–32 | Three tracks | A: M1 M2 · B: M4 M5 M7 M6 · C: M8 M9 M10 | Every track check is green |
| 32–44 | Join | wires 1 → 14 | Beats 1, 2, 5, 6, 7, 8 run |
| 44–54 | Assist + console | M3 · M12 · M13 | All 8 beats run |
| 54–64 | Break-it drills | every `done_when` list | Every drill fixed, nothing lost |
| 64–72 | Rehearsal + hand-over | the demo | The owner fixes a planted fault alone |

No feature work starts before the 0–8 exit check passes. (Overridden by the 48-hour plan below.)

## 48-hour plan (owner instruction, replaces the hour budget order)

| Hours | Block | Exit check |
|---|---|---|
| 0–4 | Floor: M0, contracts D1–D5 + D9 in zod, toolchain proof, local snapshot script | Stack boots; a snapshot + restore of an empty DB works |
| 4–26 | Demo path: M1 English ingest → M4 auto-plan → M5 edit + refit → M2 photo + cut-out → M6 IDML → M7 PDF → M8 e-paper → M9 reader → M10 tap-through | Beats 1–7 run (beat 3 without AI) |
| 26–34 | Ops desk + admin: M13 desk, M12 console, beat 8 (ContentXML) | All 8 beats run; desk fixes a stopped service |
| 34–44 | Hardening: off-box backups, every M13 drill, `restore.sh` on an empty box | Every drill fixed, nothing lost |
| 44–48 | Rehearsal + hand-over; M3 only if a key exists and time remains | The owner fixes a planted fault alone |

M13 is moved later, never cut. A snapshot before every destructive step still applies from hour 0.
Independent modules run in parallel as sub-agents in separate git worktrees.
Details for every block: `clock_72h` in the spec.

## Closed decisions (do not reopen)

- TypeScript monorepo on pnpm.
- Postgres is the only database. The job queue lives inside it (pg-boss). No Redis.
- Files on local disk, named by content hash, written once. S3 driver optional. No MinIO.
- Backups: WAL-G for Postgres and restic for files, to an S3 bucket off the box.
- State lives only in Postgres and the files folder. About to keep state anywhere else? Stop and move it.
- One renderer: HTML + CSS in Chromium, for the editor and the server.
- InDesign hand-off is IDML. No InDesign Server.
- E-paper is built from the final PDF whenever one exists.
- The ops desk is its own service. It never depends on the API, the worker or Postgres.

If a closed decision proves impossible: write the evidence under DECISION NEEDED in `STATUS.md`, take the smallest workaround that keeps every contract and every M13 target, and carry on. The targets are the contract; a tool may change only if every M13 drill still passes.

## Dedicated server: the Contabo VPS

This build runs on its own Contabo VPS (EU, x86_64, Ubuntu 24.04): 8 vCPU, 23 GB RAM (24 GB sold, 23 GiB usable), 145 GB disk, 8 GB swap.
Nothing else runs on it. There is no co-tenant to protect, so use the whole box.

Setup:
- Linux user `epaper`, in the `sudo` group. Folder `/srv/epaper`. Work there.
- Normal (rootful) Docker Engine + Compose plugin, installed from Docker's apt repo with sudo. Add `epaper` to the `docker` group. No rootless Docker.
- `/srv/epaper/.env` (chmod 600) with the keys listed below.
- Reverse proxy with TLS on 80/443: `app.` → `127.0.0.1:8100`, `ops.` → `127.0.0.1:8101`, `epaper.` → `127.0.0.1:8102`.

Sudo is allowed, for setup only: packages, Docker, the proxy, the firewall, TLS, unattended upgrades.
- Log every sudo change in `STATUS.md` (one line: what, why) and put the same step in `scripts/restore.sh`, so a new box gets it too.
- The app itself never needs root. Containers run as non-root users. No `privileged`, no host network.
- Anything you cannot do yourself (DNS records, the bucket, the Git repo, provider console): stub it, write it under WAITING ON OWNER, carry on.

Network:
- Bind app containers only to `127.0.0.1:8100` (editor, admin, `/v1` API), `127.0.0.1:8101` (ops desk), `127.0.0.1:8102` (reader, `embed.js`).
- Publicly open: 22 (SSH), 80 and 443 (the proxy). Nothing else. Firewall (ufw) on, default deny incoming.
- Docker publishes ports past ufw. So always write `127.0.0.1:` in every `ports:` entry, and Postgres publishes no port at all.

Resources (the whole box is yours, but keep headroom so the ops desk and SSH always answer):
- All `epaper` containers together: at most 7 CPUs and 19 GB RAM (`cpus`, `mem_limit` in compose). Give the ops desk its own small reserved share so a runaway render can never starve it.
- Chromium renders may run in parallel, up to 4 at a time.
- 8 GB swap file at `/swapfile`, in `/etc/fstab`, `vm.swappiness=10` (done at hour 0). A memory spike slows the box instead of killing Postgres. `restore.sh` recreates it.
- Stop and report if free disk falls below 20 GB.

`.env` keys (the owner fills the values; never print them):
- `APP_HOST` `OPS_HOST` `READER_HOST`: the three hostnames
- `BACKUP_S3_ENDPOINT` `BACKUP_S3_BUCKET` `BACKUP_S3_KEY` `BACKUP_S3_SECRET`: off-box bucket at a different provider (Cloudflare R2)
- `BACKUP_PASSWORD`: restic and WAL-G encryption. Also stored by the owner in a password manager
- `ALERT_TELEGRAM_TOKEN` `ALERT_TELEGRAM_CHAT`: phone alerts
- `ANTHROPIC_API_KEY`: optional, M3 only
- A missing value is not a blocker: stub, list under WAITING ON OWNER.

Architecture:
- x86_64 (amd64). Pin image tags and digests. In hour 0, prove these run: Postgres, Node, Playwright Chromium, sharp, Poppler, WAL-G, restic.
- Keep images multi-arch where it costs nothing, so the system can still move to an ARM box later.

Ops desk on this box:
- It controls only the `epaper` compose project. It reaches Docker through a socket proxy limited to that project, never the raw socket.
- No back-door port. It is reached through `ops.` only. Login + TOTP.

This is the demo box and may become the client's server after approval. Either way, `scripts/restore.sh` must rebuild everything on a fresh box. Build nothing that only works here.

## Recovery targets (M13)

- Crash, restart, bad release, power cut: nothing saved is lost.
- Dead disk: at most about 1 minute of database writes, 15 minutes of files.
- One service back in 1 minute. A bad release rolled back in 2 minutes. The whole box on new hardware in 60 minutes.
- Every fix button is safe to press twice. Every destructive button snapshots first and asks for a typed confirmation.

## Working rules

- `main` always deploys. Small commits. Push to the private Git remote after every green step.
- No `Co-Authored-By:` lines in commit messages (owner's rule). Sub-agent briefs must say so too.
- Every deploy is a tagged release (`YYYY-MM-DD.N`) so the ops desk can roll back. Keep the last 5.
- Migrations are expand-only: add, never rename or drop in the same release.
- Contracts D1–D5 and D9 are frozen as zod in `packages/core` before module work starts. Add fields freely. Never rename or re-type one.
- Tests first for the contracts and for every `done_when` item a test can check. The fixtures are the truth.
- Tracks A, B and C may run as parallel sub-agents in separate git worktrees. Otherwise interleave one step from each.

## Usage budget (owner is on the Max plan; preserve usage)

- Opus (the lead session): planning, architecture, hard debugging, review, merging. It coordinates every sub-agent.
- Sonnet sub-agents: routine coding, tests, refactors, one module per agent, with a narrow brief and the files it may touch.
- Haiku sub-agents: searches, file reads, log scanning, simple edits.
- Fable: where it fits better, such as writing plain-words copy, `RUNBOOK.md` and owner-facing errors.
- At most 2 background agents run at the same time (owner rule). A third waits in the queue in `STATUS.md` under Next until a slot frees.
- Sub-agents use Sonnet. Haiku for searches, log reads and simple edits. Never an Opus sub-agent.
- Keep context small: summarise, never re-read large files. Read the spec through `docs/build-spec.json` by key, not whole.
- Usage limit hit: write progress to `STATUS.md` first, then wait for the reset and resume from `STATUS.md`.
- Fully autonomous. Do not ask the owner questions. Blockers go under WAITING ON OWNER with the stand-in used.
- Missing input: never stop, never invent. Stub it behind the contract, list it under WAITING ON OWNER, move on.
- Before any destructive command (drop, delete, reset, prune, a risky migration): take a snapshot and note it in `STATUS.md`.
- Secrets live only in `.env`. Never in git, logs, `STATUS.md` or error messages.
- Every error the owner can see is in plain words. It will be read at 2 am on a phone.
- Update `STATUS.md` every hour. The ops desk serves it at `/ops/build`.
- New session after a pause, a usage cap or a crash: read `STATUS.md` first, then continue. Paused hours still count. The deadline does not move.

## STATUS.md format

```
# E-Paper Desk build
Start: <IST> (<UTC>) · Deadline: <IST> (<UTC>) · Hour: 14 of 72 · Block: THREE TRACKS

## Done                (module · the check that passed)
## Doing
## Next
## Blocked
## WAITING ON OWNER    (what · why · what is stubbed meanwhile)
## DECISION NEEDED
## Cut                 (what was cut under the cut order, and when)
## Log                 (one line per hour, newest first)
```

## Pre-flight at hour 0

Check every item in `clock_72h.preflight_owner`: server, DNS, off-box bucket + keys, private Git repo, Claude API key, alert channel, fixtures, the Card Maker cut-out code (`SEG`), the recovery kit entry.
Anything missing goes under WAITING ON OWNER with the stub you used. Do not wait for it.

## When the clock runs short

Cut in this order, top first:

1. SSO token, story landing pages, sitemap (M10 extras)
2. Archive-wide search (search inside one edition stays)
3. Template slot-editor screen (templates stay as files)
4. OCR fallback (text layer + snapshot prior stay)
5. Server cut-out worker (the browser cut-out stays)

Never cut: the contracts · the M13 safety net · the restore drill · the 8 demo beats.
Write every cut under Cut in `STATUS.md`.

## Outside the 72 hours

These need the client or come later. Do not fake them:

- InDesign open-test with the client's own template, fonts and operator
- A press PDF trial at the client's press
- Tuning templates to the client's real pages over live nights
- M11 revenue + analytics, IDML re-import, story jumps
- A second server for zero loss on a dead disk

## Hand-over (hours 64–72)

- `RUNBOOK.md`: one page. What each light means and which button fixes it.
- Recovery kit list: what the owner must keep off the box (bucket keys, backup password, ops login, TOTP backup codes).
- `scripts/restore.sh` proven on an empty machine.
- Final release tagged. `STATUS.md` closed with every red stated plainly.

## Never

- Never mark a module done on a failing or skipped test.
- Never expose the Docker socket to the network.
- Never delete anything in the LIVE Docker project `epaper`, and never prune anything on the Docker host (owner rule, after the 2026-11-23 incident in STATUS.md). That means: no `prune` in any form, no `docker rm`, `rmi`, `volume rm`, `network rm`, no `compose down` (with or without `-v`), no `compose rm`, no `up --force-recreate` / `--remove-orphans` / `-V`, and no HTTP call to the Docker API that does the same (`POST /volumes/prune`, `DELETE ...`). A bare `docker compose` with no `-p` counts as live, because `docker-compose.yml` says `name: epaper`.
  - Tests and drills use throwaway projects only, named `tmp-*`, `test-*` or `drill-*`, and clean up only what they created.
  - `scripts/guard/docker` enforces this: it is installed first on PATH as `docker` (`scripts/guard/install.sh`), it fails closed, and its 68 checks are in `tests/docker-guard.test.ts`. Claude Code settings also deny any command containing a Docker prune. Never bypass either (no `/usr/bin/docker`, no raw socket calls).
  - Every sub-agent brief that touches Docker must repeat this rule.
  - The ops desk's socket proxy must keep `VOLUMES=0` and `SYSTEM=0`, so those routes do not exist. A deploy (`compose up -d --build`) is allowed; it replaces changed containers and never deletes volumes.
  - Removing a live container or volume is done only by the owner, or by the ops desk behind its typed confirmation and snapshot.
- Never make the ops desk reachable without login + TOTP.
- Never touch the off-box backups except through M13's own tools.
- Never scrape a site the paper does not own or have rights to.
- Never invent a client input (template, fonts, page plan, ad rules).

## Honest limits to state at hand-over

- The ops desk lives on the same box. If the box is dead, `restore.sh` on a new box is the fix.
- Zero loss on a dead disk needs a second server.
- The desk fixes services, queues, releases and data. A logic bug present in every kept release still needs a code fix.

## Talking to the owner

Short lines. Plain words. Result first. Costs in rupees.
No commands for the owner to run: do it yourself, or put a button on the ops desk.
