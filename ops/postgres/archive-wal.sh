#!/usr/bin/env bash
# Postgres archive_command:  archive-wal.sh %p %f
# Copies one WAL file into the local archive folder (default /walarchive) as <name>.gz.
# - atomic: written under a hidden temp name, fsynced, then linked into place; a half-written
#   file is never visible under its real name
# - never overwrites: an existing identical file counts as done, a different one is an error
# - any failure returns non-zero, so Postgres keeps the segment and retries
set -u
src=${1:?path}; name=${2:?name}
dir=${WAL_ARCHIVE_DIR:-/walarchive}
dest="$dir/$name.gz"
umask 000
[ -f "$src" ] || { echo "archive-wal: source $src is missing" >&2; exit 1; }
[ -d "$dir" ] && [ -w "$dir" ] || { echo "archive-wal: archive folder $dir is missing or not writable" >&2; exit 1; }
if [ -e "$dest" ]; then
  if gzip -dc "$dest" 2>/dev/null | cmp -s - "$src"; then exit 0; fi
  echo "archive-wal: $name is already archived with different content; refusing to overwrite" >&2; exit 1
fi
tmp="$dir/.tmp.$name.$$"
trap 'rm -f "$tmp"' EXIT
gzip -1 -c "$src" > "$tmp" || { echo "archive-wal: compress/copy failed (disk full?)" >&2; exit 1; }
sync "$tmp" || exit 1
# ln fails if dest exists: no overwrite, even in a race
ln "$tmp" "$dest" 2>/dev/null || {
  if [ -e "$dest" ] && gzip -dc "$dest" | cmp -s - "$src"; then exit 0; fi
  echo "archive-wal: could not place $name in the archive" >&2; exit 1; }
sync "$dir" 2>/dev/null || true
exit 0
