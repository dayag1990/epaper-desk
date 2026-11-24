#!/usr/bin/env bash
# Restore drill against the REAL bucket, READ-ONLY (owner rule 2026-11-24: drills never write or delete in the bucket).
#   - reads the newest backup of the live prefix with `restic ... --no-lock` (a lock file would be a write)
#   - restores only the database base backups and the archived log into a throwaway folder
#   - starts a throwaway Postgres from it (compose-less, project name drill-realro), replays the log, counts rows,
#     compares with the live database (a read-only SELECT)
#   - removes everything it made; the bucket and the live stack are never changed
# Run it as the epaper user. Prints PASS/FAIL lines and, on a bucket error, the exact error text.
#   scripts/restore-readonly-drill.sh
set -uo pipefail
export COMPOSE_PROJECT=drill-realro
W=${DRILL_DIR:-/srv/epaper/drill-realro}
export BACKUP_ROOT="$W"
. "$(dirname "$0")/lib/backup-common.sh"
. "$(dirname "$0")/lib/desk-ops.sh"
[ "$PROJECT" = drill-realro ] || { echo "refusing: wrong project $PROJECT" >&2; exit 2; }
[ -z "${BACKUP_REPO_LOCAL:-}" ] || echo "(using a local repository stand-in: $BACKUP_REPO_LOCAL)"
ROOT="$W"; ENV_FILE=${EPAPER_ENV:-/srv/epaper/.env}; export EPAPER_ENV=$ENV_FILE
PASS=0; FAILN=0; ID=r$(date -u +%Y%m%dT%H%M%SZ)
res() { if [ "$1" = ok ]; then echo "PASS: $2"; PASS=$((PASS+1)); else echo "FAIL: $2"; FAILN=$((FAILN+1)); fi; }
cleanup() {
  dk stop -t 20 "${PROJECT}-restore-$ID" >/dev/null 2>&1 || true
  dk_out --user 0 -v "$W:/r" --entrypoint bash "$PG_IMAGE" -c 'rm -rf /r/* /r/.[!.]*' >/dev/null 2>&1 || true
  rmdir "$W" 2>/dev/null || true
  dk network rm "${PROJECT}_default" >/dev/null 2>&1 || true
  tmp_cleanup
  echo "cleaned up: $W and the throwaway database are gone; nothing was written to the bucket."
}
trap cleanup EXIT
mkdir -p "$W" || { echo "cannot make $W"; exit 2; }
# the bucket values, for the plain-words reason when Backblaze refuses (never printed)
for k in BACKUP_S3_ENDPOINT BACKUP_S3_KEY BACKUP_S3_SECRET; do v=$(grep -E "^$k=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-); [ -n "$v" ] && export "$k=$v"; done
make_envf || { echo "FAIL: the bucket values are missing in $ENV_FILE"; exit 2; }

echo "== 1. read the newest backup list (no lock, read only)"
err="$W/restic.err"
snaps=$(restic_run -- snapshots --no-lock --host epaper --tag auto --latest 1 --json 2>"$err"); rc=$?
if [ $rc -ne 0 ] || [ "$(jq 'length' <<<"$snaps" 2>/dev/null || echo 0)" -lt 1 ]; then
  echo "FAIL: the bucket could not be read. Exact answer from restic:"; echo "$snaps" | tail -5; cat "$err" 2>/dev/null | tail -5
  echo "(Backblaze's own reason, read once:)"; b2_refusal 2>/dev/null || true
  exit 3
fi
sid=$(jq -r '.[-1].short_id' <<<"$snaps"); stime=$(jq -r '.[-1].time' <<<"$snaps")
res ok "newest backup in the bucket: $sid from $stime ($(( ($(date +%s) - $(date -u -d "$stime" +%s)) / 60 )) minutes ago)"

echo "== 2. fetch the base backups and the log archive (read only)"
t0=$(date +%s)
restic_run -v "$W:/target" -- restore latest --no-lock --host epaper --tag auto --target /target/rt --include /data/basebackups --include /data/walarchive >"$W/restore.log" 2>&1 \
  || { echo "FAIL: restic restore failed. Exact answer:"; tail -5 "$W/restore.log"; exit 4; }
[ -d "$W/rt/data/basebackups" ] || { echo "FAIL: the backup holds no base backups folder"; exit 4; }
mv "$W/rt/data/basebackups" "$W/basebackups"; mv "$W/rt/data/walarchive" "$W/walarchive" 2>/dev/null || mkdir -p "$W/walarchive"
res ok "fetched $(du -sh "$W/basebackups" | cut -f1) of base backups and $(find "$W/walarchive" -type f | wc -l) log files in $(( $(date +%s) - t0 )) s"
chmod -R a+rX "$W/basebackups" "$W/walarchive" 2>/dev/null || true

echo "== 3. throwaway database from them"
bb=$(pick_base "") || { res bad "no base backup passed its checksum"; exit 5; }
res ok "base backup $bb passed its checksum"
dk network create "${PROJECT}_default" >/dev/null 2>&1 || true
( start_copy "$ID" "$bb" "" && wait_copy "$ID" ) >"$W/copy.log" 2>&1 || { res bad "the throwaway database did not come up: $(tail -2 "$W/copy.log" | tr '\n' ' ')"; exit 6; }
res ok "database replayed the archived log and left recovery"

echo "== 4. look inside and compare with the live database"
out=$(pg_client "$COUNTS_FN"'; counts postgres-restore-'"$ID" 2>/dev/null) || out=""
[ -n "$out" ] && [ "$out" != "none|0" ] || { res bad "the restored database has no tables"; exit 7; }
res ok "restored database has $(wc -l <<<"$out") tables"
for t in papers articles editions pages assets users; do
  r=$(awk -F'|' -v t="$t" '$1==t{print $2}' <<<"$out")
  l=$(dk exec epaper-postgres psql -U epaper -d epaper -Atc "select count(*) from public.$t" 2>/dev/null || echo "?")
  [ -n "$r" ] || continue
  if [ "$l" != "?" ] && [ "$r" -le "$l" ] && [ $(( l - r )) -le 25 ]; then res ok "$t: restored $r, live $l"; else res bad "$t: restored $r, live $l (more than 25 apart)"; fi
done
echo "RESULT: $PASS passed, $FAILN failed"
[ $FAILN -eq 0 ]
