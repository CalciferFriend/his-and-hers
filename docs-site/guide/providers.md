# LLM Providers

his-and-hers works with any LLM provider that OpenClaw supports. H1 typically uses a cloud provider for lightweight orchestration; H2 typically uses a local provider for heavy inference.

---

## Provider overview

| Provider | Best for | Cost | Requires |
|----------|---------|------|---------|
| **Anthropic** | H1 orchestration, complex reasoning | Cloud pricing | API key |
| **OpenAI** | H1 orchestration, GPT-4o tasks | Cloud pricing | API key |
| **Ollama** | H2 local inference, all model sizes | Free | GPU or CPU |
| **LM Studio** | H2, GUI-first local inference | Free | GUI app running |
| **Custom (OpenAI-compatible)** | Self-hosted servers, vLLM, llama.cpp | Varies | Custom URL + key |

---

## Anthropic

Used by H1 for orchestration and delegation. Claude Sonnet is the default — fast, cheap, and smart enough to break down tasks and route them to H2.

### Setup

During `hh onboard`, select **Anthropic** as your provider. The wizard prompts for your API key and stores it in the OS keychain (not plaintext).

Manual config update:

```bash
hh onboard --reconfigure-provider
# Or edit ~/.his-and-hers/hh.json directly
```

### Cost routing

By default, his-and-hers routes lightweight tasks (summarization, task planning, short text) to Claude Haiku (cheapest) and complex reasoning to Claude Sonnet. 70B+ inference goes to H2.

```json
{
  "provider": "anthropic",
  "cost_routing": {
    "lightweight": "claude-haiku-3-5",
    "standard": "claude-sonnet-4-5",
    "heavy": "jerry"
  }
}
```

### Models

| Model | Speed | Cost (per 1M tokens in/out) |
|-------|-------|-----------------------------|
| `claude-haiku-3-5` | ⚡ Fastest | ~$0.80 / $4.00 |
| `claude-sonnet-4-5` | ✓ Fast | ~$3.00 / $15.00 |
| `claude-opus-4` | Slower | ~$15.00 / $75.00 |

---

## OpenAI

### Setup

Select **OpenAI** during `hh onboard`. Your API key goes to the OS keychain.

### Models

| Model | Notes |
|-------|-------|
| `gpt-4o` | Fast, capable, good default |
| `gpt-4o-mini` | Cheaper, good for routing tasks |
| `o3-mini` | Strong reasoning, slower |

```json
{
  "provider": "openai",
  "model": "gpt-4o",
  "cost_routing": {
    "lightweight": "gpt-4o-mini",
    "standard": "gpt-4o",
    "heavy": "jerry"
  }
}
```

---

## Ollama

The default for H2 nodes. Runs models locally — zero API cost, full privacy.

### Install

```bash
# Linux / macOS
curl -fsSL https://ollama.com/install.sh | sh

# Windows
winget install Ollama.Ollama
# Or: https://ollama.com/download/OllamaSetup.exe
```

### Auto-detection

his-and-hers checks `http://localhost:11434/api/tags` on startup. If Ollama is running, it's auto-detected and you'll see your installed models listed during `hh onboard`.

```bash
# Verify Ollama is running
ollama list
# → shows installed models

# Check that hh can see it
hh capabilities scan
# → "Ollama: running · 3 models"
```

### Model recommendations

| Use case | Model | Pull command |
|----------|-------|-------------|
| General chat | Llama 3.2 3B | `ollama pull llama3.2` |
| Quality chat | Mistral 7B | `ollama pull mistral` |
| Code generation | Qwen 2.5 Coder 7B | `ollama pull qwen2.5-coder:7b` |
| Large context / 70B | Llama 3 70B (Q4) | `ollama pull llama3:70b-instruct-q4_0` |
| Embeddings | Nomic Embed | `ollama pull nomic-embed-text` |
| Vision tasks | LLaVA 7B | `ollama pull llava:7b` |

### Ollama config in hh.json

```json
{
  "provider": "ollama",
  "ollama_base_url": "http://localhost:11434",
  "model": "mistral"
}
```

### Using Ollama on a remote machine

If H2's Ollama is on a different machine from the gateway:

```json
{
  "ollama_base_url": "http://192.168.1.50:11434"
}
```

Make sure Ollama is bound to `0.0.0.0`, not just localhost:

```bash
OLLAMA_HOST=0.0.0.0 ollama serve
# Or: set OLLAMA_HOST=0.0.0.0 in Ollama's systemd unit/launchd plist
```

---

## LM Studio

LM Studio provides an OpenAI-compatible API on `localhost:1234` when the server is running.

### Setup

1. Install [LM Studio](https://lmstudio.ai)
2. Load a model and start the local server (gear icon → enable API)
3. In `hh onboard`, select **LM Studio** (or **Custom**)

```json
{
  "provider": "lmstudio",
  "lmstudio_base_url": "http://localhost:1234/v1",
  "model": "local-model"
}
```

LM Studio must be running with the server active for H2 to use it. It doesn't auto-start on boot without extra configuration.

---

## Custom (OpenAI-compatible)

For vLLM, llama.cpp server, Oobabooga, or any OpenAI-compatible endpoint:

```json
{
  "provider": "custom",
  "custom_base_url": "http://localhost:8000/v1",
  "custom_api_key": "optional-key",
  "model": "your-model-id"
}
```

Examples:

```bash
# vLLM server
python -m vllm.entrypoints.openai.api_server \
  --model meta-llama/Llama-3.2-3B-Instruct \
  --port 8000

# llama.cpp server
./server -m models/llama-3.2-3b.gguf -c 4096 --port 8080
```

During `hh onboard`, select **Custom OpenAI-compatible** and enter your base URL.

---

## Multiple providers (cost routing)

H1 can use different providers depending on task cost and routing policy:

```json
{
  "cost_routing": {
    "lightweight_threshold_tokens": 1000,
    "lightweight_provider": "anthropic",
    "lightweight_model": "claude-haiku-3-5",
    "standard_provider": "anthropic",
    "standard_model": "claude-sonnet-4-5",
    "heavy_route": "jerry"
  }
}
```

See [Budget tracking](/guide/budget) for cost analysis and routing recommendations.

---

## Updating your provider

```bash
# Reconfigure just the provider, keep everything else
hh onboard --reconfigure-provider

# Or set the API key directly
openclaw config set anthropic_api_key sk-ant-...
```

Your current API key usage is visible in `hh budget`.
