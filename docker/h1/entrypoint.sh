#!/usr/bin/env bash
# entrypoint.sh — H1 node Docker entrypoint
# Handles: Tailscale auth, OpenClaw config, gateway start, socat proxy

set -euo pipefail

# ── Validate required env vars ────────────────────────────────────────────────
: "${TS_AUTHKEY:?TS_AUTHKEY is required (Tailscale auth key)}"
: "${ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY is required}"

# ── Optional config via env ───────────────────────────────────────────────────
H1_NAME="${H1_NAME:-H1}"
TOM_EMOJI="${TOM_EMOJI:-🐱}"
TOM_MODEL="${TOM_MODEL:-claude-sonnet-4-6}"
TOM_GATEWAY_PORT="${TOM_GATEWAY_PORT:-18789}"
TOM_GATEWAY_TOKEN="${TOM_GATEWAY_TOKEN:-$(openssl rand -hex 24)}"

echo "🐱 H1 node starting — $H1_NAME"

# ── 1. Start Tailscale daemon ─────────────────────────────────────────────────
echo "[1/5] Starting Tailscale..."
tailscaled --state=/var/lib/tailscale/tailscaled.state \
           --socket=/var/run/tailscale/tailscaled.sock &
TS_PID=$!

# Wait for tailscaled socket
for i in $(seq 1 20); do
  [ -S /var/run/tailscale/tailscaled.sock ] && break
  sleep 0.5
done

# Authenticate
tailscale up \
  --authkey="$TS_AUTHKEY" \
  --hostname="${H1_NAME,,}-h1-docker" \
  --accept-routes \
  --accept-dns \
  --timeout=30s

TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo "")
echo "[1/5] Tailscale up — IP: $TAILSCALE_IP"

# ── 2. Write OpenClaw config ──────────────────────────────────────────────────
echo "[2/5] Writing OpenClaw config..."
mkdir -p /root/.openclaw

cat > /root/.openclaw/openclaw.json <<EOF
{
  "gateway": {
    "bind": "loopback",
    "port": $TOM_GATEWAY_PORT,
    "auth": {
      "token": "$TOM_GATEWAY_TOKEN"
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/$TOM_MODEL"
      }
    }
  },
  "models": {
    "providers": {
      "anthropic": {
        "apiKey": "$ANTHROPIC_API_KEY"
      }
    }
  }
}
EOF
echo "[2/5] OpenClaw config written."

# ── 3. Write HH config ────────────────────────────────────────────────────────
echo "[3/5] Writing cofounder config..."
TS_HOSTNAME=$(tailscale status --json 2>/dev/null | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); try { console.log(JSON.parse(d).Self?.HostName ?? ''); } catch { console.log(''); }" || echo "")

mkdir -p /root/.cofounder
if [ ! -f /root/.cofounder/config.json ]; then
  cat > /root/.cofounder/config.json <<EOF
{
  "version": "0.1.0",
  "gateway_port": $TOM_GATEWAY_PORT,
  "this_node": {
    "role": "h1",
    "name": "$H1_NAME",
    "emoji": "$TOM_EMOJI",
    "tailscale_hostname": "${TS_HOSTNAME:-h1-docker}",
    "tailscale_ip": "${TAILSCALE_IP:-127.0.0.1}",
    "provider": {
      "kind": "anthropic",
      "model": "$TOM_MODEL",
      "alias": "Claude"
    }
  },
  "peer_node": {
    "role": "h2",
    "name": "H2",
    "emoji": "🐭",
    "tailscale_hostname": "${JERRY_TAILSCALE_HOSTNAME:-}",
    "tailscale_ip": "${JERRY_TAILSCALE_IP:-}",
    "gateway_port": ${JERRY_GATEWAY_PORT:-18789},
    "gateway_token": "${JERRY_GATEWAY_TOKEN:-}",
    "ssh_user": "${JERRY_SSH_USER:-}",
    "ssh_key_path": "/root/.ssh/id_ed25519",
    "wol": {
      "enabled": ${JERRY_WOL_ENABLED:-false},
      "mac": "${JERRY_WOL_MAC:-}",
      "broadcast_ip": "${JERRY_WOL_BROADCAST:-}",
      "router_port": 9,
      "wait_timeout_seconds": 120,
      "poll_interval_seconds": 2
    }
  },
  "protocol": {
    "heartbeat_interval_seconds": 60,
    "handoff_done_signal": "DONE",
    "message_format": "json"
  }
}
EOF
  echo "[3/5] HH config written."
else
  echo "[3/5] HH config already exists — skipping (mounted volume)."
fi

# ── 4. Start OpenClaw gateway ─────────────────────────────────────────────────
echo "[4/5] Starting OpenClaw gateway..."
openclaw gateway start
sleep 2

# Verify gateway is healthy
for i in $(seq 1 15); do
  curl -sf "http://127.0.0.1:$TOM_GATEWAY_PORT/health" > /dev/null 2>&1 && break
  echo "  Waiting for gateway... ($i/15)"
  sleep 2
done

if curl -sf "http://127.0.0.1:$TOM_GATEWAY_PORT/health" > /dev/null 2>&1; then
  echo "[4/5] Gateway healthy at port $TOM_GATEWAY_PORT"
else
  echo "[4/5] WARNING: Gateway did not respond — check logs"
fi

# ── 5. Start socat proxy (Tailscale → loopback) ───────────────────────────────
if [ -n "$TAILSCALE_IP" ]; then
  echo "[5/5] Starting socat proxy $TAILSCALE_IP:$TOM_GATEWAY_PORT → 127.0.0.1:$TOM_GATEWAY_PORT"
  socat "TCP-LISTEN:$TOM_GATEWAY_PORT,bind=$TAILSCALE_IP,reuseaddr,fork" \
        "TCP:127.0.0.1:$TOM_GATEWAY_PORT" &
  echo "[5/5] Socat proxy running."
else
  echo "[5/5] No Tailscale IP — skipping socat proxy (gateway loopback-only)."
fi

# ── Print ready banner ────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  🐱 $H1_NAME (H1) is ready                              ║"
echo "║  Gateway:  ws://127.0.0.1:$TOM_GATEWAY_PORT                ║"
echo "║  Tailscale: $TAILSCALE_IP                                ║"
echo "║  Token:    $TOM_GATEWAY_TOKEN            ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "Run 'cofounder status' to check connectivity."
echo "Run 'cofounder send \"<task>\"' to dispatch work to H2."
echo ""

# ── Keep alive — tail gateway logs ───────────────────────────────────────────
exec openclaw gateway logs --follow 2>&1 || tail -f /dev/null
