#!/usr/bin/env bash

set -e

TOOLBOX="${1:-gnome-shell-devel}"

SHELL_ENV=(
  XDG_CURRENT_DESKTOP=GNOME
  XDG_SESSION_TYPE=wayland
  GSETTINGS_SCHEMA_DIR=/usr/share/glib-2.0/schemas
)
SHELL_ARGS=( --wayland --devkit )

if [[ ! :$XDG_DATA_DIRS: =~ :/usr/share/?: ]]
then
  SHELL_ENV+=(XDG_DATA_DIRS=$XDG_DATA_DIRS:/usr/share/)
fi

echo "Running GNOME Shell in toolbox '$TOOLBOX'..."
toolbox --container $TOOLBOX run \
  env "${SHELL_ENV[@]}" dbus-run-session gnome-shell "${SHELL_ARGS[@]}"
