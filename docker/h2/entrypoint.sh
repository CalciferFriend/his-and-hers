#!/usr/bin/env bash
# entrypoint.sh — H2 node Docker entrypoint
# Handles: Tailscale auth, SSH key injection, OpenClaw config, Ollama start, gateway

set -euo pipefail

# ── Validate required env vars ────────────────────────────────────────────────
: "${TS_AUTHKEY:?TS_AUTHKEY is required (Tailscale auth key)}"

# ── Optional config via env ───────────────────────────────────────────────────
H2_NAME="${H2_NAME:-H2}"
JERRY_EMOJI="${JERRY_EMOJI:-🐭}"
JERRY_MODEL="${JERRY_MODEL:-llama3.2}"
JERRY_PROVIDER="${JERRY_PROVIDER:-ollama}"
JERRY_GATEWAY_PORT="${JERRY_GATEWAY_PORT:-18789}"
JERRY_GATEWAY_TOKEN="${JERRY_GATEWAY_TOKEN:-$(openssl rand -hex 24)}"
JERRY_OLLAMA_MODELS="${JERRY_OLLAMA_MODELS:-}"  # comma-separated, e.g. "llama3.2,mistral"

echo "🐭 H2 node starting — $H2_NAME"

# ── 0. Print GPU info if available ───────────────────────────────────────────
if command -v nvidia-smi &>/dev/null; then
  echo "GPU detected:"
  nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null || true
fi

# ── 1. Start Tailscale daemon ─────────────────────────────────────────────────
echo "[1/6] Starting Tailscale..."
mkdir -p /var/lib/tailscale /var/run/tailscale
tailscaled --state=/var/lib/tailscale/tailscaled.state \
           --socket=/var/run/tailscale/tailscaled.sock &
TS_PID=$!

for i in $(seq 1 20); do
  [ -S /var/run/tailscale/tailscaled.sock ] && break
  sleep 0.5
done

tailscale up \
  --authkey="$TS_AUTHKEY" \
  --hostname="${H2_NAME,,}-h2-docker" \
  --accept-routes \
  --accept-dns \
  --timeout=30s

TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo "")
echo "[1/6] Tailscale up — IP: $TAILSCALE_IP"

# ── 2. SSH server ─────────────────────────────────────────────────────────────
echo "[2/6] Starting SSH server..."
# Inject H1's SSH public key if provided
if [ -n "${TOM_SSH_PUBKEY:-}" ]; then
  echo "$TOM_SSH_PUBKEY" >> /root/.ssh/authorized_keys
  chmod 600 /root/.ssh/authorized_keys
  echo "  Authorized H1's SSH key."
fi
/usr/sbin/sshd
echo "[2/6] SSH daemon running."

# ── 3. Start Ollama ───────────────────────────────────────────────────────────
echo "[3/6] Starting Ollama..."
OLLAMA_HOST="0.0.0.0:11434" ollama serve &
OLLAMA_PID=$!
# Wait for Ollama API
for i in $(seq 1 30); do
  curl -sf http://127.0.0.1:11434/api/tags > /dev/null 2>&1 && break
  echo "  Waiting for Ollama... ($i/30)"
  sleep 2
done
if curl -sf http://127.0.0.1:11434/api/tags > /dev/null 2>&1; then
  echo "[3/6] Ollama ready."
else
  echo "[3/6] WARNING: Ollama did not respond in time."
fi

# ── 4. Pull requested models ──────────────────────────────────────────────────
if [ -n "$JERRY_OLLAMA_MODELS" ]; then
  echo "[4/6] Pulling models: $JERRY_OLLAMA_MODELS"
  /pull-models.sh "$JERRY_OLLAMA_MODELS"
else
  # Default: pull the model configured for H2
  if [ -n "$JERRY_MODEL" ] && [ "$JERRY_PROVIDER" = "ollama" ]; then
    echo "[4/6] Pulling default model: $JERRY_MODEL"
    ollama pull "$JERRY_MODEL" || echo "  WARNING: Could not pull $JERRY_MODEL"
  else
    echo "[4/6] No Ollama models to pull (provider: $JERRY_PROVIDER)."
  fi
