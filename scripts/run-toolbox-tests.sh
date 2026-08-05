#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
TOOLBOX_NAME="${AURORA_TOOLBOX_NAME:-aurora-shell-devel}"
UUID="aurora-shell@luminusos.github.io"
DEVELOPMENT=false
TARGETS=()

if [[ "${1:-}" == "--dev" ]]; then
  DEVELOPMENT=true
  shift
fi
TARGETS=("$@")

cd "$PROJECT_DIR"

if $DEVELOPMENT; then
  scripts/package-extension.sh development
  PACKAGE="$PROJECT_DIR/dist/target/$UUID.development.shell-extension.zip"
  TARGETS=(tests/shell/dev/devTool.test.js)
else
  scripts/package-extension.sh production
  PACKAGE="$PROJECT_DIR/dist/target/$UUID.shell-extension.zip"
fi

COMMAND=(
  scripts/run-shell-tests.sh
  --package "$PACKAGE"
  "${TARGETS[@]}"
)

if $DEVELOPMENT; then
  exec toolbox --container "$TOOLBOX_NAME" run env AURORA_DEVTOOLS=1 "${COMMAND[@]}"
fi

exec toolbox --container "$TOOLBOX_NAME" run "${COMMAND[@]}"
