#!/usr/bin/env bash
# Give an EXISTING account access to another paper. The password is not touched and nothing secret is read.
#
#   scripts/grant-paper.sh <email> <paper-slug> [role]
#   role: owner (default), editor, sub, designer or viewer
#
# Runs inside the api container of the live stack, like create-admin.sh. To change a role, run it again.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ $# -lt 2 ] || [ $# -gt 3 ]; then
  echo "Usage: scripts/grant-paper.sh <email> <paper-slug> [owner|editor|sub|designer|viewer]" >&2
  exit 2
fi
EMAIL="$1"; SLUG="$2"; ROLE="${3:-owner}"
case "$ROLE" in owner|editor|sub|designer|viewer) ;; *) echo "The role must be one of: owner, editor, sub, designer, viewer." >&2; exit 2 ;; esac

DC=(docker compose -p epaper)
"${DC[@]}" cp prisma/grant-paper.mts api:/app/prisma/grant-paper.mts >/dev/null
"${DC[@]}" exec -T -e GRANT_EMAIL="$EMAIL" -e GRANT_PAPER="$SLUG" -e GRANT_ROLE="$ROLE" api \
  sh -c 'cd /app && node_modules/.bin/tsx prisma/grant-paper.mts'
