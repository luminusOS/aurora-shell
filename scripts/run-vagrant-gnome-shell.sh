#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Syncing project files into VM..."
cd "$PROJECT_DIR"
vagrant rsync

echo "==> Launching gnome-shell --devkit inside Vagrant VM..."
vagrant ssh -- -t '
  set -e
  cd /home/vagrant/aurora-shell

  echo "==> Building & installing extension..."
  just install

  echo "==> Starting GNOME Shell devkit session..."
  exec env \
    AURORA_DEVTOOLS=1 \
    XDG_CURRENT_DESKTOP=GNOME \
    XDG_SESSION_TYPE=wayland \
    dbus-run-session gnome-shell --wayland --devkit
'
