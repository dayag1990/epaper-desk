# E-Paper Desk build
Start: 2026-11-23 22:58 IST (2026-11-23 17:28 UTC) · Demo-ready target: 2026-11-25 22:58 IST (2026-11-25 17:28 UTC) · Contract deadline: 2026-11-26 22:58 IST (2026-11-26 17:28 UTC) · Hour: 0 of 48 · Block: FLOOR

## Done                (module · the check that passed)
- Backup · files: restic → Backblaze B2 backup + restore, 6 files byte-identical (lead ran it after the owner fixed the key ID). Database half: see DECISION NEEDED, not yet proven
- Host · 8 GB swap on, in /etc/fstab, swappiness 10 (swapon --show: 8G)
- Host · Docker 29.10 + Compose 5.8 from Docker's apt repo; `docker run hello-world` as epaper passed
- Host · Node 22.23, pnpm 9.15.4, Poppler 24.02 installed
- Host · ufw on: only 22, 80, 443 open
- Contracts · D1–D6, D9, D10 frozen as zod in packages/core; 27 tests pass, re-run by lead before merge
- M0 · compose stack (postgres, api, worker, ops placeholder, caddy) healthy; ports 127.0.0.1:8100–8102 + public 80/443 only (checked with ss); seed, viewer refused, retry×3 → dead-letter, paper isolation, stop/start keeps rows+files+jobs (11 tests, re-run by lead)
- M1 · cxml/rss/wordpress/scrape/push adapters; BlinkCMS → 9 stories + 1 ad + 7 image refs; rule-based wizard maps 3 unseen sites incl. demo site; re-sync writes nothing; edit bumps rev (30 tests, re-run by lead). NOT YET: cron scheduler, file-drop watcher, /v1/sources (JOIN agent)
- M7 · screen PDF exact page box to 0.1 mm, fonts embedded, text selectable; ContentXML round-trips (6 tests, re-run by lead). NOT YET: press PDF (needs client press profile; stays experimental)
- M8 · 24-page PDF → webp levels + text + D5 zones in ~10 s; 96/96 stories zoned on the stand-in; re-run writes nothing (8 tests, re-run by lead). NOT YET: Punjabi legacy-font PDF, live page replace (JOIN)
- M5 · editor: ported tools, live refit + fill meter, undo, 2 s autosave, 409 conflict view, lock banner, versions + restore, offline drafts, phone width; no AI button with AI off (15 unit + 10 e2e, re-run by lead). Against a MOCK API until JOIN lands. NOT YET: add page (no spec route)
- M6 · IDML: zip layout + well-formed XML checked on every export; frames within 0.1 pt of the snapshot (English + Punjabi); same input → same bytes (10 tests, re-run by lead). NOT YET: opens clean in InDesign, links relink, client styles map, Gurmukhi shaping — need InDesign (owner)
- M9/M10 · reader PWA: thumbnails, swipe, pinch zoom with w400/w1600/w3200 levels, zone tap opens the right story (20/20), search in one edition, offline reopen, embed.js shows cover + opens reader; JS 27 kB (11 kB gzip) (11 unit + 6 e2e, re-run by lead). NOT YET: 4G timing, 360/1440 px, Gurmukhi/Telugu in sheet, HttpSource against the real API. CUT: JWT paywall
- M2 · assets: ingest + derivatives, focal crop, rule-based cut-out 224 ms IoU 0.977 (3000 px: 430 ms, 0.975), provider-down keeps photo usable (18 tests, re-run by lead). NOT YET: 100-URL dedupe run, text wrap in editor, API retry wiring
- JOIN · 12-step English demo with no AI key passes on a fresh stack (wizard → 15 articles → 4 pages → headline edit refits → PDF + ContentXML → e-paper build/publish/webhook → reader zones → page replace + rollback), re-run by lead (57 s). Live stack rebuilt from main, healthy; editor at 8100 /, reader + embed.js at 8102, public read API through 8102. NOT YET: IDML/press/cut-out routes (501), live demo data loaded in the live stack
- All packages · 83 tests pass together on main
- M4 · layout engine ported; prototype SAMPLE matches exactly; 15 English → 4 pages in ~1 s; same plan every run; editor vs headless <0.5 % pixels; D4 snapshot valid (12 tests, re-run by lead). NOT YET: Punjabi page 2 overflow check (fonts were missing; Noto Gurmukhi now installed on host — must also go into the images)
- Toolchain · Postgres 17.2, Node 22.12, Playwright 1.49.1 Chromium, sharp 0.33.5, Poppler, qpdf 11.3, WAL-G 3.0.5, restic 0.17.3 all PASS on amd64 (docs/toolchain.md). WAL archiving not yet proven: base backup only
- Fixtures · stand-ins: english-15.json (15 valid D1 articles, re-checked by lead), demo-site, edition-24p.pdf (24 pages, text layer)
- Repo · Co-Authored-By lines stripped from the 3 early commits on main (tree unchanged; backup branch backup/pre-strip)
- Repo · /srv/epaper/desk, git main, D7 folders, spec at docs/build-spec.json
## Doing
- Sub-agent (Sonnet) · M13 ops desk: login + TOTP, lights, fix buttons, alerts (branch ops)
- Sub-agent (Sonnet) · M12 admin console: sources + wizard, articles, editions, users, webhooks, AI switch (branch m12)
- Sub-agent (Sonnet) · M13 backup: local WAL archive + nightly basebackup + restic to B2 every minute, restore.sh, drill (branch backup)
## Next
- Load the English demo into the LIVE stack and walk beats 1–7 by hand-through-browser (Playwright screenshots); beat 8 (Punjabi cxml)
- apps/reader/dist is built output (gitignored): restore.sh/deploy must run `pnpm --filter @epaper/reader build` before compose up
- M4 follow-up: auto-plan balances unevenly (one page at 60 % fill); re-check Punjabi overflow with fonts
- Bake Noto fonts (Gurmukhi + Latin) into the render images / templates/fonts
- Merging an agent branch: rebase it onto main first. Old base 46d141a → new 0e09a2f (m0, toolchain); old d985ecf → new b9a7234 (m4, m1). Drop any Co-Authored-By line from the branch's own commits.
- Demo path: M0 → contracts → English ingest → edit/refit → PDF → e-paper
## Blocked
## Incidents
- 2026-11-23 18:4x UTC · an unanchored `files/` ignore rule hid apps/api/src/files; removing the m0 worktree deleted it. Restored from the built api image (complete, 1 file), committed, rule anchored to `/files/`. Rule now: check `git status --ignored` before removing any worktree.
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
- InDesign open-test of an exported IDML · no InDesign on the box · validator checks structure only. To check: no repair dialog, Links/ relink, styles map by name, Gurmukhi shaping
- Recovery kit entry in a password manager · cannot be checked from the box
## DECISION NEEDED
- (decided by owner 2026-11-23) WAL-G dropped. Evidence: restic (files) backup+restore to Backblaze B2 works and is byte-identical; WAL-G 3.0.5 reads B2 (backup-list answers) but every write (`st put`, `wal-push`, `backup-push`) hangs, with and without libsodium encryption, last log line "disable 100 continue false"; during Postgres first start wal-push blocks the temporary server's shutdown ("pg_ctl: server does not shut down"). New design, same 1-minute loss target: archive_command copies each WAL segment to a local folder (archive_timeout 30 s), nightly pg_basebackup to a local folder, restic pushes files + WAL folder + basebackups to B2 every minute. Restore = latest basebackup + archived WAL replay.
## Cut                 (what was cut under the cut order, and when)
## Log                 (one line per hour, newest first)
- 2026-11-23 · Hour 4–5 · JOIN merged, live stack rebuilt, reader on 8102; running: ops desk, backup (local WAL + restic), M12 admin. Branch `backup/pre-strip` renamed `archive-pre-strip`.
- 2026-11-23 · Hour 3 · M9, M2 merged; backup test blocked on key ID; lead session switched to Sonnet at the owner's request (Opus for hard debugging/review only).
- 2026-11-23 · Hour 2–3 · M6 merged; M2 started.
- 2026-11-23 · Hour 2 · M5 merged; JOIN told the editor's exact routes.
- 2026-11-23 · Hour 1–2 · M0, M1, M7, M8 merged (83 package tests green on main); stack rebuilt from main; JOIN, M9, M6 started.
- 2026-11-23 · Hour 1 · M4 merged; M7 and M5 started. Running: M0, M1, M5, M7, M8.
- 2026-11-23 · Hour 0–1 · toolchain + fixtures merged; M8 started. Running: M0, M1, M4, M8.
- 2026-11-23 · Hour 0 · contracts merged to main; M4 and M1 agents started.
- 2026-11-23 · Hour 0 · host set up (swap, Docker, Node, firewall); stand-in .env; 3 Sonnet agents started on contracts, M0, toolchain.
- 2026-11-23 17:28 UTC · Hour 0 · owner wrote "build". Clock started. Target: demo-ready at +48 h (owner instruction), contract deadline +72 h.
