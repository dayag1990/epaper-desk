#!/usr/bin/env bash
# Break-it drills for the ops desk (M13 done_when list), run against a THROWAWAY compose project.
#
#   scripts/ops-drill.sh up        build nothing big: tag releases, mount a small disk, start the throwaway stack, enrol the desk
#   scripts/ops-drill.sh a|b1 b2|c|d|f|g   one drill (see below; b is two parts because the gap is a real 5 minutes)
#   scripts/ops-drill.sh rebuild   after changing desk code: rebuild the desk image and replace only the desk container
#   scripts/ops-drill.sh converge  bring every container of the throwaway project to its configured state
#   (e) is scripts/backup-drill.sh with BACKUP_REPO_LOCAL set (see its header); it uses its own project, epaper-bk.
#   scripts/ops-drill.sh down      remove ONLY the throwaway project, its small disk and its temp folder
#
#   a  stop each container in turn: light red within 30 s, one tap brings it back
#   b  drop a table, restore to 5 minutes earlier: rows back, newer rows still in the old copy
#   c  broken release rolled back from the desk in under 2 minutes
#   d  disk 95% full (a small tmpfs the desk is pointed at): desk frees space, no original and no backup touched
#   f  api, worker and Postgres all stopped: the desk still loads and starts them
#   g  a planted fault fixed from the desk alone (no terminal: only the desk's HTTP buttons are used)
#
# Safety: the project is `drill-ops` (name the Docker guard accepts as throwaway), every container is drill-ops-*, ports are
# 127.0.0.1:181xx, all data is under $DRILL_ROOT (default /srv/epaper/drill-tmp). It never names the live project, the live
# volume or /srv/epaper/files. The off-box bucket is NOT used: a local restic repository ($DRILL_ROOT/bucket) stands in for it,
# because the real bucket key is refused on any prefix but the live one. So "the bucket" part of these drills is a stand-in.
# Docker needs sudo on this box; ops-drill.sh puts a wrapper first on PATH for that.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/.." && pwd)
DR=${DRILL_ROOT:-/srv/epaper/drill-tmp}
PROJ=drill-ops
mkdir -p "$DR/bin" "$DR/cfg"
if [ ! -x "$DR/bin/docker" ]; then
  printf '#!/usr/bin/env bash\nexec sudo -E %s "$@"\n' "${DOCKER_SHIM:-/home/epaper/.local/bin/docker}" > "$DR/bin/docker"; chmod +x "$DR/bin/docker"
fi
export PATH="$DR/bin:$PATH"
export COMPOSE_PROJECT=$PROJ BACKUP_ROOT=$DR/root EPAPER_ENV=${EPAPER_ENV:-/srv/epaper/.env} BACKUP_PREFIX=epaper-drill
export PG_CONTAINER=drill-ops-postgres BK_CONTAINER=drill-ops-backup DRILL_ROOT=$DR REPO
export BACKUP_REPO_LOCAL=$DR/bucket BACKUP_PASSWORD=drill-only-restic-password
export API_IMAGE=drill-ops-api WORKER_IMAGE=drill-ops-worker OPS_IMAGE=drill-ops-ops
export OPS_STATE_DIR=$DR/root/files/_ops
export OPS_COMPOSE_FILES=$REPO/docker-compose.yml:$REPO/docker-compose.ops.yml:$REPO/ops/drill/docker-compose.drill.yml
[ "$PROJ" = epaper ] && { echo "refusing to run on the live project" >&2; exit 2; }
. "$HERE/lib/backup-common.sh"
DESK=http://127.0.0.1:18101
D() { node "$HERE/ops-drill/desk.mjs" "$@"; }
RES="$DR/results.txt"
PASS=0; FAILN=0
res() { if [ "$1" = ok ]; then echo "PASS: $2"; PASS=$((PASS+1)); else echo "FAIL: $2"; FAILN=$((FAILN+1)); fi; echo "$1 | $2" >> "$RES"; }
PGX() { dk exec -i "$PG_CONTAINER" psql -U epaper -d epaper -qAt -v ON_ERROR_STOP=1 "$@"; }
now_s() { date +%s.%N; }
since() { python3 -c "print(round($(now_s) - $1, 1))"; }
state_of() { D light "$1" 2>/dev/null; }   # green | amber | red | unknown
release_ptr() { cat "$OPS_STATE_DIR/current" 2>/dev/null; }

