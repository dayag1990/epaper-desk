#!/usr/bin/env bash
# Puts the Docker guard first on PATH for this user (~/.local/bin is first in PATH on this box).
# Safe to run twice. Undo: rm ~/.local/bin/docker
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$HOME/.local/bin"
ln -sfn "$HERE/docker" "$HOME/.local/bin/docker"
echo "Docker guard installed: $HOME/.local/bin/docker -> $HERE/docker"
command -v docker
