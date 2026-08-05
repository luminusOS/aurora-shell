#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
TOOLBOX_NAME="${AURORA_TOOLBOX_NAME:-aurora-shell-devel}"

cd "$PROJECT_DIR"

if [[ -n "${AURORA_TOOLBOX_IMAGE:-}" ]]; then
  IMAGE="$AURORA_TOOLBOX_IMAGE"
else
  IMAGE="$(scripts/ci-image-name.sh)"
  podman build -f Containerfile -t "$IMAGE" .
fi

echo "Creating toolbox '$TOOLBOX_NAME' from '$IMAGE'..."
toolbox create --image "$IMAGE" "$TOOLBOX_NAME"
