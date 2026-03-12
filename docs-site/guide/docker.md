# Docker Setup

Run Tom and Jerry in containers. Docker is the cleanest way to run Tom on a server and works for Jerry on Linux (CPU or CUDA). For Windows Jerry and M2 Mac Jerry, use the native setup — Docker doesn't give you access to Apple's Metal or Windows GPU toolchain.

---

## Tom (any platform)

### Quick start

```bash
docker run -d \
  --name tom \
  --restart unless-stopped \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e TJ_ROLE=tom \
  -e TJ_NAME="Calcifer" \
  -e TJ_EMOJI="🔥" \
  -e TS_AUTHKEY=tskey-auth-... \
  -e JERRY_TAILSCALE_IP=100.x.y.z \
  -e JERRY_SSH_USER=ubuntu \
  -v hh-h1-data:/root/.his-and-hers \
  calcifierai/tom:latest
```

First boot: the container runs `tj onboard --non-interactive` and registers with Tailscale automatically.

### docker-compose (recommended)

```yaml
# docker-compose.yml
services:
  tom:
    image: calcifierai/tom:latest
    container_name: tom
    restart: unless-stopped
    environment:
      - TJ_ROLE=tom
      - TJ_NAME=${TOM_NAME:-Calcifer}
      - TJ_EMOJI=${TOM_EMOJI:-🔥}
      - TS_AUTHKEY=${TS_AUTHKEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY:-}
      - JERRY_TAILSCALE_IP=${JERRY_TAILSCALE_IP}
      - JERRY_SSH_USER=${JERRY_SSH_USER:-ubuntu}
      - GATEWAY_PORT=${GATEWAY_PORT:-3737}
    volumes:
      - tom-data:/root/.his-and-hers
      - ~/.ssh:/root/.ssh:ro   # SSH keys for connecting to Jerry
    cap_add:
      - NET_ADMIN   # needed for Tailscale
    devices:
      - /dev/net/tun:/dev/net/tun

volumes:
  tom-data:
```

Create `.env`:

```bash
cp docker/.env.example .env
# Fill in: TS_AUTHKEY, ANTHROPIC_API_KEY, JERRY_TAILSCALE_IP, etc.
```

Start:

```bash
docker compose --profile tom up -d
```

---

## Jerry — CPU (Linux, no GPU)

For always-on lightweight compute: embeddings, small models, summarization.

```yaml
# docker-compose.yml (add alongside Tom or standalone)
services:
  jerry-cpu:
    image: calcifierai/jerry:cpu
    container_name: jerry-cpu
    restart: unless-stopped
    profiles: ["jerry-cpu"]
    environment:
      - TJ_ROLE=jerry
      - TJ_NAME=${JERRY_NAME:-Jerry}
      - TJ_EMOJI=${JERRY_EMOJI:-🤖}
      - TS_AUTHKEY=${TS_AUTHKEY}
      - TOM_TAILSCALE_IP=${TOM_TAILSCALE_IP}
      - OLLAMA_MODELS=${OLLAMA_MODELS:-llama3.2:3b,nomic-embed-text}
      - GATEWAY_PORT=${GATEWAY_PORT:-3737}
    volumes:
      - jerry-cpu-data:/root/.his-and-hers
      - ollama-models:/root/.ollama
    cap_add:
      - NET_ADMIN
    devices:
      - /dev/net/tun:/dev/net/tun
```

Start:

```bash
docker compose --profile jerry-cpu up -d
```

The entrypoint:
1. Starts Tailscale with the provided auth key
2. Starts Ollama and pulls models listed in `OLLAMA_MODELS`
3. Runs `tj onboard --non-interactive` with Tom's Tailscale IP
4. Starts the OpenClaw gateway bound to the Tailscale IP
5. Runs `tj capabilities advertise`

---

## Jerry — CUDA (NVIDIA GPU)

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

### Run CUDA Jerry

