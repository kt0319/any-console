#!/bin/bash
set -euo pipefail

pick_port() {
  while true; do
    local p
    p=$(shuf -i 10000-20000 -n 1)
    if ! lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "$p"
      return 0
    fi
  done
}

PORT=$(pick_port)
BASE_PATH="${TERMINAL_BASE_PATH:-/}"

sudo -n -u terminal timeout 600 ttyd \
  --interface 127.0.0.1 \
  --port "$PORT" \
  --base-path "$BASE_PATH" \
  --once \
  bash >/tmp/pi-console-ttyd-"$PORT".log 2>&1 &

PID=$!
sleep 0.3

if ! kill -0 "$PID" 2>/dev/null; then
  echo "FAILED_TO_START_TTYD" >&2
  exit 1
fi

echo "PORT=$PORT"
echo "PID=$PID"
