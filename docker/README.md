# Docker — Tom Node

Run a Tom (orchestrator) node as a Docker container. Tom handles task routing, wakes Jerry when needed, and talks to cloud LLMs (Claude, GPT).

Jerry is *not* containerised — it's your home PC running Windows with a GPU. Containers don't make sense there.

---

## Quick start

### 1. Clone and build

```bash
git clone https://github.com/CalciferFriend/tom-and-jerry
cd tom-and-jerry

# Build the image
docker build -t calcifer-ai/tom -f docker/tom/Dockerfile .
```

### 2. Configure

```bash
cp docker/.env.example docker/.env
# Edit docker/.env — add TS_AUTHKEY and ANTHROPIC_API_KEY at minimum
```

Get a Tailscale auth key from https://login.tailscale.com/admin/authkeys — use **ephemeral + reusable** so re-starts don't burn keys.

### 3. Run

```bash
# Compose (recommended)
docker compose -f docker/docker-compose.yml up -d
docker compose -f docker/docker-compose.yml logs -f

# Or bare docker
docker run -d \
  --name tom \
  --network host \
  --cap-add NET_ADMIN \
  --cap-add NET_RAW \
  --device /dev/net/tun \
  -e TS_AUTHKEY=tskey-auth-... \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  calcifer-ai/tom
```

### 4. Verify

```bash
# Check gateway health
docker exec tom curl -s http://127.0.0.1:18789/health

# Run tj status inside the container
docker exec -it tom tj status

# Send a task to Jerry
docker exec -it tom tj send "summarise the latest arxiv ML papers"
```

---

## How it works

On startup the container:

1. **Tailscale up** — authenticates with `TS_AUTHKEY`, joins your tailnet
2. **OpenClaw config** — writes `~/.openclaw/openclaw.json` with the gateway token + API key
3. **TJ config** — writes `~/.tom-and-jerry/config.json` with peer info from env vars
4. **Gateway start** — boots the OpenClaw gateway on loopback port 18789
5. **Socat proxy** — forwards `<tailscale-ip>:18789 → 127.0.0.1:18789` so Jerry can reach Tom

Jerry can now send messages to Tom's Tailscale IP without any public port exposure.

---

## Volumes

| Volume | Purpose |
|--------|---------|
| `tailscale-state` | Tailscale machine identity (avoids re-auth on restart) |
| `tom-openclaw` | OpenClaw config + agent state |
| `tom-tj-config` | tom-and-jerry config (peer info, pairing code, etc.) |

## SSH key for Jerry

If you want Tom to SSH into Jerry (e.g., to run commands or check status), mount an SSH key:

```yaml
volumes:
  - ./ssh/id_ed25519:/root/.ssh/id_ed25519:ro
```

Generate with: `ssh-keygen -t ed25519 -f docker/ssh/id_ed25519 -N ""`  
Add the public key to Jerry's `~/.ssh/authorized_keys`.

---

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TS_AUTHKEY` | ✅ | — | Tailscale auth key |
| `ANTHROPIC_API_KEY` | ✅ | — | Anthropic API key |
| `TOM_NAME` | — | `Tom` | Display name |
| `TOM_EMOJI` | — | `🐱` | Avatar emoji |
| `TOM_MODEL` | — | `claude-sonnet-4-6` | Primary model |
| `TOM_GATEWAY_PORT` | — | `18789` | Gateway port |
| `TOM_GATEWAY_TOKEN` | — | *(auto-generated)* | Gateway auth token |
| `JERRY_TAILSCALE_IP` | — | — | Jerry's Tailscale IP |
| `JERRY_GATEWAY_TOKEN` | — | — | Jerry's gateway token |
| `JERRY_WOL_ENABLED` | — | `false` | Enable Wake-on-LAN |
| `JERRY_WOL_MAC` | — | — | Jerry's MAC address |
| `JERRY_WOL_BROADCAST` | — | — | WOL broadcast address |

---

## Publishing to Docker Hub

```bash
docker tag calcifer-ai/tom calcifierai/tom:latest
docker push calcifierai/tom:latest
```

One-liner for users:
```bash
docker run -d --network host --cap-add NET_ADMIN --cap-add NET_RAW \
  --device /dev/net/tun \
  -e TS_AUTHKEY=tskey-auth-... \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  calcifierai/tom
```
