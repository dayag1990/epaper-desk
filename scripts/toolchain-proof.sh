#!/usr/bin/env bash
# Re-runnable toolchain proof. Throwaway containers only, no published ports.
# Usage: scripts/toolchain-proof.sh   (set DOCKER="sg docker -c" style via DOCKER_CMD if needed)
set -uo pipefail
PROJECT=toolchain-proof
PG_IMG=postgres:17.2-bookworm
NODE_IMG=node:22.12-bookworm-slim
PW_IMG=mcr.microsoft.com/playwright:v1.49.1-noble
RESTIC_IMG=restic/restic:0.17.3
WALG_VER=v3.0.5
SHARP_VER=0.33.5
PW_VER=1.49.1
DOCKER=${DOCKER_CMD:-docker}
if ! docker info >/dev/null 2>&1; then DOCKER_VIA_SG=1; fi
d() { if [ -n "${DOCKER_VIA_SG:-}" ]; then sg docker -c "docker $(printf '%q ' "$@")"; else docker "$@"; fi; }

WORK=$(mktemp -d "${TMPDIR:-/tmp}/${PROJECT}.XXXXXX")
chmod 777 "$WORK"
PGC=${PROJECT}-pg
cleanup() { d rm -f "$PGC" >/dev/null 2>&1; d run --rm -v "$WORK:/w" "$NODE_IMG" sh -c 'rm -rf /w/* /w/.[!.]*' >/dev/null 2>&1; rm -rf "$WORK"; }
trap cleanup EXIT
RESULTS=()
rec() { RESULTS+=("$1|$2|$3"); printf '%-14s %-5s %s\n' "$1" "$2" "$3"; }
run() { # name image-pin  cmd...  (runs; PASS if exit 0)
  local name=$1 pin=$2; shift 2
  local out; out=$("$@" 2>&1); local rc=$?
  echo "$out" | tail -n 8 | sed "s/^/    [$name] /"
  if [ $rc -eq 0 ]; then rec "$name" PASS "$pin"; else rec "$name" FAIL "$pin"; fi
}
u=$(id -u):$(id -g)

# jpeg + html inputs
cat > "$WORK/page.html" <<'H'
<!doctype html><meta charset=utf-8><title>t</title><body style="font-family:sans-serif"><h1>Riverton proof</h1><p>Hello toolchain.</p>
H

# 1 Postgres
run postgres "$PG_IMG" d run --rm --name ${PROJECT}-pgver "$PG_IMG" postgres --version

# 2 Node
run node "$NODE_IMG" d run --rm "$NODE_IMG" node -e 'console.log(process.version)'

# 3 Playwright Chromium -> PDF + PNG
cat > "$WORK/pw.cjs" <<'J'
const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch();const p=await b.newPage();
await p.goto('file:///w/page.html');await p.pdf({path:'/w/out.pdf',format:'A4'});
await p.screenshot({path:'/w/out.png'});console.log(b.version());await b.close();})();
J
run playwright "$PW_IMG + playwright@$PW_VER" d run --rm -v "$WORK:/w" -w /w "$PW_IMG" bash -c "npm init -y >/dev/null && npm i --silent playwright@$PW_VER && node pw.cjs && ls -l out.pdf out.png && head -c 4 out.pdf"

# 4 sharp
cat > "$WORK/sh.cjs" <<'J'
const sharp=require('sharp');
(async()=>{await sharp({create:{width:800,height:600,channels:3,background:'#468'}}).jpeg().toFile('/w/in.jpg');
const i=await sharp('/w/in.jpg').resize(200).jpeg().toFile('/w/small.jpg');console.log(sharp.versions.sharp,JSON.stringify(i));
if(i.width!==200)process.exit(1)})();
J
run sharp "$NODE_IMG + sharp@$SHARP_VER" d run --rm -v "$WORK:/w" -w /w "$NODE_IMG" bash -c "npm init -y >/dev/null && npm i --silent sharp@$SHARP_VER && node sh.cjs"

# 5 Poppler + 6 qpdf (apt in a debian-based node image; versions printed)
run poppler "$NODE_IMG + apt poppler-utils" d run --rm -v "$WORK:/w" "$NODE_IMG" bash -c "apt-get update -qq && apt-get install -y -qq poppler-utils >/dev/null && pdftoppm -v 2>&1 | head -1 && pdftoppm -r 50 -png /w/out.pdf /w/pg && ls /w/pg* && pdftotext /w/out.pdf - | grep -q 'Hello toolchain' && echo text-ok"
run qpdf "$NODE_IMG + apt qpdf" d run --rm -v "$WORK:/w" "$NODE_IMG" bash -c "apt-get update -qq && apt-get install -y -qq qpdf >/dev/null && qpdf --version | head -1 && qpdf --check /w/out.pdf && qpdf --linearize /w/out.pdf /w/lin.pdf && qpdf --show-npages /w/lin.pdf"

# 7 WAL-G against a throwaway Postgres, local directory target
WG="$WORK/wal-g"
curl -fsSL -o "$WG" "https://github.com/wal-g/wal-g/releases/download/$WALG_VER/wal-g-pg-ubuntu-22.04-amd64" && chmod +x "$WG"
d run -d --rm --name "$PGC" --label "com.docker.compose.project=$PROJECT" -e POSTGRES_PASSWORD=x -v "$WORK:/w" "$PG_IMG" >/dev/null
for i in $(seq 30); do d exec "$PGC" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done; sleep 2
run wal-g "wal-g $WALG_VER (pg, ubuntu-22.04 build) + $PG_IMG" d exec -u postgres -e WALG_FILE_PREFIX=/tmp/walg-store -e PGHOST=/var/run/postgresql -e PGUSER=postgres "$PGC" bash -c "mkdir -p /tmp/walg-store && /w/wal-g --version && /w/wal-g backup-push \$PGDATA && /w/wal-g backup-list"
d rm -f "$PGC" >/dev/null 2>&1

# 8 restic
mkdir -p "$WORK/src" && echo "restic data" > "$WORK/src/a.txt" && echo more > "$WORK/src/b.txt"
run restic "$RESTIC_IMG" d run --rm -v "$WORK:/w" -e RESTIC_PASSWORD=x --entrypoint sh "$RESTIC_IMG" -c "restic version && restic init -r /w/repo && restic -r /w/repo backup /w/src && restic -r /w/repo restore latest --target /w/restored && diff -r /w/src /w/restored/w/src && echo restore-identical"

echo; echo "| tool | result | pin |"; echo "|---|---|---|"
fail=0; for r in "${RESULTS[@]}"; do IFS='|' read -r a b c <<<"$r"; echo "| $a | $b | $c |"; [ "$b" = FAIL ] && fail=1; done
exit $fail
