#!/usr/bin/env bash
# Exit 0 if backups are healthy, 1 with a plain-words reason if not.
# Checks: last push < 5 min, bucket reachable and repository readable, newest base backup < 26 h,
# restic check --read-data-subset=1%.   Set CHECK_SKIP_DATA=1 to skip the data read.
set -uo pipefail
. "$(dirname "$0")/lib/backup-common.sh"
trap tmp_cleanup EXIT
out=$(bk_run check 2>&1); rc=$?
echo "$out" | grep -E '^(OK|FAIL|SKIP):' || echo "$out" | tail -3
if [ $rc -eq 0 ]; then echo "Backups are healthy."; exit 0; fi
echo "Backups need attention: $(echo "$out" | grep -E '^FAIL:' | head -1 | sed 's/^FAIL: //')"; exit 1
