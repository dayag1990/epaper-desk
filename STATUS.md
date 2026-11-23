# E-Paper Desk build
Start: 2026-11-23 22:58 IST (2026-11-23 17:28 UTC) · Demo-ready target: 2026-11-25 22:58 IST (2026-11-25 17:28 UTC) · Contract deadline: 2026-11-26 22:58 IST (2026-11-26 17:28 UTC) · Hour: 0 of 48 · Block: FLOOR

## Done                (module · the check that passed)
- Host · 8 GB swap on, in /etc/fstab, swappiness 10 (swapon --show: 8G)
- Host · Docker 29.10 + Compose 5.8 from Docker's apt repo; `docker run hello-world` as epaper passed
- Host · Node 22.23, pnpm 9.15.4, Poppler 24.02 installed
- Host · ufw on: only 22, 80, 443 open
- Contracts · D1–D6, D9, D10 frozen as zod in packages/core; 27 tests pass, re-run by lead before merge
- Repo · /srv/epaper/desk, git main, D7 folders, spec at docs/build-spec.json
## Doing
- Sub-agent (Sonnet) · M4 layout engine, ported from the prototype (branch m4)
- Sub-agent (Sonnet) · M1 connectors + rule-based mapping wizard (branch m1)
- Sub-agent (Sonnet) · M0: compose, Prisma, auth, pg-boss, files, health (branch m0)
- Sub-agent (Sonnet) · toolchain proof + stand-in fixtures (branch toolchain)
## Next
- Before the first push: strip the `Co-Authored-By:` lines from the early local commits (none pushed yet)
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
- 2026-11-23 · Hour 0 · contracts merged to main; M4 and M1 agents started.
- 2026-11-23 · Hour 0 · host set up (swap, Docker, Node, firewall); stand-in .env; 3 Sonnet agents started on contracts, M0, toolchain.
- 2026-11-23 17:28 UTC · Hour 0 · owner wrote "build". Clock started. Target: demo-ready at +48 h (owner instruction), contract deadline +72 h.
