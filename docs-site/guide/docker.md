# Docker Setup

Run H1 and H2 in containers. Docker is the cleanest way to run H1 on a server and works for H2 on Linux (CPU or CUDA). For Windows H2 and M2 Mac H2, use the native setup — Docker doesn't give you access to Apple's Metal or Windows GPU toolchain.

---

## H1 (any platform)

### Quick start

```bash
docker run -d \
  --name h1 \
  --restart unless-stopped \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e HH_ROLE=h1 \
  -e HH_NAME="Calcifer" \
  -e TJ_EMOJI="🔥" \
  -e TS_AUTHKEY=tskey-auth-... \
  -e JERRY_TAILSCALE_IP=100.x.y.z \
  -e JERRY_SSH_USER=ubuntu \
  -v cofounder-h1-data:/root/.cofounder \
  calcifierai/h1:latest
```

First boot: the container runs `cofounder onboard --non-interactive` and registers with Tailscale automatically.

### docker-compose (recommended)

```yaml
# docker-compose.yml
services:
  h1:
    image: calcifierai/h1:latest
    container_name: h1
    restart: unless-stopped
    environment:
      - HH_ROLE=h1
      - HH_NAME=${H1_NAME:-Calcifer}
      - TJ_EMOJI=${TOM_EMOJI:-🔥}
      - TS_AUTHKEY=${TS_AUTHKEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY:-}
      - JERRY_TAILSCALE_IP=${JERRY_TAILSCALE_IP}
      - JERRY_SSH_USER=${JERRY_SSH_USER:-ubuntu}
      - GATEWAY_PORT=${GATEWAY_PORT:-3737}
    volumes:
      - h1-data:/root/.cofounder
      - ~/.ssh:/root/.ssh:ro   # SSH keys for connecting to H2
    cap_add:
      - NET_ADMIN   # needed for Tailscale
    devices:
      - /dev/net/tun:/dev/net/tun

volumes:
  h1-data:
```

Create `.env`:

```bash
cp docker/.env.example .env
# Fill in: TS_AUTHKEY, ANTHROPIC_API_KEY, JERRY_TAILSCALE_IP, etc.
```

Start:

```bash
docker compose --profile h1 up -d
```

---

## H2 — CPU (Linux, no GPU)

For always-on lightweight compute: embeddings, small models, summarization.

```yaml
# docker-compose.yml (add alongside H1 or standalone)
services:
  h2-cpu:
    image: calcifierai/h2:cpu
    container_name: h2-cpu
    restart: unless-stopped
    profiles: ["h2-cpu"]
    environment:
      - HH_ROLE=h2
      - HH_NAME=${H2_NAME:-H2}
      - TJ_EMOJI=${JERRY_EMOJI:-🤖}
      - TS_AUTHKEY=${TS_AUTHKEY}
      - TOM_TAILSCALE_IP=${TOM_TAILSCALE_IP}
      - OLLAMA_MODELS=${OLLAMA_MODELS:-llama3.2:3b,nomic-embed-text}
      - GATEWAY_PORT=${GATEWAY_PORT:-3737}
    volumes:
      - h2-cpu-data:/root/.cofounder
      - ollama-models:/root/.ollama
    cap_add:
      - NET_ADMIN
    devices:
      - /dev/net/tun:/dev/net/tun
```

Start:

```bash
docker compose --profile h2-cpu up -d
```

The entrypoint:
1. Starts Tailscale with the provided auth key
2. Starts Ollama and pulls models listed in `OLLAMA_MODELS`
3. Runs `cofounder onboard --non-interactive` with H1's Tailscale IP
4. Starts the OpenClaw gateway bound to the Tailscale IP
5. Runs `cofounder capabilities advertise`

---

## H2 — CUDA (NVIDIA GPU)

### Prerequisites

Install [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html):

```bash
# Ubuntu
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

Verify:

```bash
docker run --rm --gpus all nvidia/cuda:12.3-base-ubuntu22.04 nvidia-smi
# Should show your GPU
```

### Run CUDA H2

```bash
docker build \
  -t h2-cuda:latest \
  -f docker/h2/Dockerfile.cuda .

