#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

cd "$PROJECT_DIR"
yarn build
cp metadata.json LICENSE CREDITS.md dist/
cp -r data/schemas data/icons data/media dist/
glib-compile-schemas dist/schemas/
scripts/i18n.sh compile
