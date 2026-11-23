#!/usr/bin/env bash
# Writes a temporary env file (mode 600) for restic / WAL-G containers from /srv/epaper/.env.
# Usage: ENVF=$(scripts/lib/backup-env.sh)  ...  rm -f "$ENVF"
# Never prints secret values.
set -euo pipefail
SRC=${EPAPER_ENV:-/srv/epaper/.env}
get() { grep -E "^$1=" "$SRC" | head -1 | cut -d= -f2-; }
EP=$(get BACKUP_S3_ENDPOINT); BUCKET=$(get BACKUP_S3_BUCKET)
for k in BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_KEY BACKUP_S3_SECRET BACKUP_PASSWORD; do
  [ -n "$(get $k)" ] || { echo "Backup is not set up: $k is empty in .env." >&2; exit 2; }
done
case "$EP" in http://*|https://*) ;; *) EP="https://$EP";; esac
HOST=${EP#*://}; HOST=${HOST%%/*}
REGION=$(echo "$HOST" | sed -nE 's/^s3\.([^.]+)\..*/\1/p'); REGION=${REGION:-us-east-1}
PREFIX=${BACKUP_PREFIX:-epaper}
F=$(mktemp "${TMPDIR:-/tmp}/epaper-backup-env.XXXXXX"); chmod 600 "$F"
{
  echo "AWS_ACCESS_KEY_ID=$(get BACKUP_S3_KEY)"
  echo "AWS_SECRET_ACCESS_KEY=$(get BACKUP_S3_SECRET)"
  echo "AWS_REGION=$REGION"
  echo "AWS_ENDPOINT=$EP"
  echo "AWS_S3_FORCE_PATH_STYLE=true"
  echo "RESTIC_REPOSITORY=s3:$EP/$BUCKET/$PREFIX/restic"
  echo "RESTIC_PASSWORD=$(get BACKUP_PASSWORD)"
  echo "WALG_S3_PREFIX=s3://$BUCKET/$PREFIX/walg"
  echo "WALG_LIBSODIUM_KEY_TRANSFORM=base64"
  echo "WALG_COMPRESSION_METHOD=zstd"
} > "$F"
# WAL-G client-side encryption: libsodium key derived from BACKUP_PASSWORD (32 bytes, base64)
printf 'WALG_LIBSODIUM_KEY=%s\n' "$(printf '%s' "$(get BACKUP_PASSWORD)" | sha256sum | cut -d' ' -f1 | xxd -r -p | base64 -w0)" >> "$F"
echo "$F"
