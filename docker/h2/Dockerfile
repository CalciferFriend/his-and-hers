# H2 node — Docker image (CPU / generic Linux)
# Ollama + Node 22 + Tailscale + OpenClaw + cofounder
#
# Usage:
#   docker build -t calcifer-ai/h2 -f docker/h2/Dockerfile .
#   docker run -d \
#     -e TS_AUTHKEY=tskey-auth-... \
#     -e H2_NAME="H2" \
#     -e JERRY_EMOJI="🐭" \
#     calcifer-ai/h2
#
# For NVIDIA GPU support use docker/h2/Dockerfile.cuda instead.
# This CPU image is a good fit for Raspberry Pi / low-power always-on nodes.

FROM node:22-slim AS base

# ── System dependencies ───────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    curl \
    socat \
    openssh-server \
    ca-certificates \
    tini \
    procps \
  && rm -rf /var/lib/apt/lists/*

# ── Tailscale ─────────────────────────────────────────────────────────────────
RUN curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.noarmor.gpg \
      | tee /usr/share/keyrings/tailscale-archive-keyring.gpg > /dev/null \
  && curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.tailscale-keyring.list \
      | tee /etc/apt/sources.list.d/tailscale.list \
  && apt-get update && apt-get install -y --no-install-recommends tailscale \
  && rm -rf /var/lib/apt/lists/*

# ── Ollama ────────────────────────────────────────────────────────────────────
RUN curl -fsSL https://ollama.com/install.sh | sh

# ── OpenClaw ──────────────────────────────────────────────────────────────────
RUN npm install -g openclaw

# ── cofounder CLI ─────────────────────────────────────────────────────────
RUN npm install -g cofounder

# ── Runtime config dirs ───────────────────────────────────────────────────────
RUN mkdir -p /root/.openclaw /root/.cofounder /root/.ollama

# ── SSH server setup (for cofounder send over SSH from H1) ─────────────────────────
RUN mkdir -p /root/.ssh && chmod 700 /root/.ssh
RUN sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
RUN ssh-keygen -A

# ── Entrypoint ────────────────────────────────────────────────────────────────
COPY docker/h2/entrypoint.sh /entrypoint.sh
COPY docker/h2/pull-models.sh /pull-models.sh
RUN chmod +x /entrypoint.sh /pull-models.sh

# ── Ports ─────────────────────────────────────────────────────────────────────
# 18789 — OpenClaw gateway (via Tailscale socat proxy)
# 11434 — Ollama API
# 22    — SSH
EXPOSE 18789 11434 22

# ── Healthcheck ───────────────────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s \
    CMD curl -sf http://127.0.0.1:18789/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