# The drill's service list: same rows, drill container names. The small drill disk is 96 MB, so the "20 GB free" part of the
# disk rule cannot apply; the percentage rule (red from 90 %) stays.
gen_services() {
  sed -e 's/container: epaper-/container: drill-ops-/' -e 's/ready: disk_free_gb >= 20 and disk_used_pct < 90/ready: disk_used_pct < 90/' "$REPO/ops/services.yml" > "$DR/cfg/services.yml"
}
# ------------------------------------------------------------------------------------------------ up / down
cmd_up() {
  mkdir -p "$DR/bucket" "$DR/root" "$DR/reader" "$DR/caddy" "$DR/cfg"; chmod 777 "$DR/caddy" "$DR/bucket"
  gen_services
  if ! mountpoint -q "$DR/root/files"; then
    mkdir -p "$DR/root/files"
    sudo mount -t tmpfs -o size=96m,uid=1001,gid=1001,mode=0755 tmpfs "$DR/root/files" || { echo "cannot mount the small disk"; exit 1; }
  fi
  BACKUP_ROOT=$DR/root bash "$REPO/scripts/backup-init.sh" >/dev/null
  mkdir -p "$OPS_STATE_DIR"
  echo "== images: release tags 2026-11-24.1 (good) and .2 (broken), desk image from this checkout"
  dk tag epaper/api:dev "$API_IMAGE:2026-11-24.1"; dk tag epaper/worker:dev "$WORKER_IMAGE:2026-11-24.1"
  dk image inspect "$OPS_IMAGE:drill" >/dev/null 2>&1 || dk build -q -f "$REPO/apps/ops/Dockerfile" -t "$OPS_IMAGE:drill" "$REPO" >/dev/null || { echo "desk image build failed"; exit 1; }
  dk tag "$OPS_IMAGE:drill" "$OPS_IMAGE:2026-11-24.1"; dk tag "$OPS_IMAGE:drill" "$OPS_IMAGE:2026-11-24.2"
  printf 'FROM epaper/api:dev\nCMD ["node","-e","console.error(\\"this release is broken on purpose\\");process.exit(3)"]\n' | dk build -q -t "$API_IMAGE:2026-11-24.2" - >/dev/null
  printf 'FROM epaper/worker:dev\nCMD ["node","-e","console.error(\\"this release is broken on purpose\\");process.exit(3)"]\n' | dk build -q -t "$WORKER_IMAGE:2026-11-24.2" - >/dev/null
  echo 2026-11-24.1 > "$OPS_STATE_DIR/current"
  echo "== start the throwaway stack ($PROJ)"
  local t0; t0=$(now_s)
  compose up -d --no-build >/dev/null 2>"$DR/up.err" || { cat "$DR/up.err" | tail -5; echo "FAIL: the throwaway stack did not start"; exit 1; }
  for i in $(seq 120); do
    bad=0; for c in postgres api worker caddy ops backup dockerproxy dockerguard; do
      [ "$(dk inspect -f '{{.State.Health.Status}}' "drill-ops-$c" 2>/dev/null)" = healthy ] || bad=1; done
    [ $bad = 0 ] && break; sleep 3; done
  [ $bad = 0 ] && echo "stack healthy in $(since "$t0") s" || { dk ps -a --filter "label=com.docker.compose.project=$PROJ" --format '{{.Names}} {{.Status}}'; echo "FAIL: stack not healthy"; exit 1; }
  D enrol >/dev/null && echo "desk login ready" || { echo "FAIL: could not enrol the desk"; exit 1; }
  echo "== waiting for the first base backup and push"
  for i in $(seq 100); do jq -e '.basebackup.last_ok and .push.last_ok' "$DR/root/backup-status.json" >/dev/null 2>&1 && break; sleep 3; done
  jq -e '.basebackup.last_ok and .push.last_ok' "$DR/root/backup-status.json" >/dev/null 2>&1 && echo "first base backup and push done" || { echo "FAIL: no first backup: $(jq -r .last_error "$DR/root/backup-status.json")"; exit 1; }
}

cmd_down() {
  echo "== removing the throwaway project $PROJ"
  compose down -v --remove-orphans >/dev/null 2>&1
  local ids; ids=$(dk ps -aq --filter "label=com.docker.compose.project=$PROJ"); [ -n "$ids" ] && dk rm -f $ids >/dev/null 2>&1
  ids=$(dk ps -aq --filter "name=^$PROJ-restore-"); [ -n "$ids" ] && dk rm -f $ids >/dev/null 2>&1
  ids=$(dk volume ls -q --filter "label=com.docker.compose.project=$PROJ"); [ -n "$ids" ] && dk volume rm $ids >/dev/null 2>&1
  dk network ls -q --filter "name=^${PROJ}_" | xargs -r docker network rm >/dev/null 2>&1
  dk image inspect drill-ops-backup:e >/dev/null 2>&1 && dk rmi drill-ops-backup:e >/dev/null 2>&1
  for img in "$API_IMAGE" "$WORKER_IMAGE" "$OPS_IMAGE"; do for v in 2026-11-24.1 2026-11-24.2 drill e; do dk image inspect "$img:$v" >/dev/null 2>&1 && dk rmi "$img:$v" >/dev/null 2>&1; done; done
  if make_envf 2>/dev/null; then
    local sn; sn=$(restic_run -- snapshots --json 2>/dev/null | jq -r '.[].id' | tr '\n' ' ')
    [ -n "$sn" ] && { restic_run -- forget --prune $sn >/dev/null 2>&1 && echo "emptied the epaper-drill prefix in the bucket" || echo "WARNING: could not empty the epaper-drill prefix"; }
  fi
  tmp_cleanup
  mountpoint -q "$DR/root/files" && sudo umount "$DR/root/files"
  sudo rm -rf "$DR/root" "$DR/caddy" "$DR/reader" "$DR/up.err" "$DR/work" 2>/dev/null
  echo "done"
}


