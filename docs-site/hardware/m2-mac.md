---
title: Apple M2/M3 Mac
description: Set up a H2 node on an Apple Silicon Mac — excellent inference performance with unified memory.
---

# H2 Profile — Apple M2/M3 Mac (macOS)

Apple Silicon Macs are excellent H2 nodes — unified memory means the GPU and
CPU share the same fast RAM pool. An M2 with 16 GB can run 13B models comfortably.
An M3 Max with 128 GB can run 70B+ models.

---

## Specs (common configs)

| Chip | Unified Memory | Effective VRAM | Best for |
|------|---------------|----------------|---------|
| M2 | 8 GB | ~6 GB for models | 7B models |
| M2 | 16 GB | ~13 GB for models | 13B models |
| M2 Pro | 32 GB | ~28 GB | 30B models |
| M3 Max | 128 GB | ~120 GB | 70B+ models |

> Apple's Metal backend in Ollama is mature and fast. M2/M3 performance often
> matches NVIDIA GPUs for inference thanks to the memory bandwidth advantage.

---

## What it can run

| Model | Min Memory | Speed on M2 16GB |
|-------|-----------|-----------------|
| Llama 3.2 3B | 4 GB | ⚡ ~70 tok/s |
| Mistral 7B | 8 GB | ⚡ ~45 tok/s |
| Llama 3.1 8B | 8 GB | ✓ ~40 tok/s |
| Llama 3.1 13B (Q4) | 10 GB | ✓ ~25 tok/s |
| Llama 3.1 70B (Q4) | 48 GB | ❌ needs M2 Pro 64GB+ |
| Whisper large-v3 | 3 GB | ⚡ Fast |

---

## Setup

### 1. Install Ollama

```bash
# Download from https://ollama.com/download/Ollama-darwin.pkg
# Or via Homebrew:
brew install ollama

# Start Ollama
ollama serve &

# Verify Metal GPU detection
ollama run llama3.2
# Should show: loaded on Metal
```

### 2. Download recommended models

```bash
ollama pull llama3.2          # general purpose, fast
ollama pull mistral            # best 7B quality
ollama pull codellama          # coding
ollama pull llava              # vision tasks
```

### 3. Install Node.js + OpenClaw + his-and-hers

```bash
# Install Node.js 22+ via nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 22 && nvm use 22

# Install OpenClaw
npm install -g openclaw

# Install his-and-hers
npm install -g his-and-hers

# Run wizard
hh onboard
# → Role: H2
# → Provider: Ollama (auto-detected)
```

### 4. Install Tailscale

```bash
# https://tailscale.com/download/macos
# Or via Homebrew:
brew install tailscale
tailscale up --authkey tskey-auth-...
```

### 5. Advertise capabilities

```bash
hh capabilities advertise
hh capabilities show
```

Expected output:
```
🖥  My Mac (jerry) — macOS
GPU:    Apple M2 · Metal backend · ~16 GB unified
Ollama: running · 4 models
Skills: ollama, gpu-inference
```

### 6. Start gateway on login

**Option A — launchd plist (recommended):**

```bash
cat > ~/Library/LaunchAgents/com.his-and-hers.gateway.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.his-and-hers.gateway</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/openclaw</string>
    <string>gateway</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/his-and-hers-gateway.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/his-and-hers-gateway.err</string>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.his-and-hers.gateway.plist
```

**Option B — Login Items (macOS 13+):**

System Settings → General → Login Items → add `openclaw` binary.

---

## Image generation on Apple Silicon

```bash
# Option 1: Diffusers + MPS backend (Python)
pip install diffusers transformers accelerate torch

# Option 2: ComfyUI with MPS
git clone https://github.com/comfyanonymous/ComfyUI
cd ComfyUI && pip install -r requirements.txt
python main.py --force-fp16
```

Advertise the image-gen skill once ComfyUI is running:
```bash
hh capabilities advertise --notes "SDXL via ComfyUI, Metal backend"
```

---

## WOL on Mac

Macs support "Wake for network access" but it's less reliable than PC WOL.
Enable in: System Settings → Energy → Options → **Wake for network access**.

For best results: leave Mac in sleep (not shutdown) and ensure Tailscale is
configured to maintain its connection during sleep.

---

## Troubleshooting

**Ollama not using Metal GPU:**
```bash
# Check Metal availability
system_profiler SPDisplaysDataType | grep "Metal"

# Force Metal
OLLAMA_GPU_OVERHEAD=0 ollama run llama3.2
```

**Out of memory:**
```bash
# Reduce context size
ollama run llama3.2 --ctx-size 2048
```

**Gateway not reachable from H1:**
```bash
# Check Tailscale IP
tailscale ip

# Check gateway is running
openclaw gateway status
```

---

## See also

- [Hardware overview](/hardware/overview) — compare with other profiles
- [`hh capabilities`](/reference/capabilities) — scan, advertise, fetch
- [Sending tasks](/guide/sending-tasks) — `hh send` flags and options
