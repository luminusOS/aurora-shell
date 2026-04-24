uuid := "aurora-shell@luminusos.github.io"
ext_dir := env("HOME") / ".local/share/gnome-shell/extensions" / uuid
toolbox_name := "aurora-shell-devel"
toolbox_image := "registry.fedoraproject.org/fedora-toolbox:44"
vagrant_name  := "aurora-shell-devel"

default:
    @just --list

deps:
    yarn install

build: deps
    yarn build
    cp metadata.json dist/
    cp -r data/schemas dist/ 2>/dev/null || true
    cp -r data/icons dist/ 2>/dev/null || true
    just compile-mo

package:
    #!/usr/bin/env bash
    set -e
    mkdir -p dist/target
    cd dist
    gnome-extensions pack . \
        --force \
        --out-dir=target \
        $(find . -maxdepth 1 -name '*.js' ! -name 'extension.js' -printf '--extra-source=%f ') \
        $(find . -maxdepth 1 -name '*.css' -printf '--extra-source=%f ') \
        --extra-source=core \
        --extra-source=modules \
        --extra-source=shared \
        --extra-source=icons \
        --extra-source=locale \
        --schema=schemas/org.gnome.shell.extensions.aurora-shell.gschema.xml
    echo "Packing Done!"

validate:
    yarn validate
    yarn lint
    yarn prettier:check
    yarn stylelint

lint:
    yarn lint

watch:
    yarn watch:css

install: package
    gnome-extensions install --force dist/target/{{ uuid }}.shell-extension.zip
    glib-compile-schemas {{ ext_dir }}/schemas/
    @echo "Installed at: {{ ext_dir }}"

uninstall:
    gnome-extensions uninstall {{ uuid }}
    @echo "Uninstalled."

logs:
    journalctl -b 0 /usr/bin/gnome-shell | grep "aurora"

clean:
    rm -rf dist

distclean:
    rm -rf dist
    rm -rf node_modules

# Translation workflow
# Run `just pot` after adding new translatable strings to regenerate the template.
# Run `just update-po` to merge new strings from the template into existing .po files.
# Edit po/*.po files (with Poedit or a text editor), then run `just build`.

pot: build
    #!/usr/bin/env bash
    set -e
    JS_FILES=$(find dist -name '*.js' | sort)
    xgettext \
        --from-code=UTF-8 \
        --language=JavaScript \
        --keyword=_ \
        --keyword=ngettext:1,2 \
        --keyword=pgettext:1c,2 \
        --output=po/aurora-shell@luminusos.github.io.pot \
        $JS_FILES
    @echo "POT file regenerated: po/aurora-shell@luminusos.github.io.pot"

update-po:
    #!/usr/bin/env bash
    set -e
    POT="po/aurora-shell@luminusos.github.io.pot"
    for po in data/po/*.po; do
        echo "Merging $po..."
        msgmerge --update --backup=none "$po" "$POT"
    done
    @echo "All .po files updated."

compile-mo:
    #!/usr/bin/env bash
    set -e
    DOMAIN="aurora-shell@luminusos.github.io"
    for po in data/po/*.po; do
        [ -f "$po" ] || continue
        lang=$(basename "$po" .po)
        outdir="dist/locale/$lang/LC_MESSAGES"
        mkdir -p "$outdir"
        msgfmt --output-file="$outdir/$DOMAIN.mo" "$po"
        echo "Compiled $po -> $outdir/$DOMAIN.mo"
    done

all: clean build install
    @echo "Complete installation finished."

unit-test:
    yarn test:unit

coverage:
    yarn test:unit:coverage

# Run a single test script with gnome-shell-test-tool (headless).
# Wrapped in dbus-run-session to avoid conflicting with any running GNOME session.
# Usage: just test tests/shell/auroraBasic.js
test script: package
    dbus-run-session gnome-shell-test-tool --headless \
        --extension dist/target/{{ uuid }}.shell-extension.zip \
        {{ script }}

test-all: package
    #!/usr/bin/env bash
    set -e
    EXT="dist/target/{{ uuid }}.shell-extension.zip"
    PASS=0; FAIL=0
    for script in tests/shell/aurora*.js; do
        echo "==> Running $script"
        if dbus-run-session gnome-shell-test-tool --headless --extension "$EXT" "$script"; then
            echo "    PASS: $script"
            PASS=$((PASS + 1))
        else
            echo "    FAIL: $script"
            FAIL=$((FAIL + 1))
        fi
    done
    echo ""
    echo "Results: $PASS passed, $FAIL failed"
    [ "$FAIL" -eq 0 ]

run:
    #!/usr/bin/env bash
    set -e
    env GSETTINGS_SCHEMA_DIR=/usr/share/glib-2.0/schemas \
        XDG_CURRENT_DESKTOP=GNOME dbus-run-session gnome-shell --wayland --devkit

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

# Vagrant-based devkit VM (mirrors 'toolbox' but uses a full Fedora VM via Vagrant).
# Actions: create | run | ssh | remove
vagrant action *args:
    #!/usr/bin/env bash
    set -e
    case "{{ action }}" in
        "create")
            echo "Booting and provisioning Vagrant VM '{{ vagrant_name }}'..."
            vagrant up
            ;;
        "run")
            bash scripts/run-vagrant-gnome-shell.sh
            ;;
        "ssh")
            vagrant ssh
            ;;
        "remove")
            echo "Destroying Vagrant VM '{{ vagrant_name }}'..."
            vagrant destroy -f
            echo "VM '{{ vagrant_name }}' destroyed."
            ;;
        *)
            echo "Unknown vagrant action: {{ action }}"
            echo "Available: create, run, ssh, remove"
            exit 1
            ;;
    esac