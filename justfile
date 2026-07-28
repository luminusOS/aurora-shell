uuid := "aurora-shell@luminusos.github.io"
extension_dir := env("HOME") / ".local/share/gnome-shell/extensions" / uuid

# Build production and development extension archives.
mod package '.just/package.just'
# Run unit, coverage, and GNOME Shell tests.
mod test '.just/test.just'
# Manage and test inside the Fedora development container.
mod toolbox '.just/toolbox.just'
# Maintain translation templates and compiled catalogs.
mod translation '.just/translation.just'
# Manage the full development VM.
mod vagrant '.just/vagrant.just'

# List the available command groups.
default:
    @just --list

# Install immutable JavaScript dependencies.
deps:
    yarn install --immutable

# Compile sources and assemble the unpacked extension.
build:
    yarn build
    cp metadata.json dist/
    cp LICENSE CREDITS.md dist/
    cp -r data/schemas dist/
    glib-compile-schemas dist/schemas/
    cp -r data/icons dist/
    cp -r data/media dist/
    just translation compile

# Run type, lint, formatting, and style checks.
validate:
    yarn validate

# Run ESLint.
lint:
    yarn lint

# Watch and recompile SCSS.
watch:
    yarn watch:css

# Scan the production package with the EGO static analyzer.
shexli *args: package::production
    #!/usr/bin/env bash
    set -e
    extension="dist/target/{{ uuid }}.shell-extension.zip"

    if command -v shexli >/dev/null 2>&1; then
        shexli "$extension" {{ args }}
    elif command -v uvx >/dev/null 2>&1; then
        uvx --from shexli shexli "$extension" {{ args }}
    else
        echo "shexli is not installed."
        echo "Install it with: python3 -m pip install --user shexli"
        exit 1
    fi

# Install the development package locally.
install: package::development
    gnome-extensions install --force dist/target/{{ uuid }}.development.shell-extension.zip
    glib-compile-schemas {{ extension_dir }}/schemas/
    @echo "Installed development package at: {{ extension_dir }}"

# Remove the locally installed extension.
uninstall:
    gnome-extensions uninstall {{ uuid }}
    @echo "Uninstalled."

# Install development and launch a host devkit GNOME Shell session.
run: install
    #!/usr/bin/env bash
    set -e
    shell_environment=(
        GSETTINGS_SCHEMA_DIR=/usr/share/glib-2.0/schemas
        AURORA_DEVTOOLS=1
        XDG_CURRENT_DESKTOP=GNOME
    )
    env "${shell_environment[@]}" dbus-run-session gnome-shell --wayland --devkit

# Show Aurora messages from the current boot.
logs:
    journalctl -b 0 -r -o cat /usr/bin/gnome-shell | grep -i "aurora"

# Remove build output, or all generated dependencies with `just clean all`.
clean scope="dist":
    #!/usr/bin/env bash
    set -e
    case "{{ scope }}" in
        dist)
            rm -rf dist
            ;;
        all)
            rm -rf dist node_modules
            ;;
        *)
            echo "Unknown clean scope: {{ scope }}"
            echo "Available: dist, all"
            exit 1
            ;;
    esac
