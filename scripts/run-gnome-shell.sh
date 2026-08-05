#!/usr/bin/env bash

set -euo pipefail

TOOLBOX_NAME=""

while (( $# > 0 )); do
  case "$1" in
    --toolbox)
      [[ $# -ge 2 ]] || { echo "Missing toolbox name." >&2; exit 2; }
      TOOLBOX_NAME="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: $(basename "$0") [--toolbox NAME]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

SHELL_ENV=(
  AURORA_DEVTOOLS=1
  XDG_CURRENT_DESKTOP=GNOME
  XDG_SESSION_TYPE=wayland
  GSETTINGS_SCHEMA_DIR=/usr/share/glib-2.0/schemas
)

if [[ -z "$TOOLBOX_NAME" ]]; then
  exec env "${SHELL_ENV[@]}" dbus-run-session gnome-shell --wayland --devkit
fi

SHELL_ENV+=(
  SHELL_DEBUG=all
  'G_MESSAGES_DEBUG=Aurora Shell'
)

echo "Running GNOME Shell in toolbox '$TOOLBOX_NAME'..."
exec toolbox --container "$TOOLBOX_NAME" run \
  env \
    -u DBUS_SESSION_BUS_ADDRESS \
    -u DBUS_STARTER_ADDRESS \
    -u DBUS_STARTER_BUS_TYPE \
    "${SHELL_ENV[@]}" \
    dbus-run-session gnome-shell --wayland --devkit --debug-control
