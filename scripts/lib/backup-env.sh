#!/usr/bin/env bash
# Writes a temporary env file (mode 600) for restic from the BACKUP_* values.
# Values come from the process environment first, then from the env file (default /srv/epaper/.env).
# Usage: ENVF=$(scripts/lib/backup-env.sh)  ...  rm -f "$ENVF"     (delete it on exit)
# Never prints secret values.
set -euo pipefail
SRC=${EPAPER_ENV:-/srv/epaper/.env}
get() {
  local v="${!1:-}"
  if [ -z "$v" ] && [ -r "$SRC" ]; then v=$(grep -E "^$1=" "$SRC" | head -1 | cut -d= -f2- || true); fi
  printf '%s' "$v"
}
# Drills only: BACKUP_REPO_LOCAL=<folder> uses a local restic repository instead of the bucket (the real bucket key may not
# write a drill prefix). The folder is mounted at /repo wherever restic runs. Never set on the live box.
if [ -n "${BACKUP_REPO_LOCAL:-}" ]; then
  [ -n "$(get BACKUP_PASSWORD)" ] || { echo "Backup is not set up: BACKUP_PASSWORD is empty." >&2; exit 2; }
  umask 077; F=$(mktemp "${TMPDIR:-/tmp}/epaper-backup-env.XXXXXX"); chmod 600 "$F"
  printf 'RESTIC_REPOSITORY=/repo\nRESTIC_PASSWORD=%s\n' "$(get BACKUP_PASSWORD)" > "$F"; echo "$F"; exit 0
fi
for k in BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_KEY BACKUP_S3_SECRET BACKUP_PASSWORD; do
  [ -n "$(get $k)" ] || { echo "Backup is not set up: $k is empty (.env or environment)." >&2; exit 2; }
done
EP=$(get BACKUP_S3_ENDPOINT); BUCKET=$(get BACKUP_S3_BUCKET)
case "$EP" in http://*|https://*) ;; *) EP="https://$EP";; esac
HOST=${EP#*://}; HOST=${HOST%%/*}
REGION=$(echo "$HOST" | sed -nE 's/^s3\.([^.]+)\..*/\1/p'); REGION=${REGION:-us-east-1}
PREFIX=${BACKUP_PREFIX:-epaper}
umask 077
F=$(mktemp "${TMPDIR:-/tmp}/epaper-backup-env.XXXXXX"); chmod 600 "$F"
{
  echo "AWS_ACCESS_KEY_ID=$(get BACKUP_S3_KEY)"
  echo "AWS_SECRET_ACCESS_KEY=$(get BACKUP_S3_SECRET)"
  echo "AWS_REGION=$REGION"
  echo "RESTIC_REPOSITORY=s3:$EP/$BUCKET/$PREFIX/restic"
  echo "RESTIC_PASSWORD=$(get BACKUP_PASSWORD)"
} > "$F"
echo "$F"
