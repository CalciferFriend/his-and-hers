# Prerequisites

What you need before running `cofounder onboard`.

---

## Both machines (H1 and H2)

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Node.js** | ≥ 22 | [nodejs.org](https://nodejs.org) — use nvm or fnm to manage versions |
| **Tailscale** | any recent | [tailscale.com/download](https://tailscale.com/download) — both machines must be on the same Tailscale network |
| **OpenClaw** | any | `npm install -g openclaw` |

Both machines must be authenticated to the **same Tailscale account** (or connected via Tailscale's share feature). Run `tailscale status` on each machine and confirm you can see the other.

---

## H1-specific

| Requirement | Notes |
|-------------|-------|
| **SSH client** | Included on macOS/Linux. On Windows: built-in OpenSSH or Git Bash |
| **API key** | For your chosen LLM provider (Anthropic, OpenAI, etc.) |
| **H2's Tailscale IP** | Run `tailscale ip -4` on H2's machine |
| **SSH access to H2** | H1 pushes gateway config via SSH — you'll need a keypair |

### Get H2's Tailscale IP

```bash
# Run this on H2's machine
tailscale ip -4
# → 100.x.y.z
```

### SSH keypair

If you don't have one:

```bash
# Run on H1's machine
ssh-keygen -t ed25519 -C "h1-to-h2"
# Default: ~/.ssh/id_ed25519

# Copy public key to H2
ssh-copy-id -i ~/.ssh/id_ed25519.pub user@h2-tailscale-ip
# On Windows H2: manually add contents of id_ed25519.pub to C:\Users\<user>\.ssh\authorized_keys
```

---

## H2-specific

### Linux / Mac

| Requirement | Notes |
|-------------|-------|
| **Ollama** (recommended) | [ollama.com](https://ollama.com) — local model inference |
| **At least one model pulled** | e.g. `ollama pull llama3.2` |

### Windows

| Requirement | Notes |
|-------------|-------|
| **Ollama for Windows** | [ollama.com/download](https://ollama.com/download) |
| **NVIDIA driver ≥ 525.85** | Required for CUDA backend in Ollama |
| **Administrator PowerShell** | Needed for AutoLogin + Scheduled Task setup during onboarding |
| **WOL-capable NIC** | Most modern NICs support it — verify in Device Manager |

### GPU (recommended but not required)

| GPU | VRAM | What you can run |
|-----|------|-----------------|
| NVIDIA RTX 3070 Ti | 8 GB | 7B–8B models, SDXL images |
| NVIDIA RTX 4090 | 24 GB | 70B models, Flux image gen |
| Apple M2 16 GB | 13 GB effective | 13B models, Metal backend |
| No GPU (CPU only) | — | 3B models, embeddings (slow) |
| Raspberry Pi 5 | — | 3B–7B quantized, embeddings |

H2 works without a GPU — Ollama runs on CPU with quantized models. It's slower but functional.

---

## Network requirements

| Port | Protocol | Direction | Purpose |
|------|----------|-----------|---------|
| 3737 | TCP | H1 → H2 | Gateway API |
| 9 | UDP | H1 → Router | Wake-on-LAN Magic Packet |
| 22 | TCP | H1 → H2 | SSH (config push) |

All traffic between H1 and H2 flows over Tailscale (WireGuard-encrypted). You don't need to open any ports on your home router for the gateway — only for WOL if H2 is on a different subnet.

---

## Verify your setup

Run this checklist before starting `cofounder onboard`:

```bash
# On both machines:
node --version        # must be v22+
tailscale status      # must show both machines
openclaw --version    # must succeed

# On H1:
ssh h2-user@100.x.y.z  # must connect without password prompt

# On H2:
ollama list           # should show at least one model
```

If anything fails, fix it before running `cofounder onboard`. The wizard checks prerequisites but it's faster to fix them manually first.

---

## Quick install (all prereqs)

### macOS / Linux

```bash
# Node 22 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc  # or restart terminal
nvm install 22 && nvm use 22

# Tailscale
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# OpenClaw
npm install -g openclaw

# Ollama (H2 only)
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.2
```

### Windows

```powershell
# Node 22
winget install OpenJS.NodeJS.LTS

# Tailscale
winget install tailscale.tailscale

# OpenClaw
npm install -g openclaw

# Ollama (H2 only)
winget install Ollama.Ollama
ollama pull llama3.2
```
