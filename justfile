uuid := "aurora-shell@luminusos.github.io"
ext_dir := env("HOME") / ".local/share/gnome-shell/extensions" / uuid
toolbox_name := "gnome-shell-devel"
toolbox_image := "registry.fedoraproject.org/fedora-toolbox:42"

default:
    @just --list

deps:
    yarn install

build: deps
    yarn build
    cp metadata.json dist/
    cp -r schemas dist/ 2>/dev/null || true
    #glib-compile-schemas dist/schemas/ 2>/dev/null || true

package: build
    mkdir -p dist/target
    cd dist && \
      zip -r "target/{{ uuid }}.zip" . \
        -x "target/*" \
        -x "*.zip"

validate:
    yarn validate

lint:
    yarn lint

watch:
    yarn watch:css

install: package
    mkdir -p {{ ext_dir }}
    rsync -a --exclude='*.zip' dist/ {{ ext_dir }}/
    @echo "Installed at: {{ ext_dir }}"

uninstall:
    gnome-extensions disable {{ uuid }} 2>/dev/null || true
    rm -rf {{ ext_dir }}
    @echo "Uninstalled."

quick: build
    mkdir -p {{ ext_dir }}
    rsync -a --exclude='*.zip' dist/ {{ ext_dir }}/
    @echo "Files updated. Log out and back in to apply."

logs:
    journalctl -b 0 /usr/bin/gnome-shell | grep "aurora"

clean:
    rm -rf dist

distclean: clean
    rm -rf node_modules

all: clean build install
    @echo "Complete installation finished."

run: install
    #!/usr/bin/env bash
    set -e
    if gnome-shell --help 2>&1 | grep -q -- --devkit; then
        mode=--devkit
    elif gnome-shell --help 2>&1 | grep -q -- --nested; then
        mode=--nested
    else
        echo "Error: gnome-shell has neither --devkit nor --nested support" >&2
        exit 1
    fi
    env XDG_CURRENT_DESKTOP=GNOME dbus-run-session gnome-shell "$mode"

toolbox-run: install
    #!/usr/bin/env bash
    set -e
    if toolbox --container {{ toolbox_name }} run gnome-shell --help 2>&1 | grep -q -- --devkit; then
        mode=--devkit
    elif toolbox --container {{ toolbox_name }} run gnome-shell --help 2>&1 | grep -q -- --nested; then
        mode=--nested
    else
        echo "Error: gnome-shell has neither --devkit nor --nested support" >&2
        exit 1
    fi
    toolbox --container {{ toolbox_name }} run \
        env XDG_CURRENT_DESKTOP=GNOME dbus-run-session gnome-shell "$mode"

create-toolbox:
    toolbox create --image {{ toolbox_image }} {{ toolbox_name }}
    toolbox run --container {{ toolbox_name }} sudo dnf install -y gnome-shell glib2-devel
    @echo "Toolbox '{{ toolbox_name }}' created successfully."
