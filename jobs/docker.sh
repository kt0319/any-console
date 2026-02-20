#!/bin/bash
set -euo pipefail

ACTION="$1"
SERVICE="${2:-}"

case "$ACTION" in
  up|down|restart|logs) ;;
  *) echo "invalid action: $ACTION"; exit 1 ;;
esac

echo "=== Docker ==="
echo "Action: $ACTION"
echo "Service: ${SERVICE:-all}"
echo ""

# TODO: Docker操作を実装
echo "Docker operation is not implemented yet."
echo "Done."
