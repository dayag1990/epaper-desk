#!/usr/bin/env bash
# Rebuild E-Paper Desk from the off-box bucket. Needs only Docker, this repo and the 5 BACKUP_* values
# (BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_KEY BACKUP_S3_SECRET BACKUP_PASSWORD) in the environment
# or in an env file ($EPAPER_ENV, else $BACKUP_ROOT/.env, else /srv/epaper/.env).
#
#   scripts/restore.sh [--to 'YYYY-MM-DD HH:MM:SS+00'] [--force] [--host-setup [--dry-run]]
#                      [--root DIR] [--project NAME] [--services "postgres backup"]
#
# Steps: (host setup) -> restic restore of files + WAL archive + base backups + config
#        -> Postgres restored from the newest verified base backup, WAL replayed to the end (or --to)
#        -> stack started, waited healthy, smoke check.
# Safe to run twice: it refuses to touch existing data without --force, and with --force it first
# moves what it would replace into $ROOT/restore-snapshots/<time>/ (database copied as a tar).
set -euo pipefail
. "$(dirname "$0")/lib/backup-common.sh"
trap tmp_cleanup EXIT
TO=""; FORCE=0; HOSTSETUP=0; DRY=0; SERVICES=""
while [ $# -gt 0 ]; do case "$1" in
  --to) TO=$2; shift 2;; --force) FORCE=1; shift;; --host-setup) HOSTSETUP=1; shift;; --dry-run) DRY=1; shift;;
  --root) ROOT=$2; shift 2;; --project) PROJECT=$2; shift 2;; --services) SERVICES=$2; shift 2;;
  -h|--help) sed -n 2,14p "$0"; exit 0;; *) echo "Unknown option: $1" >&2; exit 64;; esac; done
T0=$(date +%s)
say() { echo "$(date -u +%H:%M:%S) $*"; }
die() { echo "RESTORE FAILED: $*" >&2; exit "${2:-1}"; }

# ---------------------------------------------------------------- host setup (optional, sudo, logged)
host_setup() {
  local LOGF=/var/log/epaper-host-setup.log
  run() { echo "+ $*"; [ "$DRY" = 1 ] && return 0; { echo "$(date -u +%FT%TZ) $*" | sudo tee -a "$LOGF" >/dev/null; } 2>/dev/null || true; "$@"; }
  say "host setup (sudo): Docker, swap, firewall, user, folder"
  if ! command -v docker >/dev/null 2>&1; then
    run sudo apt-get update
    run sudo apt-get install -y ca-certificates curl gnupg
    run sudo install -m 0755 -d /etc/apt/keyrings
    run sudo bash -c 'curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg'
    run sudo bash -c 'echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list'
    run sudo apt-get update
    run sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  id epaper >/dev/null 2>&1 || run sudo useradd -m -u 1001 -s /bin/bash -G sudo epaper
  run sudo usermod -aG docker epaper
  run sudo install -d -o epaper -g epaper /srv/epaper
  if ! swapon --show 2>/dev/null | grep -q /swapfile; then
    [ -e /swapfile ] || { run sudo fallocate -l 8G /swapfile; run sudo chmod 600 /swapfile; run sudo mkswap /swapfile; }
    run sudo swapon /swapfile
  fi
  grep -q '^/swapfile' /etc/fstab 2>/dev/null || run sudo bash -c "echo '/swapfile none swap sw 0 0' >> /etc/fstab"
  run sudo bash -c 'echo vm.swappiness=10 > /etc/sysctl.d/99-epaper.conf'; run sudo sysctl -q vm.swappiness=10
  command -v ufw >/dev/null 2>&1 || run sudo apt-get install -y ufw
  run sudo ufw default deny incoming; run sudo ufw default allow outgoing
  for p in 22 80 443; do run sudo ufw allow "$p/tcp"; done
  run sudo ufw --force enable
  say "host setup done (steps logged in $LOGF)"
}
[ "$HOSTSETUP" = 1 ] && host_setup
[ "$DRY" = 1 ] && { say "dry run: stopping here"; exit 0; }

