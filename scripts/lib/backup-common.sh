# Shared helpers for the host-side scripts (source this file).
# restic runs from the pinned image; the env file is mode 600 and removed on exit.
RESTIC_IMAGE=restic/restic:0.17.3
LIBDIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(cd "$LIBDIR/../.." && pwd)
_TMPS=()
tmp_track() { _TMPS+=("$1"); }
tmp_cleanup() { local f; for f in "${_TMPS[@]:-}"; do [ -n "$f" ] && rm -rf "$f"; done; return 0; }
dk() { if docker info >/dev/null 2>&1; then docker "$@"; else sg docker -c "$(printf '%q ' docker "$@")"; fi; }
make_envf() { ENVF=$("$LIBDIR/backup-env.sh") || return 2; tmp_track "$ENVF"; }
# restic_run <extra docker args...> -- <restic args...>
restic_run() {
  local dargs=()
  while [ "$1" != "--" ]; do dargs+=("$1"); shift; done; shift
  dk run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e RESTIC_CACHE_DIR=/tmp/rc --env-file "$ENVF" "${dargs[@]}" "$RESTIC_IMAGE" "$@"
}

# ---- compose helpers (project and folder come from the caller) ----
PROJECT=${COMPOSE_PROJECT:-epaper}
ROOT=${BACKUP_ROOT:-/srv/epaper}
PG_IMAGE=postgres:17.2-bookworm
compose() { BACKUP_ROOT=$ROOT dk compose -p "$PROJECT" -f "$REPO_DIR/docker-compose.yml" "$@"; }
# bk_run <subcommand...>: run the backup tool inside the running backup container, else in a one-off one
bk_run() {
  if [ -n "$(compose ps -q --status running backup 2>/dev/null)" ]; then compose exec -T -e CHECK_SKIP_DATA="${CHECK_SKIP_DATA:-0}" backup /opt/backup/bk "$@"
  else compose run --rm --no-deps -T -e CHECK_SKIP_DATA="${CHECK_SKIP_DATA:-0}" backup "$@"; fi
}
