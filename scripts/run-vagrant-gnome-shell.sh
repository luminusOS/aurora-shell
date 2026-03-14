#!/usr/bin/env bash
# Run GNOME Shell --devkit inside the Vagrant VM.
# Called by: just vagrant run

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Syncing project files into VM..."
cd "$PROJECT_DIR"
vagrant rsync

echo "==> Launching gnome-shell --devkit inside Vagrant VM..."
vagrant ssh -- -t '
  set -e
  cd /home/vagrant/aurora-shell

  echo "==> Rebuilding & installing extension..."
  just build
  just install

  echo "==> Starting GNOME Shell devkit session..."
  exec env \
    XDG_CURRENT_DESKTOP=GNOME \
    XDG_SESSION_TYPE=wayland \
    dbus-run-session gnome-shell --wayland --devkit
'
