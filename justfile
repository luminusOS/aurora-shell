uuid := "aurora-shell@luminusos.github.io"
ext_dir := env("HOME") / ".local/share/gnome-shell/extensions" / uuid
toolbox_name := "gnome-shell-devel"
toolbox_image := "registry.fedoraproject.org/fedora-toolbox:42"

# List available commands
default:
    @just --list

# Install dependencies
deps:
    yarn install

# Build everything (CSS + TypeScript + zip)
build: deps
    yarn build

# Type-check without emitting
validate:
    yarn validate

# Lint the codebase
lint:
    yarn lint

# Watch SCSS files for changes
watch:
    yarn watch:css

# Install extension to GNOME Shell
install: build
    mkdir -p {{ ext_dir }}
    cp dist/extension.js {{ ext_dir }}/
    cp dist/prefs.js {{ ext_dir }}/ 2>/dev/null || true
    cp dist/stylesheet.css {{ ext_dir }}/
    cp dist/stylesheet-light.css {{ ext_dir }}/
    cp dist/stylesheet-dark.css {{ ext_dir }}/
    cp dist/metadata.json {{ ext_dir }}/
    cp -r schemas {{ ext_dir }}/ 2>/dev/null || true
    glib-compile-schemas {{ ext_dir }}/schemas/ 2>/dev/null || true
    @echo "Installed at: {{ ext_dir }}"

# Uninstall extension
uninstall:
    gnome-extensions disable {{ uuid }} 2>/dev/null || true
    rm -rf {{ ext_dir }}
    @echo "Uninstalled."

# Quick update (rebuild + copy files, no full install)
quick: build
    cp dist/extension.js {{ ext_dir }}/
    cp dist/prefs.js {{ ext_dir }}/ 2>/dev/null || true
    cp dist/stylesheet.css {{ ext_dir }}/
    cp dist/stylesheet-light.css {{ ext_dir }}/
    cp dist/stylesheet-dark.css {{ ext_dir }}/
    cp dist/metadata.json {{ ext_dir }}/
    cp -r schemas {{ ext_dir }}/ 2>/dev/null || true
    glib-compile-schemas {{ ext_dir }}/schemas/ 2>/dev/null || true
    @echo "Files updated. Log out and back in to apply."

# Show recent extension logs
logs:
    journalctl -b 0 /usr/bin/gnome-shell | grep "Aurora Shell" | tail -n 20

# Clean build artifacts
clean:
    rm -rf dist

# Full clean (artifacts + dependencies)
distclean: clean
    rm -rf node_modules

# Clean build + install
all: clean build install
    @echo "Complete installation finished."

# Run GNOME Shell with the extension (auto-detects --devkit or --nested)
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

# Run GNOME Shell with the extension inside a toolbox (auto-detects --devkit or --nested)
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

# Create development toolbox for testing
create-toolbox:
    toolbox create --image {{ toolbox_image }} {{ toolbox_name }}
    toolbox run --container {{ toolbox_name }} sudo dnf install -y gnome-shell glib2-devel
    @echo "Toolbox '{{ toolbox_name }}' created successfully."
