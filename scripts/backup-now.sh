#!/usr/bin/env bash
# One immediate push of files + WAL + base backups to the off-box bucket, then print the status.
# Usage: scripts/backup-now.sh   (env: COMPOSE_PROJECT=epaper, BACKUP_ROOT=/srv/epaper)
# The ops desk also calls:
#   --status            JSON of what each kind of backup looks like (null = that kind does not exist)
#   --verify            restore check into a scratch copy; records the result (JSON)
#   --snapshot "why"    safety copy of the database before a destructive button; prints {"id":...}
set -uo pipefail
. "$(dirname "$0")/lib/backup-common.sh"
. "$(dirname "$0")/lib/desk-ops.sh"
trap tmp_cleanup EXIT
case "${1:-}" in
  --status) desk_status; exit $?;;
  --snapshot) desk_snapshot "${2:-manual}"; exit $?;;
  --verify) desk_verify; exit $?;;
  "") ;;
  *) echo "Unknown option: $1" >&2; exit 64;;
esac
bk_run push || { echo "The push could not run."; exit 1; }
S="$ROOT/backup-status.json"
[ -s "$S" ] || { echo "No status file at $S yet."; exit 1; }
jq '{updated, healthy, lag_seconds, last_error, files: .files.last_ok, wal: .wal.last_ok, basebackup: .basebackup.last_ok, snapshot: .push.snapshot}' "$S"
[ "$(jq -r '.last_error // empty' "$S")" = "" ] && echo "Backup pushed." || { echo "Backup has a problem: $(jq -r .last_error "$S")"; exit 1; }