# ------------------------------------------------------------------------------------------------ helpers for drills
jfield() { python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(eval(sys.argv[1]))" "$1"; }
tap() { D req POST "$1" "${2:-}" ; }          # one press of a desk button; prints {"status","ms","body"}
wait_green() {  # wait_green <row>... <seconds>: every named row green; prints seconds
  local lim=${@: -1} t0; t0=$(now_s); local rows=("${@:1:$#-1}") r
  while :; do
    local ok=1; for r in "${rows[@]}"; do [ "$(state_of "$r")" = green ] || ok=0; done
    [ $ok = 1 ] && { since "$t0"; return 0; }
    python3 -c "import sys; sys.exit(0 if $(now_s) - $t0 < $lim else 1)" || { since "$t0"; return 1; }
    sleep 1
  done
}
all_up_check() { for r in api worker postgres proxy backup-service; do [ "$(state_of "$r")" = green ] || return 1; done; }

# ------------------------------------------------------------------------------------------------ (a) stop each container
cmd_a() {
  echo "== (a) stop each container in turn: light red within 30 s, one tap brings it back"
  local row cont t0 red tapms body code back
  for pair in api:api worker:worker postgres:postgres proxy:caddy backup-service:backup; do
    row=${pair%%:*}; cont=drill-ops-${pair##*:}
    wait_green "$row" 120 >/dev/null || { res bad "(a) $row: not green before the test"; continue; }
    dk stop -t 3 "$cont" >/dev/null 2>&1
    t0=$(now_s)
    red=$(D waitlight "$row" red 60) || red=999
    local t1; t1=$(now_s)
    body=$(tap "/ops/services/$row/restart"); code=$(echo "$body" | jfield 'd["status"]'); tapms=$(echo "$body" | jfield 'd["ms"]')
    back=$(wait_green "$row" 60) || back=999
    local tap_s; tap_s=$(python3 -c "print(round($tapms/1000,1))")
    if python3 -c "import sys; sys.exit(0 if $red <= 30 and $code == 200 and $back < 60 else 1)"; then
      res ok "(a) $row ($cont): light red after $red s; one tap -> HTTP $code, healthy after $tap_s s (light green)"
    else res bad "(a) $row ($cont): red after $red s (limit 30), tap HTTP $code in $tap_s s, green after $back s"; fi
    # dependants (api, worker) must come back by themselves after the database
    if [ "$row" = postgres ]; then
      local b2; b2=$(wait_green api worker 120) && res ok "(a) after the database tap api and worker are green again by themselves ($b2 s)" || res bad "(a) api/worker did not recover after the database tap ($b2 s)"
    fi
  done
  # the desk itself: stopping it cannot be shown on its own page; the restart tap is what the owner has
  local t0 body; t0=$(now_s); body=$(tap /ops/services/ops/restart); echo "$body" | jfield '"desk said: "+d["body"]["message"]'
  for i in $(seq 60); do sleep 1; D up 2>/dev/null && break; done
  local back; back=$(since "$t0")
  [ "$(state_of ops)" = green ] && res ok "(a) ops (this desk): restart tap -> page back after $back s. A STOPPED desk cannot press its own button (see limits)" || res bad "(a) the desk did not come back ($back s)"
}

# ------------------------------------------------------------------------------------------------ (f) everything down
cmd_f() {
  echo "== (f) api, worker and Postgres all stopped: the desk still loads and starts them"
  wait_green api worker postgres 120 >/dev/null || echo 'note: not all green before the test'
  dk stop -t 3 drill-ops-worker drill-ops-api drill-ops-postgres >/dev/null 2>&1
  local t0; t0=$(now_s)
  local r; r=$(D req GET /ops/status); local code ms; code=$(echo "$r" | jfield 'd["status"]'); ms=$(echo "$r" | jfield 'd["ms"]')
  local reds; reds=$(echo "$r" | jfield '",".join(s["name"] for s in d["body"]["services"] if s["state"]=="red" and s["name"] in ("api","worker","postgres"))')
  [ "$code" = 200 ] && [ "$reds" = "api,worker,postgres" ] && res ok "(f) desk answers with all three stopped: /ops/status HTTP 200 in $ms ms, api+worker+postgres red" || res bad "(f) status $code, red rows: $reds"
  local page; page=$(curl -s -m 20 -o /dev/null -w '%{http_code} %{size_download}' -H "Cookie: $(python3 -c "import json;print(json.load(open('$DR/desk-client.json'))['cookie'])")" $DESK/)
  case "$page" in 200\ *) res ok "(f) the dashboard page loads (HTTP $page bytes)";; *) res bad "(f) dashboard page: $page";; esac
  local body; body=$(tap /ops/up); code=$(echo "$body" | jfield 'd["status"]'); ms=$(echo "$body" | jfield 'd["ms"]')
  local g; g=$(wait_green api worker postgres 60) || true
  if [ "$code" = 200 ] && all_up_check; then res ok "(f) 'Bring everything up': HTTP 200, api+worker+postgres green again; the tap took $(python3 -c "print(round($ms/1000,1))") s"
  else res bad "(f) 'Bring everything up': HTTP $code $(echo "$body" | jfield 'd["body"]' | cut -c1-200)"; fi
}

