#!/usr/bin/env bash
# One-time (and safe to repeat) folder + secret setup for backups.
#   BACKUP_ROOT (default /srv/epaper): files/ walarchive/ basebackups/
#   walarchive is writable by the Postgres container user (uid 999) AND the backup user (uid 1001): mode 0777.
#   POSTGRES_BACKUP_PASSWORD is appended to the env file if missing (the value is never printed).
set -euo pipefail
ROOT=${BACKUP_ROOT:-/srv/epaper}
ENVFILE=${EPAPER_ENV:-/srv/epaper/.env}
mkdir -p "$ROOT/files" "$ROOT/walarchive" "$ROOT/basebackups"
chmod 0777 "$ROOT/walarchive"
chmod 0755 "$ROOT/basebackups"
if [ -f "$ENVFILE" ] && ! grep -qE '^POSTGRES_BACKUP_PASSWORD=.+' "$ENVFILE"; then
  [ -n "$(tail -c1 "$ENVFILE")" ] && echo >> "$ENVFILE"
  printf 'POSTGRES_BACKUP_PASSWORD=%s\n' "$(head -c 24 /dev/urandom | base64 | tr -d '/+=\n')" >> "$ENVFILE"
  echo "Added POSTGRES_BACKUP_PASSWORD to $ENVFILE."
fi
echo "Backup folders are ready under $ROOT."
