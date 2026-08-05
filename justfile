uuid := "aurora-shell@luminusos.github.io"
extension_dir := env("HOME") / ".local/share/gnome-shell/extensions" / uuid

mod package '.just/package.just'
mod test '.just/test.just'
mod toolbox '.just/toolbox.just'
mod i18n '.just/i18n.just'
mod vagrant '.just/vagrant.just'

# List the available command groups.
default:
    @just --list

# Install immutable JavaScript dependencies.
deps:
    yarn install --immutable

build:
    scripts/build.sh

# Run type, lint, formatting, and style checks.
validate:
    yarn validate

# Run ESLint.
lint:
    yarn lint

# Watch and recompile SCSS.
watch:
    yarn watch:css

shexli *args: package::production
    scripts/run-shexli.sh {{ args }}

# Install the development package locally.
install: package::development
    gnome-extensions install --force dist/target/{{ uuid }}.development.shell-extension.zip
    glib-compile-schemas {{ extension_dir }}/schemas/
    @echo "Installed development package at: {{ extension_dir }}"

# Remove the locally installed extension.
uninstall:
    gnome-extensions uninstall {{ uuid }}
    @echo "Uninstalled."

run: install
    scripts/run-gnome-shell.sh

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
