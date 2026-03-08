#!/usr/bin/env bash

# Exit on error
set -e

# Ensure a version argument is passed
if [ -z "$1" ]; then
  echo "Error: No version provided."
  echo "Usage: $0 <version>"
  echo "Example: $0 51"
  exit 1
fi

VERSION=$1
METADATA_FILE="metadata.json"

# Make sure we are in the project root
if [ ! -f "$METADATA_FILE" ]; then
  echo "Error: $METADATA_FILE not found in the current directory."
  echo "Please run this script from the root of the aurora-shell project."
  exit 1
fi

echo "Bumping version to $VERSION in $METADATA_FILE..."

# Use node to properly parse and modify the JSON so formatting is maintained
node -e "
  const fs = require('fs');
  const file = '$METADATA_FILE';
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  
  data.version = '$VERSION';
  
  // Extract major version (e.g., 50.1 -> 50)
  const majorVersion = '$VERSION'.split('.')[0];
  
  // Also optionally update the shell-version array if needed
  if (!data['shell-version'].includes(majorVersion)) {
      data['shell-version'].push(majorVersion);
  }

  fs.writeFileSync(file, JSON.stringify(data, null, 4) + '\n');
"

echo "Successfully updated $METADATA_FILE"

# Create git commit
git add "$METADATA_FILE"
git commit -m "chore: bump version to $VERSION"

# Create git tag
TAG="v$VERSION"
git tag -a "$TAG" -m "Release $TAG"

echo ""
echo "Version bumped successfully!"
echo "A commit and annotated tag ($TAG) have been created."
echo ""
echo "To push the new release to GitHub and trigger the GitHub Action, run:"
echo "  git push origin main && git push origin $TAG"
