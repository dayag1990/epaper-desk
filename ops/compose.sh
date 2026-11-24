#!/usr/bin/env bash
# docker compose for the epaper project: both files, and the release named by the `current` pointer file.
# Usage: ops/compose.sh up -d --no-build api worker
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PTR=${OPS_STATE_DIR:-/srv/epaper/files/_ops}/current
if [ -z "${EPAPER_RELEASE:-}" ] && [ -s "$PTR" ]; then EPAPER_RELEASE=$(tr -d '[:space:]' <"$PTR"); export EPAPER_RELEASE; fi
DBPTR=${OPS_STATE_DIR:-/srv/epaper/files/_ops}/pgdata-source
if [ -z "${PGDATA_SOURCE:-}" ] && [ -s "$DBPTR" ]; then PGDATA_SOURCE=$(tr -d '\n' <"$DBPTR"); export PGDATA_SOURCE; fi
exec docker compose -p epaper -f "$ROOT/docker-compose.yml" -f "$ROOT/docker-compose.ops.yml" "$@"
