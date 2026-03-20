---
title: Raspberry Pi 5
description: Set up a Raspberry Pi 5 as a H2 node — always-on, low-power compute for embeddings and small models.
---

# H2 on Raspberry Pi 5

Best use: always-on, low-power compute node for lightweight tasks — embeddings,
text summarization, small-context chat (3B–7B models with quantization).

---

## Hardware

| Item | Spec |
|------|------|
| CPU | ARM Cortex-A76, 4-core 2.4 GHz |
| RAM | 4 GB or 8 GB LPDDR4X (8 GB **strongly** recommended) |
| Storage | 32 GB+ microSD (Class 10/A2) or USB SSD (much faster) |
| Power | Official 27W USB-C PSU — don't skimp |
| OS | Raspberry Pi OS Lite (64-bit) or Ubuntu 24.04 LTS (arm64) |

> **USB SSD note:** SD cards are the #1 source of Pi failures under write load.
> Use a USB SSD (e.g. Samsung T7) as your root disk for any persistent H2 node.

---

## What it can run

| Task | Feasible? | Notes |
|------|-----------|-------|
| Embeddings (nomic-embed-text) | ✅ | Fast, ~300 MB RAM |
| 3B chat (llama3.2:3b-q4) | ✅ | ~2 GB RAM, ~5 tok/s |
| 7B chat (mistral:7b-q4) | ⚠️ | ~4.5 GB RAM, ~2 tok/s, 8 GB Pi only |
| 13B+ models | ❌ | Not enough RAM |
| Image generation | ❌ | CPU-only SD is impractically slow |
| Code generation (qwen2.5-coder:3b) | ✅ | Good for smaller tasks |

---

## Installation

### 1 — Flash and boot

```bash
# Use Raspberry Pi Imager → Raspberry Pi OS Lite (64-bit)
# Enable SSH, set hostname (e.g. h2-pi), configure WiFi in Imager
```

### 2 — System setup

```bash
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y curl git
```

### 3 — Install Node 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v  # should be v22.x
```

### 4 — Install Ollama (arm64)

```bash
curl -fsSL https://ollama.com/install.sh | sh

# Pull starter models
ollama pull llama3.2:3b
ollama pull nomic-embed-text
```

### 5 — Install OpenClaw + cofounder

```bash
sudo npm install -g openclaw cofounder
cofounder --version
```

### 6 — Install Tailscale

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --authkey tskey-auth-YOUR_KEY
tailscale ip -4  # note this IP for H1's config
```

### 7 — Run cofounder onboard (H2 role)

```bash
cofounder onboard
# Role: H2
# Name: h2-pi (or whatever)
# Model: Ollama → llama3.2:3b
# H1's Tailscale IP: <from H1's cofounder status>
```

---

## Systemd service

Keep the gateway running across reboots:

```ini
# /etc/systemd/system/cofounder-gateway.service
[Unit]
Description=cofounder gateway
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
Type=simple
User=pi
ExecStart=/usr/bin/node /usr/lib/node_modules/openclaw/index.js gateway start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now cofounder-gateway
sudo systemctl status cofounder-gateway
```

---

## Docker (Pi 5 ARM64)

```bash
docker build --platform linux/arm64 \
  -t h2-pi:arm64 \
  -f docker/h2/Dockerfile.arm64 .

docker run -d \
  --platform linux/arm64 \
  -e TS_AUTHKEY=tskey-auth-... \
  -e H2_NAME="h2-pi" \
  -e JERRY_EMOJI="🍓" \
  -e OLLAMA_MODELS="llama3.2:3b,nomic-embed-text" \
  calcifer-ai/h2:arm64
```

---

## Performance tips

- **USB SSD** — move rootfs off SD card; massive I/O improvement for model loading
- **Swap** — set 4 GB swap on SSD for 7B models on 8 GB Pi: `sudo dphys-swapfile`
- **CPU governor** — force performance mode:
  ```bash
  echo performance | sudo tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor
  ```
- **Cooling** — active cooling is a must under sustained inference; the official Pi 5 case with fan works well
- **Quantization** — always use Q4_K_M or Q4_0 variants; Q8 doubles RAM for minimal quality gain

---

## Capability tags

After `cofounder capabilities advertise`:

```json
{
  "hardware": "pi5",
  "gpu": null,
  "skill_tags": ["embeddings", "summarize", "chat:small"],
  "ollama_models": ["llama3.2:3b", "nomic-embed-text"]
}
```

H1 automatically routes embedding and lightweight summarization tasks here.

---

## See also

- [Hardware overview](/hardware/overview) — compare with other profiles
- [`cofounder capabilities`](/reference/capabilities) — scan and advertise
- [Docker guide](/guide/docker) — containerized H2
