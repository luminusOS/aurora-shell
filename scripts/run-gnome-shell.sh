#!/usr/bin/env bash

set -euo pipefail

TOOLBOX="${1:-gnome-shell-devel}"
HOST_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
RUNTIME_DIR="$(mktemp -d "$HOST_RUNTIME_DIR/aurora-shell-devkit.XXXXXX")"
PRIVATE_DATA_DIR="$RUNTIME_DIR/data"

cleanup() {
  rm -rf "$RUNTIME_DIR"
}
trap cleanup EXIT INT TERM

chmod 700 "$RUNTIME_DIR"

link_runtime_socket() {
  local relative_path="$1"
  local host_path="$HOST_RUNTIME_DIR/$relative_path"
  local runtime_path="$RUNTIME_DIR/$relative_path"

  [[ -S "$host_path" ]] || return
  mkdir -p "$(dirname "$runtime_path")"
  ln -s "$host_path" "$runtime_path"
}

# The devkit needs the host's media servers, but sharing the complete runtime
# directory also shares portal state. Expose only the required client sockets.
link_runtime_socket pipewire-0
link_runtime_socket pipewire-0-manager
link_runtime_socket pulse/native
link_runtime_socket gcr/ssh

disable_dbus_service() {
  local name="$1"
  local service_dir="$PRIVATE_DATA_DIR/dbus-1/services"

  mkdir -p "$service_dir"
  printf '[D-BUS Service]\nName=%s\nExec=/usr/bin/false\n' "$name" > "$service_dir/$name.service"
}

# A private session must not start host-scoped services whose state lives under
# /run/user/$UID. In particular, a second document portal can invalidate the
# host Flatpak document mount and leave Flatpak apps unable to start until the
# host xdg-document-portal.service is restarted.
disable_dbus_service org.freedesktop.portal.Documents

# A second keyring daemon cannot unlock the host keyring and would display an
# authentication prompt inside the devkit.
disable_dbus_service org.freedesktop.secrets
disable_dbus_service org.freedesktop.impl.portal.Secret
disable_dbus_service org.gnome.keyring

SHELL_ENV=(
  SHELL_DEBUG=all
  G_MESSAGES_DEBUG="Aurora Shell"
  AURORA_DEVTOOLS=1
  XDG_CURRENT_DESKTOP=GNOME
  XDG_SESSION_TYPE=wayland
  XDG_RUNTIME_DIR="$RUNTIME_DIR"
  SSH_AUTH_SOCK="$RUNTIME_DIR/gcr/ssh"
  XDG_DATA_DIRS="$PRIVATE_DATA_DIR:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"
  GSETTINGS_SCHEMA_DIR=/usr/share/glib-2.0/schemas
  GDK_DEBUG=no-portals
)
SHELL_ARGS=( --wayland --devkit --debug-control )

if [[ -n "${WAYLAND_DISPLAY:-}" ]]
then
  if [[ "$WAYLAND_DISPLAY" = /* ]]
  then
    SHELL_ENV+=(WAYLAND_DISPLAY="$WAYLAND_DISPLAY")
  else
    SHELL_ENV+=(WAYLAND_DISPLAY="$HOST_RUNTIME_DIR/$WAYLAND_DISPLAY")
  fi
fi

echo "Running GNOME Shell in toolbox '$TOOLBOX'..."
toolbox --container "$TOOLBOX" run \
  env \
    -u DBUS_SESSION_BUS_ADDRESS \
    -u DBUS_STARTER_ADDRESS \
    -u DBUS_STARTER_BUS_TYPE \
    "${SHELL_ENV[@]}" \
    dbus-run-session gnome-shell "${SHELL_ARGS[@]}"
