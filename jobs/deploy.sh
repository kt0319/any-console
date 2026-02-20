#!/bin/bash
set -euo pipefail

ENV="$1"
SERVICE="$2"

if [[ "$ENV" != "stg" && "$ENV" != "prod" ]]; then
  echo "invalid env: $ENV"
  exit 1
fi

if [[ "$SERVICE" != "api" && "$SERVICE" != "web" ]]; then
  echo "invalid service: $SERVICE"
  exit 1
fi

echo "=== Deploy ==="
echo "Deploying $SERVICE to $ENV"
echo ""

# TODO: デプロイ処理を実装
echo "Deploy is not implemented yet."
echo "Done."
