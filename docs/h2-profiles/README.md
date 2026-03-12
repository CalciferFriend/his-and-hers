# H2 Hardware Profiles

Pre-built setup guides for common H2 (executor) hardware configurations.
Each profile covers Ollama setup, recommended models, and optional extras.

| Profile | Hardware | GPU VRAM | Recommended for |
|---------|----------|----------|-----------------|
| [rtx-3070-ti](./rtx-3070-ti.md) | NVIDIA RTX 3070 Ti (Windows 11) | 8 GB | Image gen, 13B models |
| [m2-mac](./m2-mac.md) | Apple M2/M3 Mac (macOS) | shared 16–96 GB | General inference, code |
| [pi5](./pi5.md) | Raspberry Pi 5 (Linux) | CPU only | Light tasks, embeddings |
| [rtx-4090](./rtx-4090.md) | NVIDIA RTX 4090 (Windows/Linux) | 24 GB | 70B models, video gen |

## Quick pick

**"I want local LLM inference"** → M2 Mac (best perf/watt) or RTX 3070 Ti (CUDA)

**"I want image generation"** → RTX 3070 Ti (8 GB is fine for SDXL) or RTX 4090 (fastest)

**"I want always-on compute at low power"** → Raspberry Pi 5 for lightweight tasks

**"I have a beast machine"** → RTX 4090 — run 70B models, video gen, LoRA fine-tuning
