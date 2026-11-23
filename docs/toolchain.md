# Toolchain proof

Re-run with `scripts/toolchain-proof.sh` (throwaway `docker run --rm` containers, no published ports, compose-project label `toolchain-proof`, temp dir removed on exit). Observed on Ubuntu 24.04 x86_64, Docker via `sg docker`.

| Tool | Image / version pinned | What the script runs | Result |
|---|---|---|---|
| Postgres | `postgres:17.2-bookworm` (17.2 Debian 17.2-1.pgdg120+1) | `postgres --version` | PASS |
| Node | `node:22.12-bookworm-slim` (v22.12.0) | `node -e 'console.log(process.version)'` | PASS |
| Playwright Chromium | `mcr.microsoft.com/playwright:v1.49.1-noble`, `playwright@1.49.1` (Chromium 131.0.6778.33) | `page.pdf()` and `page.screenshot()` on an HTML file; out.pdf 12.8 KB, out.png 9 KB | PASS |
| sharp | `node:22.12-bookworm-slim` + `sharp@0.33.5` | create 800x600 JPEG, resize to 200 wide | PASS |
| Poppler | `node:22.12-bookworm-slim` + apt `poppler-utils` (pdftoppm 22.12.0; host has 24.02.0) | `pdftoppm -r 50 -png`, `pdftotext` on the Playwright PDF | PASS |
| qpdf | `node:22.12-bookworm-slim` + apt `qpdf` (11.3.0) | `qpdf --check`, `--linearize`, `--show-npages` | PASS |
| WAL-G | `v3.0.5` release binary `wal-g-pg-ubuntu-22.04-amd64` (mounted into `postgres:17.2-bookworm`) | `WALG_FILE_PREFIX=/tmp/walg-store wal-g backup-push $PGDATA`, then `backup-list` | PASS (warning: archive_mode off in the throwaway DB, so this proves base backup only, not WAL archiving/restore) |
| restic | `restic/restic:0.17.3` | `init`, `backup` a folder, `restore latest`, `diff -r` | PASS |

Notes
- Poppler and qpdf are installed with apt at run time (versions are the Debian bookworm packages); bake into our own image for production.
- Playwright npm package is installed at run time in the container; keep it pinned at 1.49.1 to match the browsers in the image.
- The WAL-G binary is downloaded from GitHub at run time and is not checksum-verified by the script yet.
