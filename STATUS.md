# E-Paper Desk build
Start: 2026-11-23 22:58 IST (2026-11-23 17:28 UTC) · Demo-ready target: 2026-11-25 22:58 IST (2026-11-25 17:28 UTC) · Contract deadline: 2026-11-26 22:58 IST (2026-11-26 17:28 UTC) · Hour: 0 of 48 · Block: FLOOR

## Done                (module · the check that passed)
- Host · 8 GB swap on, in /etc/fstab, swappiness 10 (swapon --show: 8G)
- Host · Docker 29.10 + Compose 5.8 from Docker's apt repo; `docker run hello-world` as epaper passed
- Host · Node 22.23, pnpm 9.15.4, Poppler 24.02 installed
- Host · ufw on: only 22, 80, 443 open
- Contracts · D1–D6, D9, D10 frozen as zod in packages/core; 27 tests pass, re-run by lead before merge
- M4 · layout engine ported; prototype SAMPLE matches exactly; 15 English → 4 pages in ~1 s; same plan every run; editor vs headless <0.5 % pixels; D4 snapshot valid (12 tests, re-run by lead). NOT YET: Punjabi page 2 overflow check (fonts were missing; Noto Gurmukhi now installed on host — must also go into the images)
- Toolchain · Postgres 17.2, Node 22.12, Playwright 1.49.1 Chromium, sharp 0.33.5, Poppler, qpdf 11.3, WAL-G 3.0.5, restic 0.17.3 all PASS on amd64 (docs/toolchain.md). WAL archiving not yet proven: base backup only
- Fixtures · stand-ins: english-15.json (15 valid D1 articles, re-checked by lead), demo-site, edition-24p.pdf (24 pages, text layer)
- Repo · Co-Authored-By lines stripped from the 3 early commits on main (tree unchanged; backup branch backup/pre-strip)
- Repo · /srv/epaper/desk, git main, D7 folders, spec at docs/build-spec.json
## Doing
- Sub-agent (Sonnet) · M7 screen PDF + ContentXML export (branch m7)
- Sub-agent (Sonnet) · M5 editor, ported tools, live refit, save/versions/locks (branch m5)
- Sub-agent (Sonnet) · M1 connectors + rule-based mapping wizard (branch m1)
- Sub-agent (Sonnet) · M0: compose, Prisma, auth, pg-boss, files, health (branch m0)
- Sub-agent (Sonnet) · M8 e-paper pipeline: PDF → images, text, zones (branch m8)
## Next
- M4 follow-up: auto-plan balances unevenly (one page at 60 % fill); re-check Punjabi overflow with fonts
- Bake Noto fonts (Gurmukhi + Latin) into the render images / templates/fonts
- Merging an agent branch: rebase it onto main first. Old base 46d141a → new 0e09a2f (m0, toolchain); old d985ecf → new b9a7234 (m4, m1). Drop any Co-Authored-By line from the branch's own commits.
- Demo path: M0 → contracts → English ingest → edit/refit → PDF → e-paper
## Blocked
## WAITING ON OWNER    (what · why · what is stubbed meanwhile)
- Hostnames APP_HOST, OPS_HOST, READER_HOST + DNS records · needed for public TLS · stand-in app.localhost, ops.localhost, epaper.localhost
- Off-box bucket: BACKUP_S3_ENDPOINT, _BUCKET, _KEY, _SECRET · backups must leave the box · stand-in: local folder /srv/epaper/backup-standin (ON THE BOX: red until real bucket)
- BACKUP_PASSWORD · a random one was generated into .env; owner must copy it into the password manager from the ops desk once it exists
- Telegram: ALERT_TELEGRAM_TOKEN, ALERT_TELEGRAM_CHAT · phone alerts · stand-in: alerts written to /srv/epaper/files/alerts.log
- ANTHROPIC_API_KEY · optional · AI_ENABLED=false, rule-based paths only
- Private Git remote · push after every green step · stand-in: local commits only
- English demo site URL · beat 1 · stand-in: a local demo site with 15 original articles (fixtures/demo-site)
- Real edition PDF (edition-24p.pdf) · M8 tests · stand-in: a 24-page PDF generated from the stand-in articles
- Card Maker cut-out code (SEG) · M2 · stand-in: manual crop + rule-based background removal
- Recovery kit entry in a password manager · cannot be checked from the box
## DECISION NEEDED
## Cut                 (what was cut under the cut order, and when)
## Log                 (one line per hour, newest first)
- 2026-11-23 · Hour 1 · M4 merged; M7 and M5 started. Running: M0, M1, M5, M7, M8.
- 2026-11-23 · Hour 0–1 · toolchain + fixtures merged; M8 started. Running: M0, M1, M4, M8.
- 2026-11-23 · Hour 0 · contracts merged to main; M4 and M1 agents started.
- 2026-11-23 · Hour 0 · host set up (swap, Docker, Node, firewall); stand-in .env; 3 Sonnet agents started on contracts, M0, toolchain.
- 2026-11-23 17:28 UTC · Hour 0 · owner wrote "build". Clock started. Target: demo-ready at +48 h (owner instruction), contract deadline +72 h.