# ------------------------------------------------------------------------------------------------ (c) broken release
cmd_c() {
  echo "== (c) a broken release is rolled back from the desk in under 2 minutes"
  wait_green api worker 120 >/dev/null
  [ "$(release_ptr)" = 2026-11-24.1 ] || { echo 2026-11-24.1 > "$OPS_STATE_DIR/current"; }
  echo "shipping release 2026-11-24.2 (built to crash on start)"
  echo 2026-11-24.2 > "$OPS_STATE_DIR/current"
  EPAPER_RELEASE=2026-11-24.2 compose up -d --no-build api worker >/dev/null 2>&1 || true
  local red; red=$(D waitlight api red 60) || red=999
  res "$([ "$red" != 999 ] && echo ok || echo bad)" "(c) the broken release shows as a red api light after $red s"
  local rel; rel=$(D req GET /ops/releases); echo "$rel" | jfield '"desk lists releases: "+str(d["body"]["kept"])+", current "+str(d["body"]["current"])'
  local t0; t0=$(now_s)
  local b1; b1=$(tap /ops/releases/2026-11-24.1/rollback); echo "$b1" | jfield '"without the typed word: HTTP %s, %s" % (d["status"], d["body"]["error"][:90])'
  local body; body=$(tap /ops/releases/2026-11-24.1/rollback '{"confirm":"ROLLBACK"}'); local code ms; code=$(echo "$body" | jfield 'd["status"]'); ms=$(echo "$body" | jfield 'd["ms"]')
  local g; g=$(wait_green api worker 60) || g=999
  local total; total=$(since "$t0")
  if [ "$code" = 200 ] && [ "$(release_ptr)" = 2026-11-24.1 ] && python3 -c "import sys; sys.exit(0 if $total < 120 else 1)"; then
    res ok "(c) rollback: HTTP 200 after $(python3 -c "print(round($ms/1000,1))") s; api+worker green; total from the typed word to green $total s (limit 120 s); a safety copy was taken first"
  else res bad "(c) rollback HTTP $code in $total s: $(echo "$body" | jfield 'd["body"]' | cut -c1-300)"; fi
  ls "$DR/root/snapshots" 2>/dev/null | grep -q reason && res ok "(c) the safety copy exists: $(ls "$DR/root/snapshots" | grep -c sql.gz) database dump(s) in snapshots/" || res bad "(c) no safety copy found"
  local again; again=$(tap /ops/releases/2026-11-24.1/rollback '{"confirm":"ROLLBACK"}'); echo "$again" | jfield 'd["body"].get("already") and "second press: already on the release, nothing done"' | grep -q already && res ok "(c) pressing rollback twice is safe" || res bad "(c) second press not a no-op"
}


