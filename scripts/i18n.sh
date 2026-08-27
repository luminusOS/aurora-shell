#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
DOMAIN="aurora-shell@luminusos.github.io"

compile() {
  local catalog language output

  for catalog in data/po/*.po; do
    [[ -f "$catalog" ]] || continue
    language="$(basename "$catalog" .po)"
    output="dist/locale/$language/LC_MESSAGES/$DOMAIN.mo"
    mkdir -p "$(dirname "$output")"
    msgfmt --output-file="$output" "$catalog"
  done
}

pot() {
  local javascript_files=()

  scripts/build.sh
  mapfile -t javascript_files < <(find dist -name '*.js' | sort)
  xgettext \
    --from-code=UTF-8 \
    --language=JavaScript \
    --keyword=_ \
    --keyword=ngettext:1,2 \
    --package-name=aurora-shell \
    --msgid-bugs-address=https://github.com/luminusOS/aurora-shell/issues \
    --output="dist/$DOMAIN.pot" \
    "${javascript_files[@]}"
}

update() {
  local catalog

  pot
  for catalog in data/po/*.po; do
    msgmerge --update --backup=none "$catalog" "dist/$DOMAIN.pot"
  done
}

cd "$PROJECT_DIR"

case "${1:-}" in
  compile) compile ;;
  pot) pot ;;
  update) update ;;
  *)
    echo "Usage: $(basename "$0") compile|pot|update" >&2
    exit 2
    ;;
esac
