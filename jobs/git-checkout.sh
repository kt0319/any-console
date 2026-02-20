#!/bin/bash
set -euo pipefail

BRANCH="$1"

if [ -z "${WORKSPACE:-}" ]; then
  echo "WORKSPACE is not set"
  exit 1
fi

cd "$WORKSPACE"

echo "=== Git Checkout ==="
echo "Workspace: $(basename "$WORKSPACE")"
echo "Branch: $BRANCH"
echo ""
git checkout "$BRANCH"
echo ""
echo "Current: $(git rev-parse --abbrev-ref HEAD)"
