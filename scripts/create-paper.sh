#!/usr/bin/env bash
# Create a paper on the LIVE stack and make existing accounts its owners (no password involved).
#   scripts/create-paper.sh <slug> "<name>" <lang> <script> [owner-emails (comma separated)] [w_mm] [h_mm]
#   example: scripts/create-paper.sh punjabi-demo "ਪੰਜਾਬੀ ਡੈਮੋ" pa Guru owner@riverton.example,admin@riverton.example 381 578
# Runs inside the api container, like create-admin.sh. Repeating it changes nothing for an existing paper.
set -euo pipefail
cd "$(dirname "$0")/.."
[ $# -ge 4 ] || { echo "Usage: scripts/create-paper.sh <slug> \"<name>\" <lang> <script> [owner-emails] [w_mm] [h_mm]" >&2; exit 2; }
DC=(docker compose -p epaper)
"${DC[@]}" cp prisma/create-paper.mts api:/app/prisma/create-paper.mts >/dev/null
"${DC[@]}" exec -T -e PAPER_SLUG="$1" -e PAPER_NAME="$2" -e PAPER_LANG="$3" -e PAPER_SCRIPT="$4" -e OWNER_EMAILS="${5:-owner@riverton.example,admin@riverton.example}" -e PAPER_W_MM="${6:-300}" -e PAPER_H_MM="${7:-450}" api \
  sh -c 'cd /app && node_modules/.bin/tsx prisma/create-paper.mts'
