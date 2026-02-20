#!/bin/bash
set -euo pipefail

if [ -z "${WORKSPACE:-}" ]; then
  echo "WORKSPACE is not set"
  exit 1
fi

cd "$WORKSPACE"

echo "=== Git Branches ==="
echo "Workspace: $(basename "$WORKSPACE")"
echo ""
git branch -v
echo ""
echo "Current: $(git rev-parse --abbrev-ref HEAD)"
