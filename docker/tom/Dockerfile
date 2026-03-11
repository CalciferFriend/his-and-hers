# Tom node — Docker image
# Alpine + Node 22 + Tailscale + OpenClaw + tom-and-jerry
#
# Usage:
#   docker build -t calcifer-ai/tom -f docker/tom/Dockerfile .
#   docker run -d \
#     -e ANTHROPIC_API_KEY=sk-ant-... \
#     -e TS_AUTHKEY=tskey-auth-... \
#     -e TOM_NAME="Tom" \
#     -e TOM_EMOJI="🐱" \
#     calcifer-ai/tom

FROM node:22-alpine AS base

# ── System dependencies ───────────────────────────────────────────────────────
RUN apk add --no-cache \
    bash \
    curl \
    socat \
    openssh-client \
    iproute2 \
    ca-certificates \
    tini

# ── Tailscale ─────────────────────────────────────────────────────────────────
# Install tailscale from official Alpine package
RUN apk add --no-cache tailscale --repository=https://pkgs.tailscale.com/stable/alpine/v$(cat /etc/alpine-release | cut -d. -f1,2)/main

# ── OpenClaw ──────────────────────────────────────────────────────────────────
RUN npm install -g openclaw

# ── tom-and-jerry CLI ─────────────────────────────────────────────────────────
RUN npm install -g tom-and-jerry

# ── Runtime config dir ────────────────────────────────────────────────────────
RUN mkdir -p /root/.openclaw /root/.tom-and-jerry

# ── Entrypoint scripts ────────────────────────────────────────────────────────
COPY docker/tom/entrypoint.sh /entrypoint.sh
COPY docker/tom/start-gateway.sh /start-gateway.sh
RUN chmod +x /entrypoint.sh /start-gateway.sh

# ── Ports ─────────────────────────────────────────────────────────────────────
# Gateway listens on loopback; socat proxy exposed on Tailscale IP.
# No public ports needed — Tailscale handles routing.
EXPOSE 18789

# ── Healthcheck ───────────────────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
    CMD curl -sf http://127.0.0.1:18789/health || exit 1

# ── Entrypoint ────────────────────────────────────────────────────────────────
ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]