# ---------------------------------------------------------------- preflight
mkdir -p "$ROOT"; LOG="$ROOT/restore.log"; exec > >(tee -a "$LOG") 2>&1
say "restore into $ROOT, compose project $PROJECT${TO:+, replay to $TO}"
if [ -z "${EPAPER_ENV:-}" ]; then for c in "$ROOT/.env" /srv/epaper/.env; do [ -r "$c" ] && { export EPAPER_ENV=$c; break; }; done; fi
make_envf || die "the 5 BACKUP_* values are missing: put them in the environment or in an env file" 2
dk info >/dev/null 2>&1 || die "Docker is not usable by this user (try --host-setup, then log in again)" 2
PGVOL="${PROJECT}_pgdata"
vol_has_data() { dk volume inspect "$PGVOL" >/dev/null 2>&1 && dk run --rm -v "$PGVOL:/v" --entrypoint sh "$PG_IMAGE" -c 'test -e /v/PG_VERSION'; }
db_exists=0; vol_has_data && db_exists=1
files_exist=0; [ -n "$(ls -A "$ROOT/files" 2>/dev/null)" ] && files_exist=1
if { [ $db_exists = 1 ] || [ $files_exist = 1 ]; } && [ "$FORCE" != 1 ]; then
  die "this machine already has live data (database: $([ $db_exists = 1 ] && echo yes || echo no), files: $([ $files_exist = 1 ] && echo yes || echo no)). Nothing was changed. Run again with --force to replace it; a copy is kept first." 3
fi

# ---------------------------------------------------------------- 1. get everything from the bucket
RT="$ROOT/.restore-tmp"; rm -rf "$RT"; mkdir -p "$RT"; tmp_track "$RT"
say "looking for the newest snapshot in the bucket"
snaps=$(restic_run -- snapshots --host epaper --tag auto --latest 1 --json 2>"$RT/err") || die "cannot read the bucket: $(tail -1 "$RT/err" | cut -c1-160)" 4
[ "$(echo "$snaps" | jq 'length')" -gt 0 ] || die "the bucket holds no backup for this system" 4
say "restoring files, WAL archive, base backups and config (snapshot $(echo "$snaps" | jq -r '.[-1].short_id'))"
restic_run -v "$ROOT:/target" -- restore latest --host epaper --tag auto --target /target/.restore-tmp >"$RT/restic.log" 2>&1 \
  || die "restic restore failed: $(tail -1 "$RT/restic.log" | cut -c1-160)" 4
[ -d "$RT/data/basebackups" ] || die "the snapshot has no base backups folder" 4

# ---------------------------------------------------------------- 2. snapshot what we would overwrite, then swap in
SNAP="$ROOT/restore-snapshots/$(date -u +%Y%m%dT%H%M%SZ)"
if [ "$db_exists" = 1 ] || [ "$files_exist" = 1 ] || [ -d "$ROOT/walarchive" -a -n "$(ls -A "$ROOT/walarchive" 2>/dev/null)" ]; then
  say "keeping a copy of the current data in $SNAP first"
  mkdir -p "$SNAP"
  compose down --remove-orphans >/dev/null 2>&1 || true
  if [ "$db_exists" = 1 ]; then
    dk run --rm -v "$PGVOL:/v:ro" -v "$SNAP:/out" --entrypoint sh "$PG_IMAGE" -c 'tar czf /out/pgdata.tar.gz -C /v . && chmod 644 /out/pgdata.tar.gz' || die "could not copy the current database first; nothing was changed" 5
  fi
  [ "$db_exists" = 1 ] && dk volume rm "$PGVOL" >/dev/null
  for d in files walarchive basebackups; do [ -e "$ROOT/$d" ] && mv "$ROOT/$d" "$SNAP/$d"; done
fi
for d in files walarchive basebackups; do
  if [ -d "$RT/data/$d" ]; then mv "$RT/data/$d" "$ROOT/$d"; else mkdir -p "$ROOT/$d"; fi
