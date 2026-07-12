#!/usr/bin/env bash

set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
EXTENSION_ZIP="${1:-$PROJECT_DIR/dist/target/aurora-shell@luminusos.github.io.shell-extension.zip}"
shift || true

absolute_path() {
  local path="$1"

  if [[ "$path" = /* ]]; then
    printf '%s\n' "$path"
  else
    printf '%s/%s\n' "$PROJECT_DIR" "$path"
  fi
}

EXTENSION_ZIP="$(absolute_path "$EXTENSION_ZIP")"

if [[ ! -f "$EXTENSION_ZIP" ]]; then
  echo "Extension package not found: $EXTENSION_ZIP" >&2
  exit 2
fi

if (( $# > 0 )); then
  TEST_SCRIPTS=("$@")
else
  shopt -s nullglob
  TEST_SCRIPTS=("$PROJECT_DIR"/tests/shell/aurora*.js)
  shopt -u nullglob
fi

if (( ${#TEST_SCRIPTS[@]} == 0 )); then
  echo "No GNOME Shell test scripts found." >&2
  exit 2
fi

run_test() {
  local script
  script="$(absolute_path "$1")"

  if [[ ! -f "$script" ]]; then
    echo "Test script not found: $script" >&2
    return 2
  fi

  GDK_DEBUG="${GDK_DEBUG:-no-portals}" \
    GSETTINGS_SCHEMA_DIR="${GSETTINGS_SCHEMA_DIR:-/usr/share/glib-2.0/schemas}" \
    dbus-run-session bash -c '
      if command -v dbus-update-activation-environment >/dev/null 2>&1; then
        dbus-update-activation-environment \
          DISPLAY WAYLAND_DISPLAY XDG_RUNTIME_DIR LIBGL_ALWAYS_SOFTWARE \
          GDK_DEBUG >/dev/null
      fi

      exec gnome-shell-test-tool \
        --headless \
        --extension "$1" \
        "$2"
    ' -- "$EXTENSION_ZIP" "$script"
}

PASS=0
FAIL=0
LOG_FILE=""

cleanup() {
  if [[ -n "$LOG_FILE" && -f "$LOG_FILE" ]]; then
    rm -f "$LOG_FILE"
  fi
}

trap cleanup EXIT INT TERM

for script in "${TEST_SCRIPTS[@]}"; do
  script="$(absolute_path "$script")"
  echo "==> Running $script"
  LOG_FILE="$(mktemp)"

  if run_test "$script" >"$LOG_FILE" 2>&1; then
    echo "    PASS: $script"
    PASS=$((PASS + 1))
  else
    cat "$LOG_FILE"
    echo "    FAIL: $script"
    FAIL=$((FAIL + 1))
  fi

  rm -f "$LOG_FILE"
  LOG_FILE=""
done

echo
echo "Results: $PASS passed, $FAIL failed"
(( FAIL == 0 ))
