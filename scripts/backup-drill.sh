#!/usr/bin/env bash
# Backup + restore drill on a dead-disk simulation. Touches ONLY a throwaway compose project (epaper-bk),
# a throwaway BACKUP_ROOT in a temp dir and the bucket prefix "epaper-drill". The live project is never touched.
#   (a) write rows for 90 s while the backup loop runs   (b) note the last committed row
#   (c) kill the containers, delete the Postgres volume and the local files / WAL / base backups
#   (d) scripts/restore.sh using only the bucket          (e) count rows: seconds of writes lost, restore time
#   (f) files byte-identical                              (g) clean up everything, empty the drill prefix
# Env: DRILL_WRITE_SECONDS (90), EPAPER_ENV (/srv/epaper/.env: where the bucket values come from).
set -uo pipefail
. "$(dirname "$0")/lib/backup-common.sh"
export COMPOSE_PROJECT=epaper-bk PROJECT=epaper-bk
[ "$PROJECT" = epaper ] && { echo "refusing to run on the live project" >&2; exit 2; }
W=$(mktemp -d /tmp/epaper-drill.XXXXXX); ROOT="$W/root"
export BACKUP_ROOT="$ROOT" BACKUP_PREFIX=epaper-drill PG_CONTAINER=epaper-bk-postgres BK_CONTAINER=epaper-bk-backup
export EPAPER_ENV=${EPAPER_ENV:-/srv/epaper/.env}
WRITE_S=${DRILL_WRITE_SECONDS:-90}
PASS=0; FAILN=0
res() { if [ "$1" = ok ]; then echo "PASS: $2"; PASS=$((PASS+1)); else echo "FAIL: $2"; FAILN=$((FAILN+1)); fi; }
PGX() { dk exec -i "$PG_CONTAINER" psql -U epaper -d epaper -qAt -v ON_ERROR_STOP=1 "$@"; }

cleanup() {
  echo "== cleaning up"
  compose down -v --remove-orphans >/dev/null 2>&1
  local ids; ids=$(dk ps -aq --filter "label=com.docker.compose.project=$PROJECT"); [ -n "$ids" ] && dk rm -f $ids >/dev/null 2>&1
  ids=$(dk volume ls -q --filter "label=com.docker.compose.project=$PROJECT"); [ -n "$ids" ] && dk volume rm $ids >/dev/null 2>&1
  rm -rf "$W" 2>/dev/null || dk run --rm -v "$W:/w" --entrypoint sh "$PG_IMAGE" -c 'rm -rf /w/* /w/.[!.]*' >/dev/null 2>&1; rm -rf "$W" 2>/dev/null
  if [ -n "${ENVF:-}" ]; then
    local sn; sn=$(restic_run -- snapshots --json 2>/dev/null | jq -r '.[].id' | tr '\n' ' ')
    if [ -n "$sn" ]; then restic_run -- forget --prune $sn >/dev/null 2>&1 && echo "emptied the epaper-drill prefix in the bucket" || echo "WARNING: could not empty the epaper-drill prefix"; fi
  fi
  tmp_cleanup
}
trap cleanup EXIT

make_envf || { echo "bucket values missing"; exit 2; }
"$REPO_DIR/scripts/backup-init.sh" >/dev/null
echo "== start throwaway stack ($PROJECT, root $ROOT, bucket prefix $BACKUP_PREFIX)"
# seed files (write-once store look-alike) and keep a reference copy
mkdir -p "$ROOT/files" "$W/orig"
seed() { local h; h=$(head -c "$1" /dev/urandom | tee /tmp/.drill.$$ | sha256sum | cut -c1-64); mkdir -p "$ROOT/files/${h:0:2}"; mv /tmp/.drill.$$ "$ROOT/files/${h:0:2}/$h.bin"; }
for s in 1000 50000 400000 2000000 3000 77777 1500000 12345; do seed $s; done
compose up -d --build postgres backup >/dev/null 2>&1 || { echo "FAIL: could not start the throwaway stack"; exit 1; }
for i in $(seq 90); do [ "$(dk inspect -f '{{.State.Health.Status}}' "$PG_CONTAINER" 2>/dev/null)" = healthy ] && break; sleep 2; done
PGX -c "create table drill_rows(id bigserial primary key, t timestamptz not null default clock_timestamp(), note text)" >/dev/null || { echo "FAIL: database not ready"; exit 1; }
echo "waiting for the first base backup and first push"
for i in $(seq 120); do
  [ -s "$ROOT/backup-status.json" ] && jq -e '.basebackup.last_ok and .push.last_ok' "$ROOT/backup-status.json" >/dev/null 2>&1 && break; sleep 3; done
