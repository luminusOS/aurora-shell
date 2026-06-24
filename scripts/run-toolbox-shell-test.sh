#!/usr/bin/env bash

set -euo pipefail

TOOLBOX="$1"
EXTENSION_ZIP="$2"
TEST_SCRIPT="$3"
HOST_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
RUNTIME_DIR="$(mktemp -d "$HOST_RUNTIME_DIR/aurora-shell-test.XXXXXX")"
PRIVATE_DATA_DIR="$RUNTIME_DIR/data"
SERVICE_DIR="$PRIVATE_DATA_DIR/dbus-1/services"

cleanup() {
  rm -rf "$RUNTIME_DIR"
}
trap cleanup EXIT INT TERM

chmod 700 "$RUNTIME_DIR"
mkdir -p "$SERVICE_DIR"

disable_dbus_service() {
  local name="$1"
  printf '[D-BUS Service]\nName=%s\nExec=/usr/bin/false\n' "$name" > "$SERVICE_DIR/$name.service"
}

# Never let a toolbox test claim the host Flatpak document portal or keyring.
disable_dbus_service org.freedesktop.portal.Documents
disable_dbus_service org.freedesktop.secrets
disable_dbus_service org.freedesktop.impl.portal.Secret
disable_dbus_service org.gnome.keyring

toolbox --container "$TOOLBOX" run \
  env \
    -u DBUS_SESSION_BUS_ADDRESS \
    -u DBUS_STARTER_ADDRESS \
    -u DBUS_STARTER_BUS_TYPE \
    XDG_RUNTIME_DIR="$RUNTIME_DIR" \
    XDG_DATA_DIRS="$PRIVATE_DATA_DIR:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}" \
    GSETTINGS_SCHEMA_DIR=/usr/share/glib-2.0/schemas \
    dbus-run-session gnome-shell-test-tool \
      --headless \
      --extension "$EXTENSION_ZIP" \
      "$TEST_SCRIPT"
