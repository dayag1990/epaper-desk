#!/usr/bin/env bash
# Run make-standin-edition.ts inside the pinned Playwright image (no host Chromium needed).
set -euo pipefail
cd "$(dirname "$0")/.."
IMG=mcr.microsoft.com/playwright:v1.49.1-noble
run() { if docker info >/dev/null 2>&1; then docker "$@"; else sg docker -c "docker $(printf '%q ' "$@")"; fi; }
run run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD:/work" -w /work "$IMG" node_modules/.bin/tsx scripts/make-standin-edition.ts
