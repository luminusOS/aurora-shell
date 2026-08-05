#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
EXTENSION_ZIP="$PROJECT_DIR/dist/target/aurora-shell@luminusos.github.io.shell-extension.zip"
TARGETS=()
TEST_SCRIPTS=()
PASS=0
FAIL=0
LOG_FILE=""

usage() {
  echo "Usage: $(basename "$0") [--package ZIP] [FILE_OR_DIRECTORY ...]"
}

absolute_path() {
  if [[ "$1" = /* ]]; then
    printf '%s\n' "$1"
  else
    printf '%s/%s\n' "$PROJECT_DIR" "$1"
  fi
}

collect_tests() {
  local target="$1"
  local test_script

  if [[ -d "$target" ]]; then
    while IFS= read -r -d '' test_script; do
      TEST_SCRIPTS+=("$test_script")
    done < <(find "$target" -type f -name '*.test.js' -print0)
  elif [[ -f "$target" && "$target" == *.test.js ]]; then
    TEST_SCRIPTS+=("$target")
  else
    echo "Shell test target not found: $target" >&2
    exit 2
  fi
}

extra_monitors_for() {
  case "$1" in
    */capture/captureTools.test.js|*/clipboard/clipboardHistory.test.js) echo 1 ;;
    */dock/dock.test.js) echo 2 ;;
    *) echo 0 ;;
  esac
}

run_test() {
  local script="$1"
  local extra_monitors

  extra_monitors="$(extra_monitors_for "$script")"
  GDK_DEBUG="${GDK_DEBUG:-no-portals}" \
    GSETTINGS_SCHEMA_DIR="${GSETTINGS_SCHEMA_DIR:-/usr/share/glib-2.0/schemas}" \
    AURORA_TEST_EXTRA_MONITORS="$extra_monitors" \
    dbus-run-session bash -c '
      if command -v dbus-update-activation-environment >/dev/null 2>&1; then
        dbus-update-activation-environment \
          DISPLAY WAYLAND_DISPLAY XDG_RUNTIME_DIR LIBGL_ALWAYS_SOFTWARE \
          GDK_DEBUG >/dev/null
      fi

      test_args=(--headless --extension "$1")
      if (( $4 > 0 )); then
        test_args+=(--wrap "$3")
      fi

      exec gnome-shell-test-tool "${test_args[@]}" "$2"
    ' -- "$EXTENSION_ZIP" "$script" "$PROJECT_DIR/scripts/wrap-gnome-shell.sh" "$extra_monitors"
}

cleanup() {
  if [[ -n "$LOG_FILE" && -f "$LOG_FILE" ]]; then
    rm -f "$LOG_FILE"
  fi
}

while (( $# > 0 )); do
  case "$1" in
    --package)
      [[ $# -ge 2 ]] || { echo "Missing package path." >&2; exit 2; }
      EXTENSION_ZIP="$(absolute_path "$2")"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --)
      shift
      TARGETS+=("$@")
      break
      ;;
    --*)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
    *)
      TARGETS+=("$1")
      shift
      ;;
  esac
done

[[ -f "$EXTENSION_ZIP" ]] || { echo "Extension package not found: $EXTENSION_ZIP" >&2; exit 2; }

if (( ${#TARGETS[@]} == 0 )); then
  while IFS= read -r -d '' test_script; do
    [[ "$test_script" == "$PROJECT_DIR/tests/shell/dev/"* ]] || TEST_SCRIPTS+=("$test_script")
  done < <(find "$PROJECT_DIR/tests/shell" -type f -name '*.test.js' -print0)
else
  for target in "${TARGETS[@]}"; do
    collect_tests "$(absolute_path "$target")"
  done
fi

mapfile -d '' TEST_SCRIPTS < <(printf '%s\0' "${TEST_SCRIPTS[@]}" | sort -zu)
(( ${#TEST_SCRIPTS[@]} > 0 )) || { echo "No GNOME Shell tests found." >&2; exit 2; }

trap cleanup EXIT INT TERM

for script in "${TEST_SCRIPTS[@]}"; do
  echo "==> Running ${script#"$PROJECT_DIR/"}"
  LOG_FILE="$(mktemp)"

  if run_test "$script" >"$LOG_FILE" 2>&1; then
    echo "    PASS: ${script#"$PROJECT_DIR/"}"
    PASS=$((PASS + 1))
  else
    cat "$LOG_FILE"
    echo "    FAIL: ${script#"$PROJECT_DIR/"}"
    FAIL=$((FAIL + 1))
  fi

  rm -f "$LOG_FILE"
  LOG_FILE=""
done

echo
echo "Results: $PASS passed, $FAIL failed"
(( FAIL == 0 ))
