uuid := "aurora-shell@luminusos.github.io"
ext_dir := env("HOME") / ".local/share/gnome-shell/extensions" / uuid

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
