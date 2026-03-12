# Capability Routing

Jerry advertises what it can do — GPU, models, skills. Tom uses that profile to automatically route tasks to the right peer without you specifying it.

---

## How it works

1. **Jerry scans** its hardware and software: `tj capabilities scan`
2. **Jerry advertises** the profile to Tom: `tj capabilities advertise`
3. **Tom caches** the profile: `~/.his-and-hers/peer-capabilities.json`
4. **Tom routes** using `routeTask()`: picks the best peer for each task based on keywords and capability tags

This happens automatically on Jerry startup. You don't need to configure it manually.

---

## What gets scanned

Jerry's capability scanner probes:

| Source | Data collected |
|--------|---------------|
| `nvidia-smi` | GPU name, VRAM, CUDA version |
| `rocm-smi` | AMD GPU info (if present) |
| Metal (macOS) | Apple Silicon info |
| `ollama /api/tags` | Installed model names and sizes |
| Port 8188 | ComfyUI (image generation) |
| Port 7860 | AUTOMATIC1111 / SD WebUI |
| Port 1234 | LM Studio |
| `which whisper` | Whisper CLI for transcription |

---

## Running capability commands

### Scan (probe without saving)

```bash
tj capabilities scan
```

Output:

```
Scanning capabilities...
GPU:    NVIDIA RTX 3070 Ti · 8 GB VRAM · CUDA 12.1
Ollama: running · 3 models
        - llama3.2:3b   (2.0 GB)
        - mistral:7b    (4.1 GB)
        - codellama:7b  (3.8 GB)
ComfyUI: not detected (port 8188)
AUTOMATIC1111: not detected (port 7860)
LM Studio: not detected (port 1234)
Whisper: not found
Skill tags: ollama, gpu-inference
```

### Advertise (scan + save + notify Tom)

```bash
tj capabilities advertise
```

This:
1. Runs the scan
2. Writes `~/.his-and-hers/capabilities.json`
3. POSTs the profile to Tom's `/capabilities` endpoint (Tom caches it)

Run this on Jerry startup (the startup batch script / systemd unit includes it by default).

### Fetch (pull Jerry's profile to Tom)

```bash
# Run on Tom
tj capabilities fetch
# → Fetched capabilities from jerry-home (100.x.y.z)
```

Tom can also fetch the profile via the `/capabilities` endpoint on Jerry's gateway.

### Show (display cached profile)

```bash
# On Jerry: show this node's profile
tj capabilities show

# On Tom: show a peer's cached profile
tj capabilities show --peer jerry-home
```

Output:

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

### Route preview (see where a task would go)

```bash
tj capabilities route "generate a product image"
# → Routing decision: jerry-home (skill: gpu-inference, SDXL capable)

tj capabilities route "summarize this document"
# → Routing decision: jerry-pi (skill: summarize, available, low cost)

tj capabilities route "run 70B inference"
# → Routing decision: jerry-beast (24 GB VRAM, llama3:70b available)
```

---

## Routing logic

`routeTask()` uses a simple priority system:

1. **Explicit `--peer`** — skip routing, use that peer directly
2. **Keyword matching** — task contains "image gen", "SDXL", "Flux" → peer with `image-gen` skill
3. **Model size heuristic** — task mentions "70B" → peer with ≥ 22 GB VRAM
4. **Availability** — prefer online peers over offline (will WOL if needed)
5. **Fallback** — if no peer matches, route to cloud provider

Routing keywords and the skill tags they match:

| Task keywords | Skill tag required |
|--------------|-------------------|
| image, generate image, SDXL, Flux, diffusion | `image-gen` |
| 70B, 34B, large model, heavy inference | `inference:70b` |
| embed, embeddings, vector | `embeddings` |
| transcribe, speech, audio, whisper | `transcription` |
| code, test, refactor, implement | `code` (any peer with code models) |
| summarize, extract, classify | any available peer |

---

## Skill tags

Jerry's skill tags are auto-generated from detected capabilities:

| Tag | When set |
|-----|---------|
| `ollama` | Ollama is running |
| `gpu-inference` | GPU detected (CUDA, ROCm, or Metal) |
| `inference:70b` | GPU VRAM ≥ 22 GB |
| `image-gen` | ComfyUI or AUTOMATIC1111 detected |
| `embeddings` | `nomic-embed-text` or similar in Ollama |
| `transcription` | Whisper binary found |
| `code` | Any code model in Ollama (codellama, qwen-coder, etc.) |
| `vision` | llava or similar multimodal model installed |
| `chat:small` | 3B or smaller model available (Pi/lightweight) |

### Adding custom tags

```bash
tj capabilities advertise --tags "my-custom-skill,finetune"
# → Appended to skill_tags in capabilities.json
```

Or edit `~/.his-and-hers/capabilities.json` directly and re-advertise.

---

## Auto-refresh

Jerry's capabilities auto-refresh on startup. To manually refresh when you install a new model:

```bash
# On Jerry — after pulling a new model
ollama pull llava:13b
tj capabilities advertise
# → Tom now knows about llava:13b and will route vision tasks here
```

---

## Multiple Jerrys

With multiple peers, Tom picks the best available:

```bash
$ tj capabilities route "generate an image"
→ Checking peers...
  jerry-home (RTX 3070 Ti, ComfyUI): ✓ online, image-gen
  jerry-beast (RTX 4090, ComfyUI):   ✗ offline (WOL configured)
  jerry-pi (Pi 5, no GPU):           ✓ online, no image-gen

→ Routing to: jerry-home
  Reason: online + image-gen skill
```

See [Multi-H2](/guide/multi-h2) for more.
