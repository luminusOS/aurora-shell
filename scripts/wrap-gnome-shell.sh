#!/usr/bin/env bash

set -euo pipefail

EXTRA_MONITORS="${AURORA_TEST_EXTRA_MONITORS:-0}"
if [[ ! "$EXTRA_MONITORS" =~ ^[0-9]+$ ]]; then
  echo "Invalid AURORA_TEST_EXTRA_MONITORS value: $EXTRA_MONITORS" >&2
  exit 2
fi

SHELL="$1"
shift
MONITOR_ARGS=()

for ((index = 0; index < EXTRA_MONITORS; index++)); do
  MONITOR_ARGS+=(--virtual-monitor 1280x720)
done

exec "$SHELL" "$@" "${MONITOR_ARGS[@]}"
