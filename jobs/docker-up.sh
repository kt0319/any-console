#!/usr/bin/env bash
set -euo pipefail

cd "${WORKSPACE_PATH:-.}"
docker compose up -d
