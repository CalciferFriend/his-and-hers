# Jerry Profile — NVIDIA RTX 3070 Ti (Windows 11)

The reference implementation hardware. This is what GLaDOS runs.

## Specs

| | |
|---|---|
| GPU | NVIDIA GeForce RTX 3070 Ti |
| VRAM | 8 GB GDDR6X |
| CUDA cores | 6144 |
| OS | Windows 11 Pro |
| RAM | 16+ GB recommended |

## What it can run

| Model | VRAM needed | Speed |
|-------|-------------|-------|
| Llama 3.2 3B | ~2.5 GB | ⚡ Very fast |
| Mistral 7B | ~4 GB | ⚡ Fast |
| Llama 3.1 8B | ~5 GB | ✓ Good |
| Codellama 13B (Q4) | ~7.5 GB | ✓ OK |
| SDXL (image gen) | ~6 GB | ✓ ~12s/img |
| Whisper large-v3 | ~3 GB | ⚡ Fast |

> **8 GB sweet spot:** You can run most 7–8B models comfortably at full speed.
> 13B models work with Q4 quantization. 70B will be CPU-offloaded and slow.

## Setup

### 1. Prerequisites

```powershell
# Install Chocolatey (if not already)
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# Install CUDA toolkit (if not already — required for Ollama CUDA backend)
# Or just install latest NVIDIA driver from https://www.nvidia.com/drivers
# Ollama bundles its own CUDA runtime — driver >= 525.85 required
winget install Nvidia.CUDAToolkit
```

### 2. Install Ollama

```powershell
winget install Ollama.Ollama
# Or: https://ollama.com/download/OllamaSetup.exe
```

Ollama auto-detects the RTX 3070 Ti and uses CUDA. Verify:

```powershell
ollama run llama3.2
# Should show: loaded model, GPU layers = N (all on GPU)
```

### 3. Download recommended models

```powershell
# General purpose
ollama pull llama3.2          # 3B, very fast
ollama pull mistral            # 7B, great quality/speed
ollama pull codellama          # code tasks

# Image generation (ComfyUI — optional)
# See: https://github.com/comfyanonymous/ComfyUI

# Audio transcription
ollama pull whisper            # or install standalone whisper
```

### 4. Install OpenClaw + his-and-hers

```powershell
# Install Node.js 22+
winget install OpenJS.NodeJS.LTS

# Install OpenClaw
npm install -g openclaw

# Install his-and-hers
npm install -g his-and-hers

# Run setup wizard
tj onboard
# → Select role: Jerry
# → Provider: Ollama (auto-detected)
```

### 5. Advertise capabilities

```powershell
# Scan and save capabilities so Tom can route intelligently
tj capabilities advertise

# Verify
tj capabilities show
```

Expected output:
```
🖥  GLaDOS (jerry) — Windows
GPU:    NVIDIA RTX 3070 Ti · 8 GB VRAM · CUDA
Ollama: running · 3 models
Skills: ollama, gpu-inference
```

### 6. Add to startup

**Option A — Scheduled Task (recommended):**

```powershell
# tj onboard creates this automatically, but manual fallback:
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

### 7. Enable WOL (optional but recommended)

Lets Tom wake your PC when needed — saves power when idle.

1. **BIOS:** Enable "Wake on LAN" / "Power On By PCI-E" (varies by board)
2. **NIC:** Device Manager → Network Adapters → your NIC → Properties → Power Management → enable all WOL checkboxes
3. **Router:** Set a static DHCP lease for your PC's MAC, then forward UDP port 9 to broadcast (255.255.255.255)

Find your MAC:
```powershell
Get-NetAdapter | Select Name, MacAddress
```

Tell Tom about it during `tj onboard`, or update config:
```json
{
  "this_node": {
    "wol": { "enabled": true, "mac": "D8:5E:D3:04:18:B4", "broadcast_ip": "YOUR_ROUTER_IP", "router_port": 9 }
  }
}
```

## Recommended Ollama models for this GPU

```powershell
# Best perf/quality at 8 GB VRAM:
ollama pull llama3.2:3b        # fastest — sub-second responses
ollama pull mistral:7b-instruct # best 7B quality
ollama pull llava:7b           # vision + language (image understanding)
ollama pull codellama:7b-instruct # coding

# Image generation (separate from Ollama):
# → Install ComfyUI with SDXL weights for best 8 GB image gen
```

## Troubleshooting

**Ollama not using GPU:**
```powershell
# Check NVIDIA driver version
nvidia-smi
# Must be >= 525.85. Update at https://www.nvidia.com/drivers

# Check Ollama GPU detection
ollama run llama3.2 --verbose
# Look for: "using CUDA" and "GPU layers = N"
```

**Out of VRAM errors:**
Use a smaller quantization: `ollama pull mistral:7b-instruct-q4_0` instead of the default q4_k_m.

**Gateway not starting on boot:**
Check Windows Event Viewer → Application for errors. Also: ensure Tailscale is in startup apps.
