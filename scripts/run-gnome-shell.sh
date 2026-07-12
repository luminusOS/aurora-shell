#!/usr/bin/env bash

set -euo pipefail

TOOLBOX="${1:-gnome-shell-devel}"

SHELL_ENV=(
  SHELL_DEBUG=all
  G_MESSAGES_DEBUG="Aurora Shell"
  AURORA_DEVTOOLS=1
  XDG_CURRENT_DESKTOP=GNOME
  XDG_SESSION_TYPE=wayland
  GSETTINGS_SCHEMA_DIR=/usr/share/glib-2.0/schemas
)
SHELL_ARGS=( --wayland --devkit --debug-control )

echo "Running GNOME Shell in toolbox '$TOOLBOX'..."
toolbox --container "$TOOLBOX" run \
  env \
    -u DBUS_SESSION_BUS_ADDRESS \
    -u DBUS_STARTER_ADDRESS \
    -u DBUS_STARTER_BUS_TYPE \
    "${SHELL_ENV[@]}" \
    dbus-run-session gnome-shell "${SHELL_ARGS[@]}"