docker run -d \
  --name h2-cuda \
  --restart unless-stopped \
  --gpus all \
  -e HH_ROLE=h2 \
  -e HH_NAME="GLaDOS" \
  -e TJ_EMOJI="🤖" \
  -e TS_AUTHKEY=tskey-auth-... \
  -e TOM_TAILSCALE_IP=100.x.y.z \
  -e OLLAMA_MODELS="llama3.2,mistral,nomic-embed-text" \
  -v h2-data:/root/.cofounder \
  -v ollama-models:/root/.ollama \
  h2-cuda:latest
```

Or via docker-compose:

```yaml
services:
  h2-cuda:
    build:
      context: .
      dockerfile: docker/h2/Dockerfile.cuda
    container_name: h2-cuda
    restart: unless-stopped
    profiles: ["h2-cuda"]
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
    environment:
      - HH_ROLE=h2
      - HH_NAME=${H2_NAME:-GLaDOS}
      - TJ_EMOJI=${JERRY_EMOJI:-🤖}
      - TS_AUTHKEY=${TS_AUTHKEY}
      - TOM_TAILSCALE_IP=${TOM_TAILSCALE_IP}
      - OLLAMA_MODELS=${OLLAMA_MODELS:-llama3.2,mistral,qwen2.5-coder:7b}
    volumes:
      - h2-data:/root/.cofounder
      - ollama-models:/root/.ollama
    cap_add:
      - NET_ADMIN
    devices:
      - /dev/net/tun:/dev/net/tun
```

---

## H2 — ARM64 (Raspberry Pi 5)

```bash
docker build \
  --platform linux/arm64 \
  -t h2-arm64:latest \
  -f docker/h2/Dockerfile.arm64 .

docker run -d \
  --platform linux/arm64 \
  --name h2-pi \
  --restart unless-stopped \
  -e TS_AUTHKEY=tskey-auth-... \
  -e HH_NAME="h2-pi" \
  -e TJ_EMOJI="🍓" \
  -e TOM_TAILSCALE_IP=100.x.y.z \
  -e OLLAMA_MODELS="llama3.2:3b,nomic-embed-text" \
  -v h2-pi-data:/root/.cofounder \
  -v ollama-models:/root/.ollama \
  h2-arm64:latest
```

Use quantized models (`llama3.2:3b-q4_0`) to fit in the Pi's RAM.

---

## Environment variable reference

| Variable | Default | Description |
|----------|---------|-------------|
| `HH_ROLE` | — | `h1` or `h2` (required) |
| `HH_NAME` | `H1` / `H2` | Node display name |
| `TJ_EMOJI` | `🔥` / `🤖` | Node emoji |
| `TS_AUTHKEY` | — | Tailscale auth key (required) |
| `ANTHROPIC_API_KEY` | — | Anthropic API key (H1, optional) |
| `OPENAI_API_KEY` | — | OpenAI API key (H1, optional) |
| `JERRY_TAILSCALE_IP` | — | H2's Tailscale IP (H1 only) |
| `TOM_TAILSCALE_IP` | — | H1's Tailscale IP (H2 only) |
| `OLLAMA_MODELS` | `llama3.2` | Comma-separated models to pull on startup |
| `GATEWAY_PORT` | `3737` | Gateway listen port |

---

## Checking container health

```bash
# Check status from inside H1 container
docker exec h1 cofounder status

# Tail logs
docker logs -f h1
docker logs -f h2-cuda

# Follow task log
docker exec h1 cofounder logs --follow
```

---

## Notes

- WOL is not supported in Docker — containers don't have access to the host NIC's magic packet broadcast. Use native installs for WOL-dependent setups.
- On Windows: use WSL2 for CPU containers. CUDA containers require WSL2 + NVIDIA CUDA on WSL2 — see [NVIDIA docs](https://docs.nvidia.com/cuda/wsl-user-guide/).
- The CUDA image is large (~4 GB base). Pull once and cache.
