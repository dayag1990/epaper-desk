# Shared functions for the backup service (source this file). Needs: bash, jq, restic, gzip, tar, psql.
DATA=${DATA:-/data}
FILES_DIR=${FILES_DIR:-$DATA/files}
WAL_DIR=${WAL_DIR:-$DATA/walarchive}
BASE_DIR=${BASE_DIR:-$DATA/basebackups}
CODE_DIR=${CODE_DIR:-$DATA/desk}              # the code repository (checked out here)
ASSETS_DIR=${ASSETS_DIR:-$DATA/demo-assets}    # demo photos: not in git
SNAP_DIR=${SNAP_DIR:-$DATA/snapshots}   # safety dumps the ops desk takes before a destructive button
STATUS=${STATUS:-$DATA/backup-status.json}
LOCKDIR=${LOCKDIR:-/tmp}
KEEP_BASEBACKUPS=${KEEP_BASEBACKUPS:-3}
PUSH_TIMEOUT=${PUSH_TIMEOUT:-600}
PG_HOST=${PG_HOST:-postgres}
PG_DB=${PG_DB:-epaper}
PG_SUPERUSER=${PG_SUPERUSER:-epaper}
CONFIG_COPY=${CONFIG_COPY:-/run/epaper.env}
PUSH_INTERVAL=${PUSH_INTERVAL:-900}   # seconds between pushes to the bucket: 15 minutes in the demo phase (owner, 2026-11-24)

# ---- the bucket's daily request budget ----------------------------------------------------
# Backblaze counts requests in three classes (A: uploads, deletes. B: reads, HEAD. C: lists, login) and refuses every request
# once a daily cap is used up. Owner rule 2026-11-24: keep each class under 2,000 a day, including the nightly clean-up and the
# daily restore check. The costs below were MEASURED on 2026-11-24 against a counting S3 stand-in (docs/RUNBOOK.md, "Bucket
# request budget") and are rounded UP. The ledger adds them up per UTC day, in /data/b2-ledger.json (survives restarts).
B2_DAY_LIMIT=${B2_DAY_LIMIT:-1800}
COST_PUSH="8 4 10"      # A B C  per push (measured 6 3 8 with a warm cache)
COST_COLD="24 16 0"     # extra for the first push after the container started (restic cache is empty then)
COST_PRUNE="800 400 40" # the nightly clean-up: deletes of old snapshots, index files and packs, repack reads (measured below this)
COST_DRILL="4 120 40"   # the daily restore check that reads the bucket (restore of the database parts + snapshot list + 1% data check)
LEDGER=${LEDGER:-$DATA/b2-ledger.json}
_ledger_day() { date -u +%Y-%m-%d; }
# ledger_add "A B C" [tag]   add the costs to today's total (tag: prune|drill marks that job as done today)
ledger_add() {
  local a b c; read -r a b c <<<"${1:-0 0 0}"
  ( flock 6
    local d; d=$(_ledger_day); [ -s "$LEDGER" ] && jq -e . "$LEDGER" >/dev/null 2>&1 || echo '{}' > "$LEDGER"
    jq --arg d "$d" --argjson a "${a:-0}" --argjson b "${b:-0}" --argjson c "${c:-0}" --arg tag "${2:-}" '
      (if .day == $d then . else {day:$d, A:0, B:0, C:0, pushes:0, prune_done:false, drill_done:false} end)
      | .A += $a | .B += $b | .C += $c
      | (if $tag == "push" then .pushes += 1 else . end)
      | (if $tag == "prune" then .prune_done = true else . end)
      | (if $tag == "drill" then .drill_done = true else . end)' "$LEDGER" > "$LEDGER.tmp.$$" && chmod 644 "$LEDGER.tmp.$$" && mv -f "$LEDGER.tmp.$$" "$LEDGER"
  ) 6>"$LOCKDIR/ledger.lock"
}
# ledger_room "A B C"   0 = these costs still fit today with the clean-up and the restore check (if not done yet) reserved
ledger_room() {
  local a b c; read -r a b c <<<"$1"
  [ -s "$LEDGER" ] || return 0
  jq -e --arg d "$(_ledger_day)" --argjson lim "$B2_DAY_LIMIT" --argjson a "$a" --argjson b "$b" --argjson c "$c" \
     --argjson pr "$(jq -n --arg s "$COST_PRUNE" '$s|split(" ")|map(tonumber)')" --argjson dr "$(jq -n --arg s "$COST_DRILL" '$s|split(" ")|map(tonumber)')" '
    (if .day == $d then . else {A:0,B:0,C:0,prune_done:false,drill_done:false} end) as $t
    | def res($i): (if $t.prune_done then 0 else $pr[$i] end) + (if $t.drill_done then 0 else $dr[$i] end);
      ($t.A + $a + res(0) <= $lim) and ($t.B + $b + res(1) <= $lim) and ($t.C + $c + res(2) <= $lim)' "$LEDGER" >/dev/null
}
ledger_show() { [ -s "$LEDGER" ] && jq -c --arg d "$(_ledger_day)" 'if .day == $d then . else {day:$d,A:0,B:0,C:0,pushes:0,prune_done:false,drill_done:false} end' "$LEDGER" || echo '{}'; }
# seconds until 00:05 UTC tomorrow (the daily cap resets at 00:00 UTC)
secs_to_cap_reset() { echo $(( $(date -u -d "tomorrow 00:05" +%s) - $(date -u +%s) )); }

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
epoch() { date -u -d "$1" +%s 2>/dev/null || echo 0; }
log() { echo "$(now) backup: $*"; }

