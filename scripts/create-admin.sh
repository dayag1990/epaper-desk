#!/usr/bin/env bash
# Create the first admin (owner) account for a paper on the LIVE stack, or reset its password.
# YOU type the password, at a hidden prompt, in your own terminal. It is sent to the API container
# on stdin only: never an argument, never a file, never printed.
#
#   scripts/create-admin.sh [email] [paper-slug] [display name]
#   defaults: admin@riverton.example  riverton-herald  Admin
#
# Run it in your own SSH session (it needs a real terminal for the hidden prompt).
set -euo pipefail
cd "$(dirname "$0")/.."
EMAIL="${1:-admin@riverton.example}"; SLUG="${2:-riverton-herald}"; NAME="${3:-Admin}"

if [ ! -t 0 ]; then
  echo "This needs a real terminal for the hidden password prompt. Run it in your own SSH session:" >&2
  echo "  cd /srv/epaper/desk && scripts/create-admin.sh" >&2
  exit 2
fi
echo "Account: $EMAIL   Paper: $SLUG"
read -rs -p "Choose a password (12 characters or more): " P1; echo
read -rs -p "Type it again: " P2; echo
if [ "$P1" != "$P2" ]; then echo "The two passwords are different. Nothing was changed." >&2; exit 1; fi
if [ "${#P1}" -lt 12 ]; then echo "That is too short: use 12 characters or more. Nothing was changed." >&2; exit 1; fi

DC=(docker compose -p epaper)
"${DC[@]}" cp prisma/create-admin.mts api:/app/prisma/create-admin.mts >/dev/null
printf '%s\n' "$P1" | "${DC[@]}" exec -T -e ADMIN_EMAIL="$EMAIL" -e ADMIN_PAPER="$SLUG" -e ADMIN_NAME="$NAME" api \
  sh -c 'cd /app && node_modules/.bin/tsx prisma/create-admin.mts'
unset P1 P2
echo
echo "Log in at http://localhost:8100/admin  with this email, your password, and the paper: $SLUG"
