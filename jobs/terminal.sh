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
TMUX_SESSION="pi-${PORT}"

unset CLAUDECODE

ttyd \
  --writable \
  --interface 127.0.0.1 \
  --port "$PORT" \
  --base-path "$BASE_PATH" \
  -t disableResizeOverlay=true \
  tmux new-session -A -s "$TMUX_SESSION" \; set-option status off >/tmp/pi-console-ttyd-"$PORT".log 2>&1 &

PID=$!

for i in $(seq 1 20); do
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "FAILED_TO_START_TTYD" >&2
    cat /tmp/pi-console-ttyd-"$PORT".log >&2 2>/dev/null || true
    exit 1
  fi
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

if ! lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "TTYD_PORT_NOT_READY" >&2
  kill "$PID" 2>/dev/null || true
  exit 1
fi

echo "PORT=$PORT"
echo "PID=$PID"
