#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
GNOME_VERSION="$(node -e '
  const {readFileSync} = require("node:fs");
  const metadata = JSON.parse(readFileSync(process.argv[1], "utf8"));
  const version = metadata["shell-version"]?.[0];

  if (typeof version !== "string" || version.length === 0)
    process.exit(1);

  process.stdout.write(version);
' "$PROJECT_DIR/metadata.json")"
IMAGE_HASH="$({
  cd "$PROJECT_DIR"
  sha256sum \
    Containerfile \
    .dockerignore \
    package.json \
    yarn.lock \
    .yarnrc.yml \
    scripts/ci-image-name.sh
  find .yarn/releases -type f -print0 | sort -z | xargs -0 sha256sum
} | sha256sum | cut -c1-12)"

printf 'ghcr.io/luminusos/aurora-shell-ci:gnome%s-%s\n' \
  "$GNOME_VERSION" \
  "$IMAGE_HASH"