fi

# ── 5. Write OpenClaw + HH config ─────────────────────────────────────────────
echo "[5/6] Writing configs..."
mkdir -p /root/.openclaw /root/.cofounder

# OpenClaw config — bind to Tailscale IP so H1 can reach it
cat > /root/.openclaw/openclaw.json <<EOF
{
  "gateway": {
    "bind": "${TAILSCALE_IP:-0.0.0.0}",
    "port": $JERRY_GATEWAY_PORT,
    "auth": {
      "token": "$JERRY_GATEWAY_TOKEN"
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "${JERRY_PROVIDER}/${JERRY_MODEL}"
      }
    }
  }
}
EOF

# Write HH config if not already present (e.g. from mounted volume)
if [ ! -f /root/.cofounder/config.json ]; then
  TS_HOSTNAME=$(tailscale status --json 2>/dev/null \
    | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); try { console.log(JSON.parse(d).Self?.HostName ?? ''); } catch { console.log(''); }" \
    || echo "h2-docker")

  cat > /root/.cofounder/config.json <<EOF
{
  "version": "0.1.0",
  "gateway_port": $JERRY_GATEWAY_PORT,
  "this_node": {
    "role": "h2",
    "name": "$H2_NAME",
    "emoji": "$JERRY_EMOJI",
    "tailscale_hostname": "${TS_HOSTNAME}",
    "tailscale_ip": "${TAILSCALE_IP:-127.0.0.1}",
    "provider": {
      "kind": "${JERRY_PROVIDER}",
      "model": "${JERRY_MODEL}",
      "alias": "Ollama"
    }
  },
  "peer_node": {
    "role": "h1",
    "name": "${H1_NAME:-H1}",
    "emoji": "${TOM_EMOJI:-🐱}",
    "tailscale_hostname": "${TOM_TAILSCALE_HOSTNAME:-}",
    "tailscale_ip": "${TOM_TAILSCALE_IP:-}",
    "gateway_port": ${TOM_GATEWAY_PORT:-18789},
    "gateway_token": "${TOM_GATEWAY_TOKEN:-}",
    "ssh_user": "",
    "ssh_key_path": ""
  }
}
EOF
  echo "[5/6] HH config written."
else
  echo "[5/6] HH config already exists — skipping (mounted volume)."
fi

# ── 6. Start OpenClaw gateway ─────────────────────────────────────────────────
echo "[6/6] Starting OpenClaw gateway..."
openclaw gateway start
sleep 2

for i in $(seq 1 15); do
  curl -sf "http://127.0.0.1:$JERRY_GATEWAY_PORT/health" > /dev/null 2>&1 && break
  echo "  Waiting for gateway... ($i/15)"
  sleep 2
done

if curl -sf "http://127.0.0.1:$JERRY_GATEWAY_PORT/health" > /dev/null 2>&1; then
  echo "[6/6] Gateway healthy at port $JERRY_GATEWAY_PORT"
else
  echo "[6/6] WARNING: Gateway did not respond — check logs"
fi

# ── Advertise capabilities to H1 ─────────────────────────────────────────────
echo "Scanning and advertising capabilities..."
cofounder capabilities advertise 2>/dev/null || true

# ── Print ready banner ────────────────────────────────────────────────────────
MODEL_LIST=$(ollama list 2>/dev/null | tail -n +2 | awk '{print $1}' | tr '\n' ' ' || echo "none")

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  🐭 $H2_NAME (H2) is ready                              ║"
echo "║  Gateway:  ws://$TAILSCALE_IP:$JERRY_GATEWAY_PORT             ║"
echo "║  Ollama:   http://$TAILSCALE_IP:11434                    ║"
echo "║  Token:    $JERRY_GATEWAY_TOKEN     ║"
echo "║  Models:   $MODEL_LIST               ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "Give H1 this gateway token: $JERRY_GATEWAY_TOKEN"
echo "And this IP: $TAILSCALE_IP"
echo ""

# ── Keep alive ────────────────────────────────────────────────────────────────
exec openclaw gateway logs --follow 2>&1 || wait $OLLAMA_PID
