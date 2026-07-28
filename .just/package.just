uuid := "aurora-shell@luminusos.github.io"

# Build the production ZIP.
default: production

# Build the production ZIP.
production: _build _production

# Build the DevTool-enabled ZIP.
development: _build _development

# Build and inspect both ZIPs.
[no-cd]
check: _build _production _development
    yarn tsx scripts/check-packages.ts

[no-cd]
_build:
    just build

[no-cd]
_production:
    #!/usr/bin/env bash
    set -e
    mkdir -p dist/target
    cd dist

    extra_sources=()
    while IFS= read -r source; do
        case "$source" in
            dev|extension.dev.js|extension.js|metadata.json|schemas|target) continue ;;
        esac
        extra_sources+=("--extra-source=$source")
    done < <(find . -mindepth 1 -maxdepth 1 -printf '%P\n' | sort)

    gnome-extensions pack . \
        --force \
        --out-dir=target \
        "${extra_sources[@]}" \
        --schema=schemas/org.gnome.shell.extensions.aurora-shell.gschema.xml

    echo "Production package ready."

[no-cd]
_development:
    #!/usr/bin/env bash
    set -e
    work="$(mktemp -d)"
    stage="$work/stage"
    target="$work/target"
    trap 'rm -rf "$work"' EXIT

    mkdir -p "$stage" "$target" dist/target
    cp -a dist/. "$stage/"
    rm -rf "$stage/target"
    cp "$stage/extension.dev.js" "$stage/extension.js"
    cp "$stage/dev/stylesheet.css" "$stage/stylesheet.css"
    cp "$stage/dev/stylesheet-light.css" "$stage/stylesheet-light.css"
    cp "$stage/dev/stylesheet-dark.css" "$stage/stylesheet-dark.css"

    extra_sources=()
    while IFS= read -r source; do
        case "$source" in
            extension.dev.js|extension.js|metadata.json|schemas|target) continue ;;
        esac
        extra_sources+=("--extra-source=$source")
    done < <(find "$stage" -mindepth 1 -maxdepth 1 -printf '%P\n' | sort)

    gnome-extensions pack "$stage" \
        --force \
        --out-dir="$target" \
        "${extra_sources[@]}" \
        --schema="$stage/schemas/org.gnome.shell.extensions.aurora-shell.gschema.xml"
    mv \
        "$target/{{ uuid }}.shell-extension.zip" \
        "dist/target/{{ uuid }}.development.shell-extension.zip"

    echo "Development package ready."
