# Programs the ops desk calls (source this after backup-common.sh).
#   desk_status                       JSON: what each kind of backup looks like right now
#   desk_snapshot "<reason>"          safety copy of the database before a destructive button; prints {"id":...}
#   desk_verify                       restore check into a scratch copy of the database; records the result
#   desk_db_restore "<ISO time>"      second Postgres beside the live one, as it was at that minute; prints {"id","counts"}
#   desk_db_switch <id>               make that copy the live database (the old one stays on disk, never deleted)
#   desk_files_restore <scope> <ISO>  bring back files that are missing (nothing is ever overwritten)
# stdout carries ONE json object. Everything else goes to stderr, and the LAST stderr lines are plain words the owner reads.
# The desk container has no `exec` (its Docker door refuses it), so every database client runs as a one-off container.

dsay() { echo "$(date -u +%H:%M:%S) $*" >&2; }
dfail() { echo "$1" >&2; exit "${2:-1}"; }
ENV_FILE=${EPAPER_ENV:-/srv/epaper/.env}
RESTORE_WAIT_S=${RESTORE_WAIT_S:-900}

# ---- status ---------------------------------------------------------------------------
desk_status() {
  local s d
  s=$(jq -c . "$ROOT/backup-status.json" 2>/dev/null || echo '{}')
  d=$(jq -c . "$ROOT/drill-status.json" 2>/dev/null || echo null)
  jq -n --argjson s "$s" --argjson d "$d" '
    def at($t; $n): if $t then {at: $t, size_bytes: ($n // 0)} else null end;
    { files: at($s.files.last_ok; $s.files.size_bytes),
      wal:   at($s.wal.last_ok; $s.wal.size_bytes),
      base:  at($s.basebackup.last_ok; $s.basebackup.size_bytes),
      drill: (if $d and $d.at then {at: $d.at, result: $d.result} else null end) }'
}

# ---- one-off clients and servers -----------------------------------------------------------
# pg_client <bash script>: runs in a one-off container on the project network; POSTGRES_PASSWORD comes from the env file.
pg_client() {
  dk_out --user 1001:1001 --network "${PROJECT}_default" --env-file "$ENV_FILE" -e HOME=/tmp --entrypoint bash "$PG_IMAGE" -c "$1"
}
COUNTS_FN='
q() { PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$1" -U epaper -d epaper -X -At -F"|" -c "$2"; }
counts() {
  local sql
  sql=$(q "$1" "select coalesce(string_agg(format('"'"'select %L, count(*) from public.%I'"'"', table_name, table_name), '"'"' union all '"'"'), '"'"'select ''none'', 0'"'"') from information_schema.tables where table_schema='"'"'public'"'"' and table_type='"'"'BASE TABLE'"'"'") || return 1
  q "$1" "$sql"
}'

# newest base backup (checksum ok) that finished at or before the target epoch (empty = newest)
pick_base() {
  local te=${1:-} b m
  for b in $(ls -1r "$ROOT/basebackups" 2>/dev/null); do
    m="$ROOT/basebackups/$b/manifest.json"; [ -f "$m" ] || continue
    if [ -n "$te" ] && [ "$(date -u -d "$(jq -r .finished "$m")" +%s)" -gt "$te" ]; then continue; fi
    if ( cd "$ROOT/basebackups/$b" && sha256sum -c --quiet SHA256SUMS >/dev/null 2>&1 ); then echo "$b"; return 0; fi
    dsay "base backup $b failed its checksum, trying an older one"
  done
  return 1
}

# start_copy <id> <base> [target time 'YYYY-MM-DD HH:MM:SS+00']: unpack a base backup into restores/<id>/pgdata and start a
# second Postgres on the project network, named postgres-restore-<id>. It never archives and never touches the live one.
start_copy() {
  local id=$1 bb=$2 tt=${3:-} dir="$ROOT/restores/$1" cname="${PROJECT}-restore-$1"
  # (the folder belongs to the database user, so only a container can look inside: the unpack step itself skips a folder that is not empty)
  if :; then
    dk_out --user 0 -v "$ROOT:/r" --entrypoint bash "$PG_IMAGE" -c "mkdir -p /r/restores/$id/pgdata && chown 999:999 /r/restores/$id/pgdata && chmod 700 /r/restores/$id/pgdata" >/dev/null \
      || dfail "The desk could not make room for the second database. Nothing was changed."
    local PRE
    read -r -d '' PRE <<'EOS' || true
set -euo pipefail
D=/var/lib/postgresql/data
if [ -n "$(ls -A $D)" ]; then echo "the second database was unpacked before; leaving it as it is"; exit 0; fi
tar -xzf /basebackups/$BB/base.tar.gz -C $D
mkdir -p $D/pg_wal; tar -xzf /basebackups/$BB/pg_wal.tar.gz -C $D/pg_wal
chmod 700 $D
cat >> $D/postgresql.auto.conf <<'EOC'
restore_command = 'f=/walarchive/%f.gz; test -f "$f" && gzip -dc "$f" > "%p"'
recovery_target_action = 'promote'
EOC
[ -z "${RTIME:-}" ] || echo "recovery_target_time = '$RTIME'" >> $D/postgresql.auto.conf
touch $D/recovery.signal
EOS
    dk_out --user 999:999 -v "$dir/pgdata:/var/lib/postgresql/data" -v "$ROOT/basebackups:/basebackups:ro" -e "BB=$bb" -e "RTIME=$tt" --entrypoint bash "$PG_IMAGE" -c "$PRE" >&2 \
      || dfail "The desk could not unpack the database backup. Nothing was changed on the live database."
  fi
  dk run -d --rm --name "$cname" --user 999:999 --network "${PROJECT}_default" --network-alias "postgres-restore-$id" \
    --label "epaper.restore=$id" -v "$dir/pgdata:/var/lib/postgresql/data" -v "$ROOT/walarchive:/walarchive:ro" -v "$REPO_DIR/ops/postgres:/opt/epaper-pg:ro" \
    "$PG_IMAGE" postgres -c wal_level=replica -c archive_mode=off -c "hba_file=/opt/epaper-pg/pg_hba.conf" -c "listen_addresses=*" >/dev/null \
    || dfail "The second database could not be started. Nothing was changed on the live database."
}

# is_live_copy <id>: true when the live database runs on this restored folder (never touch it then)
is_live_copy() { resolve_state_dir; [ -n "$STATE_DIR" ] && [ "$(cat "$STATE_DIR/pgdata-source" 2>/dev/null || true)" = "$ROOT/restores/$1/pgdata" ]; }
# discard_copy <id>: a copy that failed to come up may be half-replayed and can never be resumed; it is rebuilt from the backups next
# time. (Only ever a restored copy; the live database and the old volume are never named here.)
discard_copy() {
  is_live_copy "$1" && return 0
  dk stop -t 20 "${PROJECT}-restore-$1" >/dev/null 2>&1 || true
  dk_out --user 0 -v "$ROOT:/r" --entrypoint bash "$PG_IMAGE" -c "rm -rf /r/restores/$1" >/dev/null 2>&1 || true
}
# wait_copy <id>: until the copy answers and has left recovery; fails in plain words when it stops or never gets there
wait_copy() {
  local id=$1 cname="${PROJECT}-restore-$1" i r
  for i in $(seq $(( RESTORE_WAIT_S / 3 ))); do
    if [ "$(dk inspect -f '{{.State.Running}}' "$cname" 2>/dev/null || echo false)" != true ]; then
      discard_copy "$id"
      dfail "The second database stopped while it was being built. The most likely reason: the database log does not reach that minute yet (the newest copy of the log is older). Try a minute that is a little earlier. The live database was not touched."
    fi
    r=$(pg_client 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h postgres-restore-'"$id"' -U epaper -d epaper -X -Atc "select pg_is_in_recovery()"' 2>/dev/null || true)
    [ "$r" = f ] && return 0
    sleep 2
  done
  discard_copy "$id"
  dfail "The second database did not finish building in $((RESTORE_WAIT_S / 60)) minutes. The live database was not touched."
}

# ---- database: restore to a minute, beside the live one --------------------------------------
desk_db_restore() {
  local to=${1:?time} te tt id bb cname
  te=$(date -u -d "$to" +%s 2>/dev/null) || dfail "The desk cannot read the time '$to'. Use a form like 2026-11-24 04:15:00Z. Nothing was changed."
  [ "$te" -le "$(date -u +%s)" ] || dfail "That time is in the future. Pick a minute that has already happened. Nothing was changed."
  tt=$(date -u -d "$to" '+%Y-%m-%d %H:%M:%S+00')
  id="r$(date -u -d "$to" +%Y%m%dT%H%M%SZ)"; cname="${PROJECT}-restore-$id"
  is_live_copy "$id" && dfail "The live database already is the copy for that minute. Nothing was changed."
  if [ "$(dk inspect -f '{{.State.Running}}' "$cname" 2>/dev/null || echo false)" = true ]; then
    dsay "the second database for $to is already running"
  else
    bb=$(pick_base "$te") || dfail "There is no database backup as old as $to. The oldest one on this box is $(ls -1 "$ROOT/basebackups" 2>/dev/null | head -1 | sed -E 's/^([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2}).*/\1-\2-\3 \4:\5/'). Pick a later minute. Nothing was changed."
    dsay "building the second database at $tt from base backup $bb"
    start_copy "$id" "$bb" "$tt"
  fi
  wait_copy "$id"
  local out
  out=$(pg_client "$COUNTS_FN"'
    live=$(counts postgres | sed "s/^/LIVE|/") || live=""
    rest=$(counts postgres-restore-'"$id"' | sed "s/^/REST|/") || { echo "cannot read the second database" >&2; exit 1; }
    printf "%s\n%s\n" "$live" "$rest"') || dfail "The second database is up but its row counts could not be read. The live database was not touched."
  printf '%s\n' "$out" | jq -R -s --arg id "$id" '
    split("\n") | map(select(length>0) | split("|")) as $r
    | ($r | map(select(.[0]=="LIVE") | {key: .[1], value: (.[2]|tonumber)}) | from_entries) as $live
    | ($r | map(select(.[0]=="REST") | {key: .[1], value: (.[2]|tonumber)}) | from_entries) as $rest
    | {id: $id, counts: ((($live|keys) + ($rest|keys)) | unique | map({table: ., live: ($live[.] // 0), restored: ($rest[.] // 0)}))}'
}

# A restored copy starts a new timeline (a history file in its pg_wal). The copy ran with archiving off, so nobody has put that file
# in the log archive yet; without it a later restore cannot follow the new timeline and would silently stop at the old one.
archive_histories() {
  dk_out --user 999:999 -v "$1:/d:ro" -v "$ROOT/walarchive:/walarchive" -v "$REPO_DIR/ops/postgres:/opt/epaper-pg:ro" --entrypoint bash "$PG_IMAGE" -c \
    'n=0; for f in /d/pg_wal/*.history; do [ -e "$f" ] || continue; /opt/epaper-pg/archive-wal.sh "$f" "$(basename "$f")" || exit 1; n=$((n+1)); done; echo "archived $n history file(s)"' >&2
}

# ---- database: switch to the copy ------------------------------------------------------
desk_db_switch() {
  local id=${1:?id} dir cname old
  resolve_state_dir
  [[ "$id" =~ ^r[0-9]{8}T[0-9]{6}Z$ ]] || dfail "That is not the name of a restored database. Nothing was changed."
  dir="$ROOT/restores/$id/pgdata"; cname="${PROJECT}-restore-$id"
  old=$(cat "$STATE_DIR/pgdata-source" 2>/dev/null || echo "${PROJECT}_pgdata (the original volume)")
  if [ "$(cat "$STATE_DIR/pgdata-source" 2>/dev/null || true)" = "$dir" ]; then jq -n '{ok:true, already:true}'; return 0; fi
  [ -d "$dir" ] || dfail "There is no restored database with that name. Build one first. Nothing was changed."
  [ -n "$STATE_DIR" ] && mkdir -p "$STATE_DIR" && [ -w "$STATE_DIR" ] || dfail "The desk has nowhere to write down which database is live, so it did not switch. Nothing was changed."
  [ "$(dk inspect -f '{{.State.Running}}' "$cname" 2>/dev/null || echo false)" = true ] || dfail "The restored database is not running any more. Build it again with Restore. Nothing was changed."
  dsay "cleaning the restore settings out of the copy, then stopping it"
  pg_client 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h postgres-restore-'"$id"' -U epaper -d epaper -X -q -c "alter system reset all" -c "select pg_reload_conf()"' >/dev/null 2>&1 || true
  dk stop -t 60 "$cname" >/dev/null 2>&1 || dfail "The restored database would not stop cleanly. Nothing was changed."
  archive_histories "$dir" || dfail "The new timeline could not be written down in the log archive, so the desk did not switch. Nothing was changed."
  dsay "stopping the live database (the old copy stays on disk untouched)"
  compose stop -t 60 postgres >&2 || dfail "The live database would not stop. Nothing was changed."
  # from here on, any failure puts the old database back before the desk answers
  back_to_old() { rm -f "$STATE_DIR/pgdata-source" "$STATE_DIR/pgdata-source.tmp"; unset PGDATA_SOURCE; compose up -d --no-deps postgres >&2 || true; dfail "$1"; }
  printf '%s\n' "$dir" > "$STATE_DIR/pgdata-source.tmp" && mv -f "$STATE_DIR/pgdata-source.tmp" "$STATE_DIR/pgdata-source" || back_to_old "The desk could not write down the switch, so it went back to the old database. Nothing was lost."
  dsay "starting the live database on the restored copy"
  compose up -d --no-deps --wait --wait-timeout 180 postgres >&2 || back_to_old "The database did not start on the restored copy, so the desk went back to the old one. Nothing was lost."
  # trust, but look: the running database must really sit on the restored folder
  local cid src; cid=$(compose ps -q postgres 2>/dev/null | head -1)
  src=$(dk inspect -f '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Source}}{{end}}{{end}}' "$cid" 2>/dev/null || true)
  [ "$src" = "$dir" ] || { compose stop -t 60 postgres >&2 || true; back_to_old "The database did not end up on the restored copy, so the desk went back to the old one. Nothing was lost."; }
  jq -n --arg old "$old" '{ok:true, old_copy:$old}'
}

# ---- safety copy before a destructive button ----------------------------------------------------
desk_snapshot() {
  local reason=${1:-manual} id; id=$(date -u +%Y%m%dT%H%M%SZ)
  compose run --rm --no-deps -T -e "SNAP_ID=$id" -e "SNAP_REASON=$reason" --entrypoint bash backup -c '
    set -o pipefail
    mkdir -p /data/snapshots
    PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h postgres -U epaper -d epaper --no-owner | gzip > "/data/snapshots/.tmp.$SNAP_ID.sql.gz" \
      && [ "$(gzip -dc "/data/snapshots/.tmp.$SNAP_ID.sql.gz" | head -c 200 | wc -c)" -gt 0 ] \
      && mv "/data/snapshots/.tmp.$SNAP_ID.sql.gz" "/data/snapshots/$SNAP_ID.sql.gz" \
      && printf "%s\n" "$SNAP_REASON" > "/data/snapshots/$SNAP_ID.reason"' >&2 \
    || { echo "The database could not be copied (is it running?)." >&2; exit 1; }
  jq -n --arg id "$id" '{id:$id}'
}

# ---- restore check: build a scratch copy from the newest base backup + all archived log, look inside, throw it away ------
desk_verify() {
  local id="v$(date -u +%Y%m%dT%H%M%SZ)" bb res=pass note="" out
  bb=$(pick_base "") || { res=fail; note="no usable base backup"; }
  if [ "$res" = pass ]; then
    dsay "restore check: scratch copy $id from base backup $bb"
    ( start_copy "$id" "$bb" "" && wait_copy "$id" ) >&2 || { res=fail; note="the scratch copy would not start"; }
  fi
  if [ "$res" = pass ]; then
    out=$(pg_client "$COUNTS_FN"'; counts postgres-restore-'"$id" 2>/dev/null) || out=""
    [ -n "$out" ] && [ "$out" != "none|0" ] || { res=fail; note="the scratch copy has no tables"; }
  fi
  dk stop -t 30 "${PROJECT}-restore-$id" >/dev/null 2>&1 || true
  if [ "$res" = pass ]; then
    ( make_envf && restic_run -- snapshots --latest 1 --host epaper --compact >&2 ) || { res=fail; note="the off-box bucket check failed"; }
  fi
  local rec; rec=$(jq -cn --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg r "$res" --arg n "$note" '{at:$at, result:$r, note:$n}')
  dk_out --user 1001:1001 -v "$ROOT:/data" -e "REC=$rec" --entrypoint bash "$PG_IMAGE" -c 'printf "%s\n" "$REC" > /data/drill-status.json.tmp && mv -f /data/drill-status.json.tmp /data/drill-status.json' >/dev/null 2>&1 || true
  # the scratch folder was made by the database user (uid 999); it is empty-able only by that user
  dk_out --user 0 -v "$ROOT:/r" --entrypoint bash "$PG_IMAGE" -c "rm -rf /r/restores/$id" >/dev/null 2>&1 || true
  echo "$rec"
  [ "$res" = pass ] || { echo "The restore check FAILED: $note. Backups may not be usable. Press Back up now, then check again; if it fails again, ask for help." >&2; exit 1; }
}

# ---- files: bring back what is missing, never overwrite -----------------------------------------------
desk_files_restore() {
  local scope=${1:-all} at=${2:?time} snap sid stage
  date -u -d "$at" >/dev/null 2>&1 || dfail "The desk cannot read the time '$at'. Nothing was changed."
  make_envf || dfail "The backup bucket keys are missing, so files cannot be fetched. Nothing was changed."
  snap=$(restic_run -- snapshots --host epaper --tag auto --json 2>/dev/null) || dfail "The backup bucket cannot be read right now. Nothing was changed."
  sid=$(printf '%s' "$snap" | jq -r --arg at "$(date -u -d "$at" +%Y-%m-%dT%H:%M:%SZ)" 'map(select(.time <= $at)) | sort_by(.time) | last | .id // empty')
  [ -n "$sid" ] || dfail "The bucket has no copy as old as $at. Nothing was changed."
  stage="restore-staging-$(date -u +%Y%m%dT%H%M%SZ)"
  dsay "fetching files from snapshot ${sid:0:8}"
  restic_run -v "$ROOT:/target" -- restore "$sid" --target "/target/$stage" --include /data/files >&2 || dfail "The files could not be fetched from the bucket. Nothing was changed."
  local added
  added=$(dk_out --user 1001:1001 -v "$ROOT:/r" --entrypoint bash "$PG_IMAGE" -c '
    mkdir -p /r/files; n=0
    while IFS= read -r -d "" f; do rel=${f#/r/'"$stage"'/data/files/}; if [ ! -e "/r/files/$rel" ]; then mkdir -p "/r/files/$(dirname "$rel")"; cp -p "$f" "/r/files/$rel" && n=$((n+1)); fi; done < <(find "/r/'"$stage"'/data/files" -type f -print0 2>/dev/null)
    rm -rf "/r/'"$stage"'"; echo $n') || dfail "The files were fetched but could not be put back. Nothing was overwritten."
  jq -n --arg scope "$scope" --argjson added "${added:-0}" '{ok:true, scope:$scope, files_brought_back:$added}'
}