done
if [ -f "$RT/run/epaper.env" ]; then
  [ -e "$ROOT/.env" ] || install -m 600 "$RT/run/epaper.env" "$ROOT/.env"
  [ -e /srv/epaper/.env ] || { install -d /srv/epaper 2>/dev/null; install -m 600 "$RT/run/epaper.env" /srv/epaper/.env 2>/dev/null || true; }
fi
BACKUP_ROOT=$ROOT "$REPO_DIR/scripts/backup-init.sh" >/dev/null
say "files restored: $(find "$ROOT/files" -type f | wc -l) files"

# ---------------------------------------------------------------- 3. pick a verified base backup
BB=""; to_e=""; [ -n "$TO" ] && { to_e=$(date -u -d "$TO" +%s) || die "cannot read the time '$TO'" 64; }
for b in $(ls -1r "$ROOT/basebackups"); do
  m="$ROOT/basebackups/$b/manifest.json"; [ -f "$m" ] || continue
  if [ -n "$to_e" ] && [ "$(date -u -d "$(jq -r .finished "$m")" +%s)" -gt "$to_e" ]; then continue; fi
  if ( cd "$ROOT/basebackups/$b" && sha256sum -c --quiet SHA256SUMS >/dev/null 2>&1 ); then BB=$b; break; else say "base backup $b failed its checksum, trying an older one"; fi
done
[ -n "$BB" ] || die "no usable base backup${TO:+ before $TO}" 5
say "using base backup $BB"

# ---------------------------------------------------------------- 4. database: base backup + WAL replay
read -r -d '' PRE <<'EOS' || true
set -euo pipefail
D=/var/lib/postgresql/data
[ -z "$(ls -A $D)" ] || { echo "data folder is not empty" >&2; exit 3; }
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
compose run --rm --no-deps -T -v "$ROOT/basebackups:/basebackups:ro" -e "BB=$BB" -e "RTIME=$TO" --entrypoint bash postgres -c "$PRE" \
  || die "could not unpack the base backup into the database folder" 5
say "starting Postgres; replaying archived WAL"
compose up -d postgres >/dev/null
rec=""
for i in $(seq 900); do
  [ -n "$(compose ps -q --status running postgres)" ] || { compose logs --tail 15 postgres 2>&1 | cut -c1-200; die "Postgres stopped during recovery (a target time before the data, or a missing WAL file)" 6; }
  rec=$(compose exec -T postgres psql -U epaper -d epaper -Atc 'select pg_is_in_recovery()' 2>/dev/null || true)
  [ "$rec" = f ] && break; sleep 1
done
[ "$rec" = f ] || die "Postgres did not finish recovery in 15 minutes" 6
say "database is up and out of recovery"

# ---------------------------------------------------------------- 5. stack up, healthy, smoke
[ -n "$SERVICES" ] || SERVICES=$(compose config --services | tr '\n' ' ')
say "starting: $SERVICES"
compose up -d --build $SERVICES >/dev/null || die "could not start the stack" 7
bad=1
for i in $(seq 180); do
  bad=0
  for s in $SERVICES; do
    st=$(compose ps --format '{{.Health}}|{{.State}}' "$s" 2>/dev/null | head -1)
    case "$st" in healthy\|*) ;; \|running) ;; *) bad=1;; esac
  done
  [ $bad = 0 ] && break; sleep 5
done
[ $bad = 0 ] || { compose ps; die "some services did not become healthy in 15 minutes" 7; }
say "all services healthy"
tables=$(compose exec -T postgres psql -U epaper -d epaper -Atc "select count(*) from information_schema.tables where table_schema='public'")
say "smoke: database answers ($tables tables), $(find "$ROOT/files" -type f | wc -l) files on disk"
case " $SERVICES " in *" api "*) curl -fsS -m 10 http://127.0.0.1:8100/readyz >/dev/null && say "smoke: API ready" || die "smoke: API did not answer /readyz" 8;; esac
case " $SERVICES " in *" backup "*) compose exec -T backup /opt/backup/bk basebackup >/dev/null 2>&1 && say "fresh base backup taken on the new timeline" || say "note: a fresh base backup will run tonight";; esac
rm -rf "$RT"
say "RESTORE OK in $(( $(date +%s) - T0 )) seconds"