# ------------------------------------------------------------------------------------------------ (b) drop a table, restore 5 minutes earlier
# Two parts because the gap is real (DRILL_GAP_S, default 300 s = 5 minutes between the restore point and the drop).
SQLTAB="select count(*) || ':' || coalesce(md5(string_agg(id || '/' || note, ',' order by id)), '-') from"
cmd_b1() {
  echo "== (b) part 1: write rows, note the restore point, wait ${DRILL_GAP_S:-300} s while newer rows arrive, then DROP TABLE"
  wait_green postgres api worker 120 >/dev/null || echo "note: not all green"
  PGX -c "drop table if exists drill_rows, drill_keep" >/dev/null
  PGX -c "create table drill_rows(id int primary key, note text not null)" -c "create table drill_keep(id serial primary key, t timestamptz default now(), note text)" >/dev/null
  PGX -c "insert into drill_rows select g, 'row-' || g || '-' || md5(g::text) from generate_series(1, 300) g" -c "insert into drill_keep(note) select 'before-' || g from generate_series(1, 40) g" >/dev/null
  sleep 3
  local target; target=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  echo "$target" > "$DR/b-target"
  PGX -c "$SQLTAB drill_rows" > "$DR/b-expect-rows"; PGX -c "select count(*) from drill_keep" > "$DR/b-keep-before"
  echo "restore point: $target; drill_rows = $(cat "$DR/b-expect-rows" | cut -c1-12)..."
  sleep 3
  local gap=${DRILL_GAP_S:-300} i
  for i in $(seq $((gap / 30))); do   # newer rows keep arriving in the table that is NOT dropped
    PGX -c "insert into drill_keep(note) select 'after-$i-' || g from generate_series(1, 10) g" >/dev/null; sleep 30
  done
  PGX -c "select count(*) from drill_keep" > "$DR/b-keep-at-drop"
  echo "newer rows written after the restore point: $(( $(cat "$DR/b-keep-at-drop") - $(cat "$DR/b-keep-before") ))"
  PGX -c "drop table drill_rows" >/dev/null && echo "DROPPED drill_rows at $(date -u +%H:%M:%SZ)"
  date -u +%Y-%m-%dT%H:%M:%SZ > "$DR/b-dropped"
  PGX -c "select pg_switch_wal()" >/dev/null
  local t0; t0=$(now_s)
  for i in $(seq 60); do
    [ "$(PGX -c "select last_archived_time > now() - interval '15 seconds' from pg_stat_archiver")" = t ] && break; sleep 2; done
  echo "the log up to the drop is archived ($(since "$t0") s)"
}
cmd_b2() {
  echo "== (b) part 2: restore from the desk to the restore point, compare, switch"
  local target; target=$(cat "$DR/b-target")
  [ -n "$target" ] || { res bad "(b) no restore point; run b1 first"; return; }
  PGX -c "select to_regclass('drill_rows') is null" | grep -q t && res ok "(b) before: drill_rows is gone from the live database" || res bad "(b) drill_rows still exists"
  local r1; r1=$(tap /ops/db/restore "{\"to\":\"$target\"}"); echo "$r1" | jfield '"without the typed word: HTTP %s, %s" % (d["status"], d["body"]["error"][:80])'
  local t0 body code ms id
  t0=$(now_s); body=$(tap /ops/db/restore "{\"to\":\"$target\",\"confirm\":\"RESTORE\"}"); code=$(echo "$body" | jfield 'd["status"]'); ms=$(echo "$body" | jfield 'd["ms"]')
  if [ "$code" != 200 ]; then res bad "(b) restore HTTP $code: $(echo "$body" | jfield 'd["body"]' | cut -c1-400)"; return; fi
  id=$(echo "$body" | jfield 'd["body"]["id"]')
  echo "$body" | jfield '"side by side: " + ", ".join("%s live=%s restored=%s" % (c["table"], c["live"], c["restored"]) for c in d["body"]["counts"] if c["table"].startswith("drill_"))'
  local rest_rows live_rows keep_live keep_rest
  rest_rows=$(echo "$body" | jfield '[c["restored"] for c in d["body"]["counts"] if c["table"]=="drill_rows"][0]'); live_rows=$(echo "$body" | jfield '[c["live"] for c in d["body"]["counts"] if c["table"]=="drill_rows"][0]')
  keep_live=$(echo "$body" | jfield '[c["live"] for c in d["body"]["counts"] if c["table"]=="drill_keep"][0]'); keep_rest=$(echo "$body" | jfield '[c["restored"] for c in d["body"]["counts"] if c["table"]=="drill_keep"][0]')
  local want_rows=${rest_rows}; [ "$live_rows" = 0 ] && [ "$rest_rows" = 300 ] && res ok "(b) the second database was built in $(python3 -c "print(round($ms/1000,1))") s: drill_rows live 0, restored 300; drill_keep live $keep_live, restored $keep_rest (live untouched beside it)" || res bad "(b) counts: live_rows=$live_rows restored_rows=$rest_rows"
  PGX -c "select to_regclass('drill_rows') is null" | grep -q t && res ok "(b) the live database was not changed by building the copy" || res bad "(b) live database changed"
  local sw; t0=$(now_s); sw=$(tap "/ops/db/restore/$id/switch" '{"confirm":"SWITCH"}'); code=$(echo "$sw" | jfield 'd["status"]'); ms=$(echo "$sw" | jfield 'd["ms"]')
  [ "$code" = 200 ] && res ok "(b) switch: HTTP 200 in $(python3 -c "print(round($ms/1000,1))") s ($(echo "$sw" | jfield 'd["body"]["message"][:120]'))" || { res bad "(b) switch HTTP $code: $(echo "$sw" | jfield 'd["body"]' | cut -c1-400)"; return; }
  cmd_b3
}
cmd_b3() {
  echo "== (b) part 3: what the live database holds after the switch"
  wait_green postgres api worker 90 >/dev/null || true
  local got; got=$(PGX -c "$SQLTAB drill_rows" 2>&1)
  [ "$got" = "$(cat "$DR/b-expect-rows")" ] && res ok "(b) after the switch every row is back: drill_rows = $(echo "$got" | cut -d: -f1) rows, identical checksum to the moment of the restore point" || res bad "(b) rows differ: got '$got' want '$(cat "$DR/b-expect-rows")'"
  local keep_now; keep_now=$(PGX -c "select count(*) from drill_keep")
  [ "$keep_now" = "$(cat "$DR/b-keep-before")" ] && res ok "(b) the live database is exactly as of the restore point (drill_keep has $keep_now rows, the newer ones are not in it)" || res bad "(b) drill_keep has $keep_now rows, wanted $(cat "$DR/b-keep-before")"
  # the old copy: the original volume is still there and still holds the newer rows
  local vol="${PROJ}_pgdata" copy="$DR/work/oldcopy"
  sudo rm -rf "$copy"; mkdir -p "$DR/work"
  dk volume inspect "$vol" >/dev/null 2>&1 && res ok "(b) the old database volume $vol still exists" || res bad "(b) the old database volume is gone"
  dk run --rm --user 0 -v "$vol:/v:ro" -v "$DR/work:/w" --entrypoint bash "$PG_IMAGE" -c 'mkdir -p /w/oldcopy && cp -a /v/. /w/oldcopy/ && chown -R 999:999 /w/oldcopy' >/dev/null 2>&1
  dk run -d --rm --name drill-ops-oldcopy --user 999:999 -v "$copy:/var/lib/postgresql/data" -e POSTGRES_HOST_AUTH_METHOD=trust "$PG_IMAGE" postgres -c archive_mode=off -c wal_level=replica >/dev/null 2>&1
  local keep_old="" i
  for i in $(seq 40); do keep_old=$(dk exec drill-ops-oldcopy psql -U epaper -d epaper -qAt -c "select count(*) from drill_keep" 2>/dev/null) && [ -n "$keep_old" ] && break; sleep 2; done
  local want_old; want_old=$(cat "$DR/b-keep-at-drop")
  [ "$keep_old" = "$want_old" ] && res ok "(b) the old copy still holds the newer rows: drill_keep has $keep_old rows there (restored copy has $keep_now)" || res bad "(b) old copy drill_keep=$keep_old, wanted $want_old"
  dk stop -t 5 drill-ops-oldcopy >/dev/null 2>&1; sudo rm -rf "$copy"
  # backups carry on on the new timeline
  PGX -c "insert into drill_keep(note) values ('after the switch')" -c "select pg_switch_wal()" >/dev/null
  sleep 35
  local fails; fails=$(PGX -c "select failed_count || '/' || (last_failed_time is not null and last_failed_time > last_archived_time) from pg_stat_archiver")
  [ "${fails#*/}" = false ] && res ok "(b) the log archive keeps working on the new timeline (archiver: failed_count/currently failing = $fails)" || res bad "(b) archiver trouble after the switch: $fails"
}


