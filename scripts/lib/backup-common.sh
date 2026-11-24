# Shared helpers for the host-side scripts (source this file).
# restic runs from the pinned image; the env file is mode 600 and removed on exit.
RESTIC_IMAGE=restic/restic:0.17.3
LIBDIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(cd "$LIBDIR/../.." && pwd)
_TMPS=()
tmp_track() { _TMPS+=("$1"); }
tmp_cleanup() { local f; for f in "${_TMPS[@]:-}"; do [ -n "$f" ] && rm -rf "$f"; done; return 0; }
# The ops desk keeps DOCKER_HOST as http://... for its own code; the docker program wants tcp://...
case "${DOCKER_HOST:-}" in http://*) export DOCKER_HOST="tcp://${DOCKER_HOST#http://}";; esac
dk() { if docker info >/dev/null 2>&1; then docker "$@"; else sg docker -c "$(printf '%q ' docker "$@")"; fi; }
# dk_out <docker run options, image, command>: like `docker run`, but returns the container's output and exit code.
# `docker run` attaches to the container, and attached output does not come back through the desk's Docker filter (measured: it
# prints nothing). create + start + wait + logs does, so the desk's programs use this wherever they read an answer.
dk_out() {
  local id rc; id=$(dk create --name "${PROJECT}-run-$RANDOM$RANDOM" "$@") || return 125
  dk start "$id" >/dev/null || { dk rm -f "$id" >/dev/null 2>&1; return 125; }
  rc=$(dk wait "$id") || rc=125
  dk logs "$id"
  dk rm "$id" >/dev/null 2>&1
  return "${rc:-125}"
}
make_envf() { ENVF=$("$LIBDIR/backup-env.sh") || return 2; tmp_track "$ENVF"; }
# restic_run <extra docker args...> -- <restic args...>
restic_run() {
  local dargs=()
  while [ "$1" != "--" ]; do dargs+=("$1"); shift; done; shift
  [ -n "${BACKUP_REPO_LOCAL:-}" ] && dargs+=(-v "$BACKUP_REPO_LOCAL:/repo")   # drills only: local repository instead of the bucket
  dk_out --user "$(id -u):$(id -g)" -e HOME=/tmp -e RESTIC_CACHE_DIR=/tmp/rc --env-file "$ENVF" "${dargs[@]}" "$RESTIC_IMAGE" "$@"
}

# ---- compose helpers (project and folder come from the caller) ----
PROJECT=${COMPOSE_PROJECT:-epaper}
ROOT=${BACKUP_ROOT:-/srv/epaper}
PG_IMAGE=postgres:17.2-bookworm
# Where the ops desk keeps its own small state (release pointer, database pointer). Same folder the desk uses.
# A throwaway project never reads the live pointers: the default folder is used only for the live project, decided when it is needed.
resolve_state_dir() {
  STATE_DIR=${OPS_STATE_DIR:-}
  [ -z "$STATE_DIR" ] && [ -n "${FILES_ROOT:-}" ] && STATE_DIR=$FILES_ROOT/_ops     # the desk sets FILES_ROOT
  [ -z "$STATE_DIR" ] && [ "$PROJECT" = epaper ] && STATE_DIR=/srv/epaper/files/_ops
  return 0
}
resolve_state_dir
# Compose files: the desk passes OPS_COMPOSE_FILES (colon separated); otherwise the repo's main file.
COMPOSE_ARGS=()
if [ -n "${OPS_COMPOSE_FILES:-}" ]; then
  IFS=: read -ra _cf <<<"$OPS_COMPOSE_FILES"
  for _f in "${_cf[@]}"; do [ -n "$_f" ] && COMPOSE_ARGS+=(-f "$_f"); done
else COMPOSE_ARGS=(-f "$REPO_DIR/docker-compose.yml"); fi
# The release and the database folder the desk chose (rollback / restore switch) apply to every compose call.
load_pointers() {
  local v; resolve_state_dir; [ -n "$STATE_DIR" ] || return 0
  if [ -z "${EPAPER_RELEASE:-}" ] && [ -s "$STATE_DIR/current" ]; then v=$(tr -d '[:space:]' <"$STATE_DIR/current"); [ -n "$v" ] && export EPAPER_RELEASE=$v; fi
  # the pointer file always wins for the database folder (it changes during a switch); with no file the environment is left alone
  if [ -s "$STATE_DIR/pgdata-source" ]; then v=$(tr -d '\n' <"$STATE_DIR/pgdata-source"); [ -n "$v" ] && export PGDATA_SOURCE=$v; fi
  return 0
}
compose() { load_pointers; BACKUP_ROOT=$ROOT dk compose -p "$PROJECT" "${COMPOSE_ARGS[@]}" "$@"; }
# bk_run <subcommand...>: run the backup tool inside the running backup container, else in a one-off one.
# BK_USE_RUN=1 (the ops desk sets it) always uses a one-off container: the desk's Docker door has no `exec`.
bk_run() {
  if [ "${BK_USE_RUN:-0}" != 1 ] && [ -n "$(compose ps -q --status running backup 2>/dev/null)" ]; then compose exec -T -e CHECK_SKIP_DATA="${CHECK_SKIP_DATA:-0}" backup /opt/backup/bk "$@"
  else compose run --rm --no-deps -T -e CHECK_SKIP_DATA="${CHECK_SKIP_DATA:-0}" backup "$@"; fi
}
