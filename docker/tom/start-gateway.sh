#!/usr/bin/env bash
# start-gateway.sh — standalone helper to (re)start OpenClaw gateway inside the Tom container
# Called by entrypoint.sh; can also be run manually for debugging.

set -euo pipefail

PORT="${TOM_GATEWAY_PORT:-18789}"

echo "Starting OpenClaw gateway on port $PORT..."
openclaw gateway restart 2>/dev/null || openclaw gateway start

# Wait up to 30s
for i in $(seq 1 15); do
  if curl -sf "http://127.0.0.1:$PORT/health" > /dev/null 2>&1; then
    echo "Gateway healthy ✓"
    exit 0
  fi
  sleep 2
done

echo "Gateway did not become healthy in time." >&2
exit 1
