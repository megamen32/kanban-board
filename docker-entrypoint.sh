#!/bin/sh
set -eu

cd /app/ws
bun run index.ts &
WS_PID=$!

cd /app
PORT="${APP_PORT:-3001}" HOSTNAME=127.0.0.1 node server.js &
APP_PID=$!

GATEWAY_PORT="${PORT:-3000}" APP_PORT="${APP_PORT:-3001}" WS_PORT="${WS_PORT:-3003}" node gateway.js &
GATEWAY_PID=$!

terminate() {
  kill "$WS_PID" "$APP_PID" "$GATEWAY_PID" 2>/dev/null || true
  wait "$WS_PID" 2>/dev/null || true
  wait "$APP_PID" 2>/dev/null || true
  wait "$GATEWAY_PID" 2>/dev/null || true
}
trap terminate TERM INT

while :; do
  if ! kill -0 "$WS_PID" 2>/dev/null || ! kill -0 "$APP_PID" 2>/dev/null || ! kill -0 "$GATEWAY_PID" 2>/dev/null; then
    terminate
    exit 1
  fi
  sleep 1
done