jq -e '.basebackup.last_ok and .push.last_ok' "$ROOT/backup-status.json" >/dev/null 2>&1 && res ok "first base backup and first push to the bucket done" || { res bad "no base backup or push within 6 minutes: $(jq -r .last_error "$ROOT/backup-status.json" 2>/dev/null)"; exit 1; }
"$REPO_DIR/scripts/backup-now.sh" >/dev/null 2>&1 && res ok "backup-now.sh pushed" || res bad "backup-now.sh failed"
CHECK_SKIP_DATA=0 "$REPO_DIR/scripts/backup-check.sh" >"$W/check.out" 2>&1 && res ok "backup-check.sh says healthy" || { res bad "backup-check.sh: $(tail -1 "$W/check.out")"; }

echo "== (a) writing rows for ${WRITE_S}s while the backup loop runs"
cat > "$W/writer.sql" <<'SQL'
insert into drill_rows(note) values (repeat('x', 200)) returning id || '|' || extract(epoch from t);
\watch 0.2
SQL
( dk exec -i "$PG_CONTAINER" timeout "$WRITE_S" psql -U epaper -d epaper -qAt < "$W/writer.sql" > "$W/writes.log" 2>/dev/null ) &
WPID=$!
for i in 1 2 3 4; do sleep 4; seed 90000; done          # files written early in the window
wait $WPID
# (b)+(c) the disk dies right now: no graceful stop, no more pushes
LAST=$(grep -E '^[0-9]+\|' "$W/writes.log" | tail -1); LAST_ID=${LAST%%|*}; LAST_T=${LAST#*|}
dk kill "$PG_CONTAINER" "$BK_CONTAINER" >/dev/null 2>&1
echo "== (b) last committed row: id $LAST_ID at epoch $LAST_T"
cp -a "$ROOT/files/." "$W/orig/"
echo "== (c) simulated dead disk: deleting the Postgres volume and the local files / WAL / base backups"
compose down -v >/dev/null 2>&1
rm -rf "$ROOT/files" "$ROOT/walarchive" "$ROOT/basebackups" "$ROOT/backup-status.json"
[ -z "$(dk volume ls -q --filter "name=${PROJECT}_pgdata")" ] && res ok "database volume and local backup folders are gone" || res bad "volume still there"

echo "== (d) restore from the bucket only"
T0=$(date +%s)
"$REPO_DIR/scripts/restore.sh" --root "$ROOT" --project "$PROJECT" --services "postgres backup" >"$W/restore.out" 2>&1; RC=$?
RT=$(( $(date +%s) - T0 ))
tail -12 "$W/restore.out"
[ $RC = 0 ] && res ok "restore.sh finished" || { res bad "restore.sh exit $RC"; exit 1; }

echo "== (e) rows"
ROWS=$(PGX -c "select count(*) from drill_rows"); MAXID=$(PGX -c "select coalesce(max(id),0) from drill_rows")
MAXT=$(PGX -c "select coalesce(extract(epoch from max(t)),0) from drill_rows")
LOSS=$(python3 -c "print(max(0.0, round(float('$LAST_T') - float('$MAXT'), 1)))")
echo "rows written (last id): $LAST_ID   rows restored: $ROWS   lost rows: $((LAST_ID - MAXID))   seconds of writes lost: $LOSS"
[ "$ROWS" = "$MAXID" ] && res ok "no gaps in the restored rows (rows 1..$MAXID all present)" || res bad "gap in restored rows ($ROWS rows, max id $MAXID)"
python3 -c "import sys; sys.exit(0 if float('$LOSS') <= 60 else 1)" && res ok "lost $LOSS s of writes (target 60 s or less)" || res bad "lost $LOSS s of writes (target 60 s or less)"
[ "$RT" -le 3600 ] && res ok "restore took $RT s (target 3600 s)" || res bad "restore took $RT s"
echo "== (f) files"
diff -r "$W/orig" "$ROOT/files" >/dev/null 2>&1 && res ok "all $(find "$ROOT/files" -type f | wc -l) files are byte-identical" || res bad "restored files differ"
echo "== second restore without --force must refuse"
"$REPO_DIR/scripts/restore.sh" --root "$ROOT" --project "$PROJECT" --services "postgres backup" >"$W/restore2.out" 2>&1; RC2=$?
[ $RC2 = 3 ] && res ok "second run refused to overwrite live data and changed nothing" || res bad "second run exit $RC2 (wanted 3)"
echo
echo "RESULT: $PASS passed, $FAILN failed.  seconds_lost=$LOSS restore_seconds=$RT"
[ $FAILN = 0 ]
