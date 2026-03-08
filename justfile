uuid := "aurora-shell@luminusos.github.io"
ext_dir := env("HOME") / ".local/share/gnome-shell/extensions" / uuid
toolbox_name := "gnome-shell-devel"
toolbox_image := "registry.fedoraproject.org/fedora-toolbox:44"

default:
    @just --list

deps:
    yarn install

build: deps
    yarn build
    cp metadata.json dist/
    cp -r schemas dist/ 2>/dev/null || true

package: build
    mkdir -p dist/target
    cd dist && \
      zip -r "target/{{ uuid }}.zip" . \
        -x "target/*" \
        -x "*.zip" \
        -x "schemas/gschemas.compiled"

validate:
    yarn validate

lint:
    yarn lint

watch:
    yarn watch:css

install: package
    gnome-extensions install --force dist/target/{{ uuid }}.zip
    glib-compile-schemas {{ ext_dir }}/schemas/
    @echo "Installed at: {{ ext_dir }}"

uninstall:
    gnome-extensions uninstall {{ uuid }}
    @echo "Uninstalled."

quick: build
    mkdir -p {{ ext_dir }}
    rsync -a --exclude='*.zip' dist/ {{ ext_dir }}/
    glib-compile-schemas {{ ext_dir }}/schemas/
    @echo "Files updated. Log out and back in to apply."

logs:
    journalctl -b 0 /usr/bin/gnome-shell | grep "aurora"

clean:
    rm -rf dist

distclean: clean
    rm -rf node_modules

all: clean build install
    @echo "Complete installation finished."

run:
    #!/usr/bin/env bash
    set -e
    env XDG_CURRENT_DESKTOP=GNOME dbus-run-session gnome-shell --wayland --devkit

toolbox action *args:
    #!/usr/bin/env bash
    set -e
    case "{{ action }}" in
        "create")
            bash scripts/create-toolbox.sh {{ toolbox_name }} {{ toolbox_image }}
            ;;
        "run")
            bash scripts/run-gnome-shell.sh {{ toolbox_name }}
            ;;
        "remove")
            echo "Removing toolbox '{{ toolbox_name }}'..."
            toolbox rm --force {{ toolbox_name }}
            echo "Toolbox '{{ toolbox_name }}' removed."
            ;;
        *)
            echo "Unknown toolbox action: {{ action }}"
            echo "Available: create, run, remove"
            exit 1
            ;;
    esac
