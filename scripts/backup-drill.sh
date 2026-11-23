#!/usr/bin/env bash
# Backup drill: files (restic) + database (WAL-G) to the off-box bucket, restore into empty
# containers, compare. Uses a throwaway Postgres and the prefix epaper-drill, never the live stack.
# Run as a user in the docker group.  Usage: scripts/backup-drill.sh
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
S=${TMPDIR:-/tmp}; export BACKUP_PREFIX=${BACKUP_PREFIX:-epaper-drill}
ENVF=$("$HERE/lib/backup-env.sh") || exit 2
IMG=epaper/postgres-walg:17.2-3.0.5
W=$(mktemp -d "$S/drill.XXXXXX")
cleanup() { rm -f "$ENVF"; docker rm -f drill-a drill-b >/dev/null 2>&1; docker volume rm drill-a-data drill-b-data >/dev/null 2>&1; rm -rf "$W"; }
trap cleanup EXIT
ok=0; fail() { echo "FAIL: $*"; ok=1; }
# TCP check on purpose: during first start the image runs a temporary socket-only server that then restarts.
pgwait() { for i in $(seq 60); do docker exec "$1" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && return 0; sleep 1; done; return 1; }
PGARGS=(-c wal_level=replica -c archive_mode=on -c "archive_command=wal-g wal-push %p" -c archive_timeout=10)

echo "== files: restic backup + restore"
mkdir -p "$W/files/a/b" "$W/restore"; head -c 200000 /dev/urandom > "$W/files/a/b/blob.bin"; echo "hello" > "$W/files/a/note.txt"
R=(docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp --env-file "$ENVF" -v "$W/files:/data/files:ro" -v "$W/restore:/restore" restic/restic:0.17.3)
"${R[@]}" cat config >/dev/null 2>&1 || "${R[@]}" init >/dev/null 2>&1
"${R[@]}" backup --host drill --tag drill /data/files 2>&1 | grep -E 'snapshot .* saved' || fail "restic backup"
"${R[@]}" restore latest --tag drill --target /restore >/dev/null 2>&1
diff -r "$W/files" "$W/restore/data/files" && echo "files identical" || fail "files differ"

echo "== database: WAL-G base backup + WAL, then restore into a fresh container"
docker volume create drill-a-data >/dev/null
docker run -d --name drill-a --env-file "$ENVF" -e POSTGRES_PASSWORD=drill -v drill-a-data:/var/lib/postgresql/data "$IMG" postgres "${PGARGS[@]}" >/dev/null
pgwait drill-a || { docker logs --tail 15 drill-a 2>&1 | cut -c1-200; fail "postgres A did not start"; }
docker exec drill-a psql -U postgres -qc "create table drill(id serial primary key, note text); insert into drill(note) select 'row '||g from generate_series(1,1000) g;"
timeout 180 docker exec -u postgres drill-a bash -c 'wal-g backup-push $PGDATA' >"$W/push.log" 2>&1 || { tail -5 "$W/push.log"; fail "backup-push"; }
docker exec drill-a psql -U postgres -qc "insert into drill(note) values ('after-base-backup'); select pg_switch_wal();" >/dev/null
sleep 15
docker exec -u postgres drill-a wal-g backup-list 2>&1 | tail -1
docker exec -u postgres drill-a wal-g backup-list 2>&1 | grep -q base_ || { fail "no base backup in the bucket"; exit 1; }
A=$(docker exec drill-a psql -U postgres -Atc 'select count(*) from drill'); echo "rows in A: $A"
docker rm -f drill-a >/dev/null

# restore: empty data dir, fetch base backup, replay archived WAL to the end
docker volume create drill-b-data >/dev/null
timeout 300 docker run --rm --env-file "$ENVF" -v drill-b-data:/var/lib/postgresql/data --user postgres --entrypoint bash "$IMG" -c \
  'wal-g backup-fetch /var/lib/postgresql/data LATEST && touch /var/lib/postgresql/data/recovery.signal && echo "restore_command = '"'"'wal-g wal-fetch %f %p'"'"'" >> /var/lib/postgresql/data/postgresql.auto.conf' 2>&1 | tail -3; [ "${PIPESTATUS[0]}" = 0 ] || fail "backup-fetch"
docker run -d --name drill-b --env-file "$ENVF" -e POSTGRES_PASSWORD=drill -v drill-b-data:/var/lib/postgresql/data "$IMG" >/dev/null
pgwait drill-b || { docker logs --tail 15 drill-b 2>&1 | cut -c1-200; fail "postgres B did not start"; }
for i in $(seq 30); do [ "$(docker exec drill-b psql -U postgres -Atc 'select pg_is_in_recovery()' 2>/dev/null)" = f ] && break; sleep 1; done
B=$(docker exec drill-b psql -U postgres -Atc 'select count(*) from drill' 2>/dev/null); echo "rows in B (restored): $B"
[ "$A" = "$B" ] && [ -n "$B" ] && echo "DB RESTORE MATCHES (base backup + WAL replay)" || fail "row counts differ ($A vs $B)"
[ $ok = 0 ] && echo "DRILL PASSED" || echo "DRILL FAILED"; exit $ok
