#!/usr/bin/env bash

set -e

TOOLBOX="${1:-gnome-shell-devel}"

SHELL_ENV=(
  SHELL_DEBUG=all
  AURORA_DEVTOOLS=1
  XDG_CURRENT_DESKTOP=GNOME
  XDG_SESSION_TYPE=wayland
  GSETTINGS_SCHEMA_DIR=/usr/share/glib-2.0/schemas
)
SHELL_ARGS=( --wayland --devkit --debug-control )

if [[ ! :$XDG_DATA_DIRS: =~ :/usr/share/?: ]]
then
  SHELL_ENV+=(XDG_DATA_DIRS=$XDG_DATA_DIRS:/usr/share/)
fi

echo "Running GNOME Shell in toolbox '$TOOLBOX'..."
toolbox --container $TOOLBOX run \
  env "${SHELL_ENV[@]}" dbus-run-session gnome-shell "${SHELL_ARGS[@]}"
