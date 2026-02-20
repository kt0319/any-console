#!/bin/bash
set -euo pipefail

TARGET="$1"

case "$TARGET" in
  db|files|all) ;;
  *) echo "invalid target: $TARGET"; exit 1 ;;
esac

echo "=== Backup ==="
echo "Target: $TARGET"
echo ""

# TODO: バックアップ処理を実装
echo "Backup is not implemented yet."
echo "Done."
