# `hh capabilities` — Reference

Scan, advertise, fetch, show, and route via the capability registry.

---

## Synopsis

```bash
hh capabilities <subcommand> [flags]
```

---

## Subcommands

### `hh capabilities scan`

Probe local hardware and software without saving or advertising.

```bash
hh capabilities scan
```

Output:

```
Scanning capabilities...
GPU:           NVIDIA RTX 3070 Ti · 8 GB VRAM · CUDA 12.1
Ollama:        running · 3 models
               - llama3.2:3b   (2.0 GB)
               - mistral:7b    (4.1 GB)
               - codellama:7b  (3.8 GB)
ComfyUI:       not detected (port 8188)
AUTOMATIC1111: not detected (port 7860)
LM Studio:     not detected (port 1234)
Whisper:       not found
Skill tags:    ollama, gpu-inference
```

---

### `hh capabilities advertise`

Scan, save to disk, and push the profile to H1.

```bash
hh capabilities advertise
hh capabilities advertise --tags "finetune,custom-skill"
```

| Flag | Description |
|------|-------------|
| `--tags <csv>` | Append custom skill tags |
| `--notes <text>` | Free-form notes (e.g. "SDXL via ComfyUI, Metal backend") |
| `--json` | Output the advertised profile as JSON |

What it does:

1. Runs `scan`
2. Writes `~/.his-and-hers/capabilities.json`
3. POSTs the profile to H1's gateway (if H1 is reachable)

Run this on H2 startup. The startup script / systemd unit includes it by default.

---

### `hh capabilities fetch`

Pull a peer's capability profile to H1. Run on H1.

```bash
hh capabilities fetch
hh capabilities fetch --peer h2-beast
```

| Flag | Description |
|------|-------------|
| `--peer <name>` | Fetch from a specific peer (default: all peers) |
| `--json` | Output fetched profile as JSON |

Saves to `~/.his-and-hers/peer-capabilities-<peer>.json`.

---

### `hh capabilities show`

Display the cached capability profile.

```bash
# On H2: show this node's profile
hh capabilities show

# On H1: show a peer's cached profile
hh capabilities show --peer h2-home
hh capabilities show --peer h2-home --json
```

Output:

```
🖥  GLaDOS (jerry) — Windows
GPU:    NVIDIA RTX 3070 Ti · 8 GB VRAM · CUDA 12.1
Ollama: running · 3 models (llama3.2:3b, mistral:7b, codellama:7b)
Skills: ollama, gpu-inference
Updated: 2m ago
```

JSON output:

```json
{
  "node": "GLaDOS",
  "role": "jerry",
  "hardware": "rtx-3070-ti",
  "gpu": {
    "name": "NVIDIA GeForce RTX 3070 Ti",
    "vram_gb": 8,
    "backend": "cuda",
    "cuda_version": "12.1"
  },
  "ollama_running": true,
  "ollama_models": ["llama3.2:3b", "mistral:7b", "codellama:7b"],
  "skill_tags": ["ollama", "gpu-inference"],
  "comfyui": false,
  "a1111": false,
  "lmstudio": false,
  "whisper": false,
  "timestamp": "2026-03-12T09:15:00Z"
}
```

---

### `hh capabilities route`

Preview where a task would be routed without actually sending it.

```bash
hh capabilities route "generate a product image"
hh capabilities route "summarize this document"
hh capabilities route "run 70B inference on this paper"
```

Output:

```
Routing: "generate a product image"
──────────────────────────────────────────
Keyword match:  "image" → skill: image-gen
Candidates:
  h2-home   ✓ online   image-gen: no   gpu: RTX 3070 Ti
  h2-beast  ✗ offline  image-gen: yes  gpu: RTX 4090
  h2-pi     ✓ online   image-gen: no   gpu: none

Decision: h2-beast (offline — WOL will be sent)
Reason: only peer with image-gen skill
```

| Flag | Description |
|------|-------------|
| `--json` | JSON routing decision output |

---

## Capability file format

`~/.his-and-hers/capabilities.json` (H2 side):

```json
{
  "version": "0.1.0",
  "node": "GLaDOS",
  "role": "jerry",
  "hardware": "rtx-3070-ti",
  "os": "win32",
  "gpu": {
    "name": "NVIDIA GeForce RTX 3070 Ti",
    "vram_gb": 8,
    "backend": "cuda",
    "cuda_version": "12.1"
  },
  "ollama_running": true,
  "ollama_models": [
    { "name": "llama3.2:3b", "size_gb": 2.0 },
    { "name": "mistral:7b", "size_gb": 4.1 },
    { "name": "codellama:7b", "size_gb": 3.8 }
  ],
  "services": {
    "comfyui": false,
    "a1111": false,
    "lmstudio": false,
    "whisper": false
  },
  "skill_tags": ["ollama", "gpu-inference"],
  "custom_notes": null,
  "timestamp": "2026-03-12T09:15:00Z"
}
```

---

## See also

- [Capability routing guide](/guide/capabilities) — routing logic, skill tags, keyword matching
- [Multi-H2](/guide/multi-h2) — routing across multiple peers
- [Protocol: HHCapabilityReport](/protocol/capabilities) — schema specification
