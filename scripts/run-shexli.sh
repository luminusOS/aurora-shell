#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
EXTENSION="$PROJECT_DIR/dist/target/aurora-shell@luminusos.github.io.shell-extension.zip"

if command -v shexli >/dev/null 2>&1; then
  exec shexli "$EXTENSION" "$@"
fi

if command -v uvx >/dev/null 2>&1; then
  exec uvx --from shexli shexli "$EXTENSION" "$@"
fi

echo "shexli is not installed. Install it with: python3 -m pip install --user shexli" >&2
exit 1
