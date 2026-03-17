#!/usr/bin/env bash

set -e

TOOLBOX="${1:-gnome-shell-devel}"
IMAGE="${2:-registry.fedoraproject.org/fedora-toolbox:44}"

PACKAGES=(
  gnome-shell
  glib2-devel
  mutter-devkit
  mutter-tests
  dbus-daemon
  gsettings-desktop-schemas
  xeyes
)

echo "Creating toolbox $TOOLBOX from $IMAGE..."

toolbox create --image $IMAGE $TOOLBOX

echo "Installing packages..."
toolbox run --container $TOOLBOX sudo dnf install -y ${PACKAGES[@]}

echo "Toolbox $TOOLBOX created successfully!"