# ------------------------------------------------------------------------------------------------ (d) disk 95% full
tree_sums() { sudo find "$@" -type f -print0 2>/dev/null | sort -z | xargs -0 -r sudo sha256sum 2>/dev/null; }
cmd_d() {
  echo "== (d) the small drill disk ($(df -h "$DR/root/files" | awk 'NR==2{print $2}') tmpfs, the desk is pointed at it) is filled to 95%"
  local F=$DR/root/files i; local P=$F/0c5e1f6e-drill-paper/2026-11-24
  mkdir -p "$P"/{original,thumb,web,pdf,epage,eimg,snapshot} "$F/0c5e1f6e-drill-paper/exports" "$F/0c5e1f6e-drill-paper/cache" "$F/0c5e1f6e-drill-paper/tmp"
  for i in 1 2 3; do head -c 1500000 /dev/urandom > "$P/original/orig$i.jpg"; done
  for i in 1 2; do head -c 200000 /dev/urandom > "$P/thumb/t$i.webp"; head -c 300000 /dev/urandom > "$P/web/w$i.webp"; done
  head -c 400000 /dev/urandom > "$P/pdf/final.pdf"
  # rebuildable junk the desk may remove: old exports, caches, temporary copies
  local used=0 n=0
  while [ "$(df --output=pcent "$F" | tail -1 | tr -dc 0-9)" -lt 95 ]; do
    n=$((n+1)); head -c 2000000 /dev/urandom > "$F/0c5e1f6e-drill-paper/$(case $((n%3)) in 0) echo exports;; 1) echo cache;; 2) echo tmp;; esac)/junk$n.bin" 2>/dev/null || break
  done
  echo "disk now $(df --output=pcent "$F" | tail -1 | tr -d ' ') full"
  # fingerprints of everything that must survive: the originals, the derived pictures, the final PDF and EVERY backup folder
  tree_sums "$F/0c5e1f6e-drill-paper/2026-11-24" > "$DR/d-orig.before"
  tree_sums "$DR/root/basebackups" "$DR/root/walarchive" "$DR/root/snapshots" "$DR/root/restores" "$DR/bucket" > "$DR/d-backup.before"
  echo "fingerprinted $(wc -l < "$DR/d-orig.before") original/derived files and $(wc -l < "$DR/d-backup.before") backup files"
  local st; st=$(D req GET /ops/status); local light; light=$(echo "$st" | jfield '[s["state"] for s in d["body"]["services"] if s["name"]=="disk"][0]'); local why; why=$(echo "$st" | jfield '[s["last_error"] for s in d["body"]["services"] if s["name"]=="disk"][0]')
  [ "$light" = red ] && res ok "(d) the disk light is red: $why" || res bad "(d) disk light is $light, wanted red"
  local plan; plan=$(D req GET /ops/disk/plan); echo "$plan" | jfield '"the desk lists what it would remove first: " + ", ".join("%s (%.1f MB)" % (i["path"].split("/")[-1], i["bytes"]/1e6) for i in d["body"]["items"])'
  echo "$plan" | jfield '"\n".join(i["path"] for i in d["body"]["items"])' | grep -qE "original|thumb|web|pdf|backup|_ops" && res bad "(d) the plan names a protected folder" || res ok "(d) the plan names only exports, cache and tmp (no original, derived picture, pdf or backup)"
  local no; no=$(tap /ops/disk/clear); echo "$no" | jfield '"without the typed word: HTTP %s, %s" % (d["status"], d["body"]["error"][:80])'
  local t0 body code; t0=$(now_s); body=$(tap /ops/disk/clear '{"confirm":"CLEAR"}'); code=$(echo "$body" | jfield 'd["status"]')
  local took; took=$(since "$t0")
  local after; after=$(df --output=pcent "$F" | tail -1 | tr -dc 0-9)
  local light2; light2=$(state_of disk)
  [ "$code" = 200 ] && [ "$after" -lt 80 ] && [ "$light2" = green ] && res ok "(d) 'Free disk space' HTTP 200 in $took s: $(echo "$body" | jfield 'd["body"]["message"]'); disk now ${after}% full, light $light2" || res bad "(d) clear HTTP $code, disk ${after}% light $light2 ($(echo "$body" | jfield 'str(d["body"])' | cut -c1-200))"
  tree_sums "$F/0c5e1f6e-drill-paper/2026-11-24" > "$DR/d-orig.after"
  cmp -s "$DR/d-orig.before" "$DR/d-orig.after" && res ok "(d) every original, derived picture and PDF is byte-identical ($(wc -l < "$DR/d-orig.after") files)" || res bad "(d) originals changed"
  # every backup file that existed before must still exist with the same content (new ones may have appeared)
  tree_sums "$DR/root/basebackups" "$DR/root/walarchive" "$DR/root/snapshots" "$DR/root/restores" "$DR/bucket" > "$DR/d-backup.after"
  local lost; lost=$(comm -23 <(sort "$DR/d-backup.before") <(sort "$DR/d-backup.after") | wc -l)
  [ "$lost" = 0 ] && res ok "(d) no backup file was touched: all $(wc -l < "$DR/d-backup.before") backup files (base backups, log archive, safety copies, restored copy, off-box repository) unchanged" || res bad "(d) $lost backup file(s) changed or gone"
  [ -d "$F/_ops" ] && res ok "(d) the desk's own state (_ops) is still there" || res bad "(d) _ops gone"
  local again; again=$(tap /ops/disk/clear '{"confirm":"CLEAR"}'); echo "$again" | jfield 'd["status"]' | grep -q 200 && res ok "(d) pressing it twice is safe (second press: $(echo "$again" | jfield 'd["body"]["message"][:60]'))" || res bad "(d) second press failed"
}


