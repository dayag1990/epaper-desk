#!/usr/bin/env bash
# Serve the stand-in demo news site on 127.0.0.1:8190 (for the ingest demo).
set -euo pipefail
cd "$(dirname "$0")/../fixtures/demo-site"
echo "Serving fixtures/demo-site on http://127.0.0.1:8190 (Ctrl-C to stop)"
exec python3 -m http.server 8190 --bind 127.0.0.1
