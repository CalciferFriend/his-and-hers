# H1 node — Docker image
# Alpine + Node 22 + Tailscale + OpenClaw + his-and-hers
#
# Usage:
#   docker build -t calcifer-ai/h1 -f docker/tom/Dockerfile .
#   docker run -d \
#     -e ANTHROPIC_API_KEY=sk-ant-... \
#     -e TS_AUTHKEY=tskey-auth-... \
#     -e H1_NAME="H1" \
#     -e TOM_EMOJI="🐱" \
#     calcifer-ai/h1

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

# ── his-and-hers CLI ─────────────────────────────────────────────────────────
RUN npm install -g his-and-hers

# ── Runtime config dir ────────────────────────────────────────────────────────
RUN mkdir -p /root/.openclaw /root/.his-and-hers

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
