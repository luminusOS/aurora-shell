#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
UUID="aurora-shell@luminusos.github.io"
PRODUCTION_ZIP="$PROJECT_DIR/dist/target/$UUID.shell-extension.zip"
DEVELOPMENT_ZIP="$PROJECT_DIR/dist/target/$UUID.development.shell-extension.zip"

install -d -m 0700 "$XDG_RUNTIME_DIR"
mkdir -p /run/dbus /run/systemd/seats
dbus-daemon --system --fork --nopidfile
python3 -m dbusmock --system --template logind &
LOGIND_PID=$!
python3 -m dbusmock --system --template "$PROJECT_DIR/tests/dbusmock/gdm.py" &
GDM_PID=$!
trap 'kill "$LOGIND_PID" "$GDM_PID" 2>/dev/null || true' EXIT

sleep 1
gdbus call --system \
  --dest org.freedesktop.login1 \
  --object-path /org/freedesktop/login1 \
  --method org.freedesktop.DBus.Mock.AddMethod \
  org.freedesktop.login1.Manager GetUser u o \
  'ret = "/org/freedesktop/login1/user/" + str(args[0])'
gdbus call --system \
  --dest org.freedesktop.login1 \
  --object-path /org/freedesktop/login1 \
  --method org.freedesktop.DBus.Mock.AddSession \
  "$XDG_SESSION_ID" seat0 "$(id -u)" "$(id -un)" true

"$PROJECT_DIR/scripts/run-shell-tests.sh" --package "$PRODUCTION_ZIP"
AURORA_DEVTOOLS=1 "$PROJECT_DIR/scripts/run-shell-tests.sh" \
  --package "$DEVELOPMENT_ZIP" \
  "$PROJECT_DIR/tests/shell/dev/devTool.test.js"
