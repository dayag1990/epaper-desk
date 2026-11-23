#!/usr/bin/env bash
# Make a release: build api, worker and ops images tagged YYYY-MM-DD.N, point `current` at it, bring it up,
# keep the newest 5 releases and remove older image tags. Rolling back later = the ops desk repoints `current`.
# Only ADDS images and repoints; it never touches volumes. Usage: ops/release.sh
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
STATE=${OPS_STATE_DIR:-/srv/epaper/files/_ops}
TODAY=$(date +%F); N=1
while docker image inspect "epaper/api:$TODAY.$N" >/dev/null 2>&1; do N=$((N+1)); done
TAG="$TODAY.$N"
echo "building release $TAG"
EPAPER_RELEASE=$TAG "$HERE/compose.sh" build api worker ops
mkdir -p "$STATE"; echo "$TAG" >"$STATE/current.tmp"; mv "$STATE/current.tmp" "$STATE/current"
EPAPER_RELEASE=$TAG "$HERE/compose.sh" up -d --no-build
docker images --format '{{.Tag}}' epaper/api | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$' \
  | sort -t. -k1,1r -k2,2nr | tail -n +6 | while read -r old; do
    [ "$old" = "$TAG" ] && continue
    for r in api worker ops; do docker rmi "epaper/$r:$old" >/dev/null 2>&1 || true; done
    echo "removed old release $old"
  done
echo "release $TAG is live"