# ------------------------------------------------------------------------------------------------ (g) planted faults, desk only
# The "owner" here is a bot that may use ONLY what the desk shows (the lights, the plain words, the buttons named in `fixes`) and
# the desk's own HTTP buttons. It never touches Docker, a file or a script. Four faults are planted from outside first.
cmd_g() {
  echo "== (g) four planted faults, fixed from the desk alone"
  wait_green api worker postgres proxy backup-service 120 >/dev/null || echo "note: not all green before the test"
  local F=$DR/root/files
  dk stop -t 3 drill-ops-worker drill-ops-caddy drill-ops-backup >/dev/null 2>&1
  mkdir -p "$F/zz-paper/exports"; local n=0
  while [ "$(df --output=pcent "$F" | tail -1 | tr -dc 0-9)" -lt 92 ]; do n=$((n+1)); head -c 2000000 /dev/urandom > "$F/zz-paper/exports/plant$n.bin" || break; done
  echo "planted: worker stopped, front door stopped, backup program stopped, disk $(df --output=pcent "$F" | tail -1 | tr -d ' ') full"
  local t0; t0=$(now_s) round=0 pressed=""
  while [ $round -lt 6 ]; do
    round=$((round+1))
    local reds; reds=$(D req GET /ops/status | python3 -c '
import sys, json
d = json.loads(sys.stdin.read())["body"]
for s in d["services"]:
    if s["state"] == "red" and s["name"] != "certificate": print(s["name"], ",".join(s["fixes"]), "|", s["plain"][:90])')
    [ -z "$reds" ] && break
    echo "$reds" | sed 's/^/  red: /'
    while read -r name fixes _; do
      case ",$fixes," in
        *,clear_disk,*) tap /ops/disk/clear '{"confirm":"CLEAR"}' | jfield '"  pressed Free disk space -> HTTP %s" % d["status"]'; pressed="$pressed disk";;
        *,restart,*) tap "/ops/services/$name/restart" | jfield '"  pressed Fix it on '"$name"' -> HTTP %s" % d["status"]'; pressed="$pressed $name";;
        *,verify_now,*) tap /ops/backups/verify | jfield '"  pressed Check backups now -> HTTP %s %s" % (d["status"], (d["body"].get("message") or d["body"].get("error"))[:80])'; pressed="$pressed verify";;
        *,run_now,*) tap /ops/backups/run | jfield '"  pressed Back up now -> HTTP %s" % d["status"]'; pressed="$pressed backup";;
        *) echo "  no button for $name";;
      esac
    done <<< "$(echo "$reds" | sed 's/ |.*//')"
    sleep 3
  done
  local total; total=$(since "$t0")
  local left; left=$(D req GET /ops/status | python3 -c '
import sys, json
d = json.loads(sys.stdin.read())["body"]
print(",".join(s["name"] for s in d["services"] if s["state"] == "red" and s["name"] != "certificate"))')
  if [ -z "$left" ]; then res ok "(g) all four planted faults fixed with the desk's own buttons only (pressed:$pressed) in $total s over $round round(s); no red light left except the certificate (the drill has no website name)"
  else res bad "(g) still red after $round rounds: $left"; fi
  [ "$(D req GET /ops/log | jfield 'len(d["body"]["entries"])')" -gt 3 ] && res ok "(g) every press is in the history page of the desk ($(D req GET /ops/log | jfield 'len(d["body"]["entries"])') entries)" || res bad "(g) history is empty"
}

case "${1:-}" in
  up) cmd_up;;
  converge) compose up -d --no-build >/dev/null 2>&1 && echo converged;;
  g) cmd_g;;
  d) cmd_d;;
  b1) cmd_b1;; b2) cmd_b2;; b3) cmd_b3;;
  a) cmd_a;; f) cmd_f;; c) cmd_c;;
  rebuild)  # new desk code: rebuild the image from this checkout and replace only the desk container
    gen_services
    dk build -q -f "$REPO/apps/ops/Dockerfile" -t "$OPS_IMAGE:drill" "$REPO" >/dev/null && dk tag "$OPS_IMAGE:drill" "$OPS_IMAGE:2026-11-24.1" && compose up -d --no-build --no-deps ops >/dev/null && echo "desk replaced";;
  down) cmd_down;;
  summary) [ -f "$RES" ] && { grep -c '^ok' "$RES" | sed 's/$/ passed/'; grep '^bad' "$RES" || echo "no failures"; };;
  "") sed -n 2,22p "$0"; exit 64;;
esac