```bash
docker build \
  -t jerry-cuda:latest \
  -f docker/jerry/Dockerfile.cuda .

docker run -d \
  --name jerry-cuda \
  --restart unless-stopped \
  --gpus all \
  -e TJ_ROLE=jerry \
  -e TJ_NAME="GLaDOS" \
  -e TJ_EMOJI="🤖" \
  -e TS_AUTHKEY=tskey-auth-... \
  -e TOM_TAILSCALE_IP=100.x.y.z \
  -e OLLAMA_MODELS="llama3.2,mistral,nomic-embed-text" \
  -v jerry-data:/root/.his-and-hers \
  -v ollama-models:/root/.ollama \
  jerry-cuda:latest
```

Or via docker-compose:

```yaml
services:
  jerry-cuda:
    build:
      context: .
      dockerfile: docker/jerry/Dockerfile.cuda
    container_name: jerry-cuda
    restart: unless-stopped
    profiles: ["jerry-cuda"]
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
    environment:
      - TJ_ROLE=jerry
      - TJ_NAME=${JERRY_NAME:-GLaDOS}
      - TJ_EMOJI=${JERRY_EMOJI:-🤖}
      - TS_AUTHKEY=${TS_AUTHKEY}
      - TOM_TAILSCALE_IP=${TOM_TAILSCALE_IP}
      - OLLAMA_MODELS=${OLLAMA_MODELS:-llama3.2,mistral,qwen2.5-coder:7b}
    volumes:
      - jerry-data:/root/.his-and-hers
      - ollama-models:/root/.ollama
    cap_add:
      - NET_ADMIN
    devices:
      - /dev/net/tun:/dev/net/tun
```

---

## Jerry — ARM64 (Raspberry Pi 5)

```bash
docker build \
  --platform linux/arm64 \
  -t jerry-arm64:latest \
  -f docker/jerry/Dockerfile.arm64 .

docker run -d \
  --platform linux/arm64 \
  --name jerry-pi \
  --restart unless-stopped \
  -e TS_AUTHKEY=tskey-auth-... \
  -e TJ_NAME="jerry-pi" \
  -e TJ_EMOJI="🍓" \
  -e TOM_TAILSCALE_IP=100.x.y.z \
  -e OLLAMA_MODELS="llama3.2:3b,nomic-embed-text" \
  -v jerry-pi-data:/root/.his-and-hers \
  -v ollama-models:/root/.ollama \
  jerry-arm64:latest
```

Use quantized models (`llama3.2:3b-q4_0`) to fit in the Pi's RAM.

---

## Environment variable reference

| Variable | Default | Description |
|----------|---------|-------------|
| `TJ_ROLE` | — | `tom` or `jerry` (required) |
| `TJ_NAME` | `Tom` / `Jerry` | Node display name |
| `TJ_EMOJI` | `🔥` / `🤖` | Node emoji |
| `TS_AUTHKEY` | — | Tailscale auth key (required) |
| `ANTHROPIC_API_KEY` | — | Anthropic API key (Tom, optional) |
| `OPENAI_API_KEY` | — | OpenAI API key (Tom, optional) |
| `JERRY_TAILSCALE_IP` | — | Jerry's Tailscale IP (Tom only) |
| `TOM_TAILSCALE_IP` | — | Tom's Tailscale IP (Jerry only) |
| `OLLAMA_MODELS` | `llama3.2` | Comma-separated models to pull on startup |
| `GATEWAY_PORT` | `3737` | Gateway listen port |

---

## Checking container health

```bash
# Check status from inside Tom container
docker exec tom tj status

# Tail logs
docker logs -f tom
docker logs -f jerry-cuda

# Follow task log
docker exec tom tj logs --follow
```

---

## Notes

- WOL is not supported in Docker — containers don't have access to the host NIC's magic packet broadcast. Use native installs for WOL-dependent setups.
- On Windows: use WSL2 for CPU containers. CUDA containers require WSL2 + NVIDIA CUDA on WSL2 — see [NVIDIA docs](https://docs.nvidia.com/cuda/wsl-user-guide/).
- The CUDA image is large (~4 GB base). Pull once and cache.
