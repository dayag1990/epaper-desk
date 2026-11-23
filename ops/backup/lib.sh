# Shared functions for the backup service (source this file). Needs: bash, jq, restic, gzip, tar, psql.
DATA=${DATA:-/data}
FILES_DIR=${FILES_DIR:-$DATA/files}
WAL_DIR=${WAL_DIR:-$DATA/walarchive}
BASE_DIR=${BASE_DIR:-$DATA/basebackups}
STATUS=${STATUS:-$DATA/backup-status.json}
LOCKDIR=${LOCKDIR:-/tmp}
KEEP_BASEBACKUPS=${KEEP_BASEBACKUPS:-3}
PUSH_TIMEOUT=${PUSH_TIMEOUT:-600}
PG_HOST=${PG_HOST:-postgres}
PG_DB=${PG_DB:-epaper}
PG_SUPERUSER=${PG_SUPERUSER:-epaper}
CONFIG_COPY=${CONFIG_COPY:-/run/epaper.env}

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
epoch() { date -u -d "$1" +%s 2>/dev/null || echo 0; }
log() { echo "$(now) backup: $*"; }

# ---- status file -------------------------------------------------------------------
SKEL='{"version":1,"updated":null,"healthy":null,"lag_seconds":null,"last_error":null,"last_error_at":null,
"errors":{},
"files":{"last_ok":null,"size_bytes":null},
"wal":{"last_ok":null,"size_bytes":null,"segments":null,"last_archived":null,"archive_failures":null},
"basebackup":{"last_ok":null,"size_bytes":null,"name":null,"kept":null},
"push":{"last_ok":null,"last_attempt":null,"last_duration_s":null,"snapshot":null},
"prune":{"last_ok":null}}'

# st_set '<jq filter>' [jq args...]  - atomic read-modify-write; refreshes updated, lag, healthy, last_error
st_set() {
  local f=$1; shift
  (
    flock 8
    [ -s "$STATUS" ] && jq -e . "$STATUS" >/dev/null 2>&1 || echo "$SKEL" > "$STATUS"
    local t="$STATUS.tmp.$$"
    jq "$@" --arg now "$(now)" --argjson nowe "$(date -u +%s)" "
      $f
      | .updated = \$now
      | .last_error = ([.errors[] | select(.msg)] | sort_by(.at) | last | .msg // null)
      | .last_error_at = ([.errors[] | select(.msg)] | sort_by(.at) | last | .at // null)
      | .lag_seconds = (if .push.last_ok then (\$nowe - (.push.last_ok | fromdateiso8601)) else null end)
      | .healthy = ((.last_error == null) and (.lag_seconds != null) and (.lag_seconds < 300)
          and (.basebackup.last_ok != null and (\$nowe - (.basebackup.last_ok | fromdateiso8601)) < 93600))
    " "$STATUS" > "$t" && chmod 644 "$t" && mv -f "$t" "$STATUS"
  ) 8>"$LOCKDIR/status.lock"
}
st_err() { st_set '.errors[$a] = {msg: $m, at: $now}' --arg a "$1" --arg m "$2"; log "problem ($1): $2"; }
st_clear() { st_set 'del(.errors[$a])' --arg a "$1"; }

# ---- restic env --------------------------------------------------------------------
load_restic_env() {
  [ -n "${RESTIC_REPOSITORY:-}" ] && return 0
  local envf k v
  envf=$(EPAPER_ENV=/nonexistent backup-env.sh) || { echo "Backup is not set up: a BACKUP_* value is empty." >&2; return 2; }
  while IFS= read -r line; do k=${line%%=*}; v=${line#*=}; export "$k=$v"; done < "$envf"
  rm -f "$envf"
  export RESTIC_CACHE_DIR=${RESTIC_CACHE_DIR:-/cache}
}
ensure_repo() {
  restic cat config >/dev/null 2>&1 && return 0
  # no repository yet (or the bucket is unreachable): try to create it, the error says which
  local out; out=$(restic init 2>&1) && return 0
  echo "$out" | tail -1 | cut -c1-200 >&2; return 1
}

# ---- local base backups ------------------------------------------------------------
# complete base backups = directories with manifest.json, newest first
list_basebackups() { local d; for d in "$BASE_DIR"/*/; do [ -f "${d}manifest.json" ] && basename "$d"; done 2>/dev/null | sort -r; }

# retain_basebackups [keep]: keep the newest N complete base backups, remove the others, then
# remove archived WAL older than the oldest kept base backup's start segment.
retain_basebackups() {
  local keep=${1:-$KEEP_BASEBACKUPS} all i=0 name oldest start seg f
  mapfile -t all < <(list_basebackups)
  [ "${#all[@]}" -gt 0 ] || return 0                       # never delete anything without a base backup
  for name in "${all[@]}"; do
    i=$((i+1)); [ "$i" -gt "$keep" ] && rm -rf "${BASE_DIR:?}/$name"
  done
  rm -rf "$BASE_DIR"/.partial-* 2>/dev/null || true
  oldest=${all[$(( keep-1 < ${#all[@]}-1 ? keep-1 : ${#all[@]}-1 ))]}
  start=$(jq -r '.start_wal // empty' "$BASE_DIR/$oldest/manifest.json")
  [[ "$start" =~ ^[0-9A-F]{24}$ ]] || return 0
  seg=${start:8}
  for f in "$WAL_DIR"/*.gz; do
    [ -e "$f" ] || continue
    f=$(basename "$f")
    [[ "$f" =~ ^([0-9A-F]{24})(\..*)?\.gz$ ]] || continue   # leaves .history files and temp files alone
    [ "${f:8:16}" \< "$seg" ] && rm -f "$WAL_DIR/$f"
  done
  return 0
}

dir_bytes() { [ -d "$1" ] && du -sb "$1" 2>/dev/null | cut -f1 || echo 0; }