# ---- status file -------------------------------------------------------------------
SKEL='{"version":1,"updated":null,"healthy":null,"lag_seconds":null,"last_error":null,"last_error_at":null,
"errors":{},
"files":{"last_ok":null,"size_bytes":null},
"wal":{"last_ok":null,"size_bytes":null,"segments":null,"last_archived":null,"archive_failures":null},
"basebackup":{"last_ok":null,"size_bytes":null,"name":null,"kept":null},
"push":{"last_ok":null,"last_attempt":null,"last_duration_s":null,"snapshot":null,"snapshots_ok":null},
"prune":{"last_ok":null}}'

# st_set '<jq filter>' [jq args...]  - atomic read-modify-write; refreshes updated, lag, healthy, last_error
st_set() {
  local f=$1; shift
  (
    flock 8
    [ -s "$STATUS" ] && jq -e . "$STATUS" >/dev/null 2>&1 || echo "$SKEL" > "$STATUS"
    local t="$STATUS.tmp.$$"
    jq "$@" --arg now "$(now)" --argjson nowe "$(date -u +%s)" --argjson piv "${PUSH_INTERVAL:-900}" "
      $f
      | .updated = \$now
      | .last_error = ([.errors[] | select(.msg)] | sort_by(.at) | last | .msg // null)
      | .last_error_at = ([.errors[] | select(.msg)] | sort_by(.at) | last | .at // null)
      | .lag_seconds = (if .push.last_ok then (\$nowe - (.push.last_ok | fromdateiso8601)) else null end)
      | .healthy = ((.last_error == null) and (.lag_seconds != null) and (.lag_seconds < (2 * \$piv + 120))
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
# The bucket bills by the request (Backblaze gives a few thousand free a day), so a push that worked last time does not
# check the repository again first; the first push after a failure does.
ensure_repo() {
  [ -f "$LOCKDIR/repo-ok" ] && return 0
  if restic cat config >/dev/null 2>&1; then : > "$LOCKDIR/repo-ok"; return 0; fi
  # no repository yet (or the bucket is unreachable): try to create it, the error says which
  local out; out=$(restic init 2>&1) && { : > "$LOCKDIR/repo-ok"; return 0; }
  echo "$out" | tail -1 | cut -c1-200 >&2; return 1
}
# Why does the bucket refuse? One call to Backblaze's own login answers it. Prints a plain-words sentence.
b2_refusal() {
  local ep=${BACKUP_S3_ENDPOINT:-} r code
  case "$ep" in *backblazeb2.com*) ;; *) echo "The bucket refused the request (Access Denied). Check the bucket keys."; return 0;; esac
  r=$(curl -s -m 20 -u "${BACKUP_S3_KEY:-}:${BACKUP_S3_SECRET:-}" https://api.backblazeb2.com/b2api/v3/b2_authorize_account 2>/dev/null) || r=""
  code=$(jq -r '.code // empty' <<<"$r" 2>/dev/null)
  case "$code" in
    transaction_cap_exceeded) echo "Backblaze says the daily usage cap of this account is used up (transaction cap exceeded), so it refuses every request until midnight UTC. Raise the caps in Backblaze > Caps & Alerts. Pushes wait until 00:05 UTC and then try again.";;
    bad_auth_token|unauthorized|bad_request) echo "Backblaze does not accept the bucket key any more (it was changed, expired or removed). Put the current key in the backup settings.";;
    "") if jq -e '.apiInfo' <<<"$r" >/dev/null 2>&1; then echo "The bucket key works but the bucket refuses this folder (Access Denied). The key may be limited to another bucket or folder."; else echo "Backblaze could not be reached to find out why the bucket refuses (Access Denied)."; fi;;
    *) echo "Backblaze refused the request: $code.";;
  esac
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
