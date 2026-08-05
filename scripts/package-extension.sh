#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
UUID="aurora-shell@luminusos.github.io"

usage() {
  echo "Usage: $(basename "$0") production|development|check" >&2
  exit 2
}

extra_sources() {
  local root="$1"
  local excluded="$2"
  local source

  while IFS= read -r source; do
    case ":$excluded:" in
      *":$source:"*) continue ;;
    esac
    printf '%s\0' "--extra-source=$source"
  done < <(find "$root" -mindepth 1 -maxdepth 1 -printf '%P\n' | sort)
}

package_production() {
  local sources=()
  mapfile -d '' sources < <(extra_sources dist 'dev:extension.dev.js:extension.js:metadata.json:schemas:target')

  mkdir -p dist/target
  gnome-extensions pack dist \
    --force \
    --out-dir=dist/target \
    "${sources[@]}" \
    --schema="$PROJECT_DIR/dist/schemas/org.gnome.shell.extensions.aurora-shell.gschema.xml"
}

package_development() (
  local work stage target
  local sources=()

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
  mapfile -d '' sources < <(
    extra_sources "$stage" 'extension.dev.js:extension.js:metadata.json:schemas:target'
  )

  gnome-extensions pack "$stage" \
    --force \
    --out-dir="$target" \
    "${sources[@]}" \
    --schema="$stage/schemas/org.gnome.shell.extensions.aurora-shell.gschema.xml"
  mv \
    "$target/$UUID.shell-extension.zip" \
    "dist/target/$UUID.development.shell-extension.zip"
)

cd "$PROJECT_DIR"

case "${1:-}" in
  production)
    scripts/build.sh
    package_production
    ;;
  development)
    scripts/build.sh
    package_development
    ;;
  check)
    scripts/build.sh
    package_production
    package_development
    yarn tsx scripts/check-packages.ts
    ;;
  *) usage ;;
esac
