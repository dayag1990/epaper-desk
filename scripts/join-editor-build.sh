#!/usr/bin/env bash
# Build apps/editor from main (read-only clone) into /srv/epaper/join-editor-dist, for the join e2e test.
# Only needed until the editor is merged into the branch under test; after that `pnpm --filter @epaper/editor build` does the same.
set -euo pipefail
SRC=${EDITOR_SRC_REPO:-/srv/epaper/desk}
OUT=${EDITOR_DIST_OUT:-/srv/epaper/join-editor-dist}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
git clone -q --local "$SRC" "$TMP/repo"
cd "$TMP/repo"
pnpm install --frozen-lockfile --prefer-offline >/dev/null
pnpm --filter @epaper/core --filter @epaper/layout build >/dev/null
pnpm --filter @epaper/editor exec vite build >/dev/null
rm -rf "$OUT" && mkdir -p "$OUT" && cp -r apps/editor/dist/. "$OUT/"
echo "editor built into $OUT"
