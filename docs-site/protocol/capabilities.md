---
title: HHCapabilityReport Schema
description: How H2 nodes advertise their hardware and skills to H1.
---

# HHCapabilityReport Schema

`HHCapabilityReport` describes a H2 node's hardware, installed models, and
capability tags. H1 caches this report to make routing decisions without
needing to interrogate H2 on every task.

---

## TypeScript interface

```typescript
interface HHCapabilityReport {
  version: string;              // Schema version (semver)
  node: string;                 // Node name
  role: "h2";                // Always "jerry" — H1 doesn't advertise capabilities
  hardware: string | null;      // Hardware profile identifier (e.g. "rtx-4090")
  os: string;                   // "linux" | "win32" | "darwin"
  gpu: TJGpuInfo | null;        // GPU details, or null if CPU-only
  ollama_running: boolean;      // Whether Ollama is running
  ollama_models: TJOllamaModel[];  // Installed Ollama models
  services: TJServices;         // Detected services (ComfyUI, A1111, etc.)
  skill_tags: string[];         // Capability tags for routing
  custom_notes: string | null;  // Free-form notes (from --notes flag)
  timestamp: string;            // ISO 8601 datetime of last scan
}

interface TJGpuInfo {
  name: string;          // e.g. "NVIDIA GeForce RTX 4090"
  vram_gb: number;       // VRAM in gigabytes
  backend: "cuda" | "rocm" | "metal" | "cpu";
  cuda_version?: string; // e.g. "12.3" (CUDA only)
}

interface TJOllamaModel {
  name: string;       // e.g. "llama3:70b-instruct-q4_0"
  size_gb: number;    // Model size on disk in GB
}

interface TJServices {
  comfyui: boolean;   // ComfyUI detected on port 8188
  a1111: boolean;     // AUTOMATIC1111 detected on port 7860
  lmstudio: boolean;  // LM Studio detected on port 1234
  whisper: boolean;   // Whisper binary found in PATH
}
```

---

## Fields

### Root level

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `string` | ✓ | Schema version, e.g. `"0.1.0"` |
| `node` | `string` | ✓ | Node name (from `hh.json`) |
| `role` | `"jerry"` | ✓ | Always `"jerry"` |
| `hardware` | `string \| null` | – | Profile ID: `"pi5"`, `"rtx-3070-ti"`, `"rtx-4090"`, `"m2-mac"`, or `null` |
| `os` | `string` | ✓ | OS platform: `"linux"`, `"win32"`, `"darwin"` |
| `gpu` | `TJGpuInfo \| null` | – | GPU details from `nvidia-smi` / `rocm-smi` / Metal probe |
| `ollama_running` | `boolean` | ✓ | Whether Ollama is reachable at `localhost:11434` |
| `ollama_models` | `TJOllamaModel[]` | ✓ | Models returned by `GET /api/tags` |
| `services` | `TJServices` | ✓ | Detected inference services |
| `skill_tags` | `string[]` | ✓ | Tags H1 uses for routing decisions |
| `custom_notes` | `string \| null` | – | Free-form notes from `hh capabilities advertise --notes` |
| `timestamp` | `string` | ✓ | ISO 8601 datetime of last capability scan |

### TJGpuInfo

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | ✓ | GPU model name |
| `vram_gb` | `number` | ✓ | VRAM in GB |
| `backend` | `string` | ✓ | Inference backend: `"cuda"`, `"rocm"`, `"metal"`, `"cpu"` |
| `cuda_version` | `string` | – | CUDA version (NVIDIA only) |

---

## Built-in skill tags

The capability scanner automatically assigns skill tags based on detected hardware and models:

| Tag | Assigned when |
|-----|--------------|
| `ollama` | Ollama is running |
| `gpu-inference` | A GPU is detected with a CUDA/Metal/ROCm backend |
| `inference:70b` | Ollama has a model with ≥ 30B parameters loaded |
| `image-gen` | ComfyUI or AUTOMATIC1111 is detected |
| `vision` | An Ollama model with vision capability is found (e.g. `llava`) |
| `embeddings` | `nomic-embed-text` or similar embedding model is installed |
| `transcription` | Whisper binary found in PATH |
| `code` | A code-specialized model is installed (e.g. `codellama`, `qwen2.5-coder`) |
| `summarize` | Any model is running (sufficient for summarization tasks) |
| `chat:small` | Only 3B or smaller models detected |

Custom tags can be added with `hh capabilities advertise --tags "finetune,custom-skill"`.

---

## Full example — RTX 4090 node

```json
{
  "version": "0.1.0",
  "node": "h2-beast",
  "role": "jerry",
  "hardware": "rtx-4090",
  "os": "linux",
  "gpu": {
    "name": "NVIDIA GeForce RTX 4090",
    "vram_gb": 24,
    "backend": "cuda",
    "cuda_version": "12.3"
  },
  "ollama_running": true,
  "ollama_models": [
    { "name": "llama3:70b-instruct-q4_0", "size_gb": 39.0 },
    { "name": "qwen2.5-coder:32b", "size_gb": 20.0 },
    { "name": "nomic-embed-text", "size_gb": 0.3 },
    { "name": "llava:13b", "size_gb": 8.0 }
  ],
  "services": {
    "comfyui": true,
    "a1111": false,
    "lmstudio": false,
    "whisper": true
  },
  "skill_tags": ["ollama", "gpu-inference", "inference:70b", "image-gen", "vision", "embeddings", "transcription", "code"],
  "custom_notes": null,
  "timestamp": "2026-03-12T10:00:00.000Z"
}
```

---

## Full example — Raspberry Pi 5

```json
{
  "version": "0.1.0",
  "node": "h2-pi",
  "role": "jerry",
  "hardware": "pi5",
  "os": "linux",
  "gpu": null,
  "ollama_running": true,
  "ollama_models": [
    { "name": "llama3.2:3b", "size_gb": 2.0 },
    { "name": "nomic-embed-text", "size_gb": 0.3 }
  ],
  "services": {
    "comfyui": false,
    "a1111": false,
    "lmstudio": false,
    "whisper": false
  },
  "skill_tags": ["ollama", "embeddings", "summarize", "chat:small"],
  "custom_notes": null,
  "timestamp": "2026-03-12T10:00:00.000Z"
}
```

---

## Storage locations

| Location | Description |
|----------|-------------|
| `~/.his-and-hers/capabilities.json` | H2's own capability report (written by `hh capabilities advertise`) |
| `~/.his-and-hers/peer-capabilities-<name>.json` | H1's cached copy of a peer's report (written by `hh capabilities fetch`) |

---

## See also

- [`hh capabilities`](/reference/capabilities) — CLI commands: scan, advertise, fetch, route
- [Protocol overview](/protocol/overview) — where capability reports fit in the message flow
- [Hardware overview](/hardware/overview) — hardware profiles and capability tag reference
