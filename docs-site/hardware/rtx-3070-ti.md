---
title: RTX 3070 Ti (Windows 11)
description: Set up a H2 node on an NVIDIA RTX 3070 Ti Windows PC — the reference implementation.
---

# H2 Profile — RTX 3070 Ti (Windows 11)

The reference implementation hardware. This is what GLaDOS runs.

---

## Hardware

| | |
|---|---|
| GPU | NVIDIA GeForce RTX 3070 Ti |
| VRAM | 8 GB GDDR6X |
| CUDA cores | 6144 |
| OS | Windows 11 Pro |
| RAM | 16+ GB recommended |

---

## What it can run

| Model | VRAM needed | Speed |
|-------|-------------|-------|
| Llama 3.2 3B | ~2.5 GB | ⚡ Very fast |
| Mistral 7B | ~4 GB | ⚡ Fast |
| Llama 3.1 8B | ~5 GB | ✓ Good |
| Codellama 13B (Q4) | ~7.5 GB | ✓ OK |
| SDXL (image gen) | ~6 GB | ✓ ~12s/img |
| Whisper large-v3 | ~3 GB | ⚡ Fast |

> **8 GB sweet spot:** Most 7–8B models run at full speed. 13B works with Q4 quantization.
> 70B will CPU-offload and be slow.

---

## Setup

### 1. Prerequisites

```powershell
# Install latest NVIDIA driver (>= 525.85 required for Ollama CUDA)
# https://www.nvidia.com/drivers

# Install CUDA toolkit (optional — Ollama bundles its own runtime)
winget install Nvidia.CUDAToolkit
```

### 2. Install Ollama

```powershell
winget install Ollama.Ollama
# Or: https://ollama.com/download/OllamaSetup.exe

# Verify GPU detection
ollama run llama3.2
# Should show: loaded model, GPU layers = N (all on GPU)
```

### 3. Download recommended models

```powershell
ollama pull llama3.2           # 3B — very fast
ollama pull mistral            # 7B — great quality/speed
ollama pull codellama          # code tasks
ollama pull llava:7b           # vision tasks
```

### 4. Install OpenClaw + his-and-hers

```powershell
winget install OpenJS.NodeJS.LTS
npm install -g openclaw
npm install -g his-and-hers

hh onboard
# → Select role: H2
# → Provider: Ollama (auto-detected)
```

### 5. Advertise capabilities

```powershell
hh capabilities advertise
hh capabilities show
```

Expected output:
```
🖥  GLaDOS (jerry) — Windows
GPU:    NVIDIA RTX 3070 Ti · 8 GB VRAM · CUDA
Ollama: running · 3 models
Skills: ollama, gpu-inference
```

### 6. Add to startup

**Option A — Scheduled Task (recommended, created by `hh onboard` automatically):**

```powershell
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c start-gateway.bat"
$trigger = New-ScheduledTaskTrigger -AtLogon
Register-ScheduledTask -TaskName "OpenClaw Gateway" -Action $action -Trigger $trigger -RunLevel Highest
```

**Option B — Startup folder:**

Create `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\start-gateway.bat`:

```bat
@echo off
:wait_ts
tailscale status >nul 2>&1 || (timeout /t 5 /nobreak >nul && goto wait_ts)
start /B openclaw gateway start
```

### 7. Enable Wake-on-LAN (recommended)

Lets H1 wake your PC when needed — saves significant power when idle.

1. **BIOS:** Enable "Wake on LAN" / "Power On By PCI-E" (varies by board)
2. **NIC:** Device Manager → Network Adapters → your NIC → Properties → Power Management → enable all WOL checkboxes
3. **Router:** Set a static DHCP lease for your PC's MAC

Find your MAC:
```powershell
Get-NetAdapter | Select Name, MacAddress
```

Add to H1's config:
```json
{
  "this_node": {
    "wol": {
      "enabled": true,
      "mac": "D8:5E:D3:04:18:B4",
      "broadcast_ip": "YOUR_ROUTER_BROADCAST_IP",
      "router_port": 9
    }
  }
}
```

---

## Recommended models for this GPU

```powershell
# Best perf/quality at 8 GB VRAM:
ollama pull llama3.2:3b              # fastest — sub-second responses
ollama pull mistral:7b-instruct      # best 7B quality
ollama pull llava:7b                 # vision + language
ollama pull codellama:7b-instruct    # coding

# Image generation (separate from Ollama):
# Install ComfyUI with SDXL for best 8 GB image gen
```

---

## Troubleshooting

**Ollama not using GPU:**
```powershell
# Check NVIDIA driver version
nvidia-smi
# Must be >= 525.85

# Verbose GPU detection
ollama run llama3.2 --verbose
# Look for: "using CUDA" and "GPU layers = N"
```

**Out of VRAM:**
Use a smaller quantization: `ollama pull mistral:7b-instruct-q4_0`

**Gateway not starting on boot:**
Check Windows Event Viewer → Application for errors. Ensure Tailscale is in startup apps.

---

## See also

- [Hardware overview](/hardware/overview) — compare with other profiles
- [`hh capabilities`](/reference/capabilities) — scan, advertise, fetch
- [WOL guide](/guide/wol) — Wake-on-LAN setup and troubleshooting
