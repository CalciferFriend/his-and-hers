# Latent Communication — Implementation Guide

> *"The information density gap: 40,000 bits in a hidden state vs 15 bits per token"*

## Table of Contents

1. [Overview](#overview)
2. [Why Latent Communication](#why-latent-communication)
3. [How CofounderLatentMessage Works](#how-hhlatentmessage-works)
4. [Two Communication Modes](#two-communication-modes)
5. [Protocol Specification](#protocol-specification)
6. [Implementation Paths](#implementation-paths)
7. [Fallback Mechanism](#fallback-mechanism)
8. [References](#references)

---

## Overview

**Latent communication** is an experimental extension to the cofounder protocol that allows agents to exchange compressed hidden states instead of decoded text tokens. This approach dramatically reduces information loss during agent-to-agent handoffs and improves bandwidth efficiency.

As of 2026-03-12, the protocol design is complete (`CofounderLatentMessage` type added to the discriminated union), but implementation depends on upstream research codebases maturing to production readiness.

**Status:** Research preview. Protocol ready, codec implementations in progress.

---

## Why Latent Communication

### The Information Density Gap

When H1 sends a task to H2 using text tokens, it goes through this pipeline:

```
H1's internal state (hidden layers)
  ↓ decode to tokens
Text prompt (15 bits of information per token)
  ↓ encode to hidden state
H2's internal state (hidden layers)
```

Every decode-then-encode cycle loses information. A typical transformer hidden state contains **40,000+ bits per position** (e.g., 2048-dim float32 vector). A decoded token carries roughly **15 bits** (log₂(vocab_size)). That's a **2,666× compression**.

For tasks requiring:
- **Structured reasoning** (multi-step math, code generation, logical deduction)
- **Precise state handoff** (mid-inference continuation across agents)
- **High-bandwidth collaboration** (streaming partial results, iterative refinement)

...the text bottleneck becomes measurably costly in both **latency** and **accuracy**.

### Research Evidence

| Paper | Key Result | Impact |
|-------|-----------|--------|
| **Interlat** (arXiv:2511.09149) | 24× faster inference via latent handoff across heterogeneous models | Heterogeneous agent coordination |
| **LatentMAS** (arXiv:2511.20639) | 80% fewer tokens, higher accuracy on reasoning tasks via KV cache sharing | Same-family agent optimization |
| **Vision Wormhole** (arXiv:2602.15382) | Training-free latent compression via visual encoder pathway | Cross-architecture compatibility |

None of these papers ship a production transport layer. **That's the gap cofounder fills.**

---

## How CofounderLatentMessage Works

`CofounderLatentMessage` is a new variant in the `CofounderMessage` discriminated union. Instead of carrying a text prompt, it carries:

1. **Compressed hidden states** (via Vision Wormhole codec)
2. **KV cache snapshots** (via LatentMAS, for same-family models)
3. **Text fallback** (mandatory, for nodes that don't support latent)

### High-Level Flow

```
┌─────────────┐                                    ┌─────────────┐
│   H1       │                                    │   H2     │
│  (sender)   │                                    │  (receiver) │
└──────┬──────┘                                    └──────┬──────┘
       │                                                  │
       │ 1. Run first N layers of inference               │
       │    Extract hidden state [tokens × 2048]          │
       │                                                  │
       │ 2. Compress via Vision Wormhole codec            │
       │    [tokens × 2048] → [tokens × 512]              │
       │    Serialize to base64                           │
       │                                                  │
       │ 3. Build CofounderLatentMessage                         │
       │    - compressed_latent: base64 string            │
       │    - fallback_text: "Generate report on X"       │
       │                                                  │
       │────────────── CofounderLatentMessage ──────────────────▶│
       │                                                  │
       │                                                  │ 4. Check codec compatibility
       │                                                  │    If supported: inject latent
       │                                                  │    Else: use fallback_text
       │                                                  │
       │                                                  │ 5. Continue inference from
       │                                                  │    injected hidden state
       │                                                  │
       │◀────────────── CofounderResultMessage ──────────────────│
       │                                                  │
```

---

## Two Communication Modes

### Mode 1: Vision Wormhole (Heterogeneous Models)

**Use case:** H1 runs `claude-sonnet-4.5`, H2 runs `Qwen3-VL-70B`. Different architectures, different hidden dimensions.

**Approach:**
- Train a lightweight **Visual Codec** that compresses H1's hidden state into a format H2's visual encoder can parse
- H1: extract hidden state → compress via codec → serialize to base64
- H2: deserialize → inject via visual encoder pathway → continue inference

**Key properties:**
- Works across **any model pair** (as long as receiver has a visual encoder)
- Requires **one-time codec training** per sender model
- Codec is small (~100MB) and fast (~5ms compression latency)

**Reference:** Vision Wormhole (arXiv:2602.15382)

---

### Mode 2: LatentMAS (Same-Family Models)

**Use case:** Both H1 and H2 run `llama-3.1-70b`. Identical architecture, identical weights.

**Approach:**
- H1: extract **KV cache** at layer N → serialize to base64
- H2: deserialize → inject KV cache → continue from layer N+1

**Key properties:**
- **Training-free** — works with existing checkpoint weights
- **Zero information loss** — exact state transfer
- Requires **exact model match** (same family, same version)

**Reference:** LatentMAS (arXiv:2511.20639)

---

## Protocol Specification

### CofounderLatentPayload Schema

```typescript
{
  // Required: task metadata
  task_id: string (UUID),
  sender_model: string,          // e.g., "Qwen3-VL-2B-Thinking"
  sender_hidden_dim: number,     // e.g., 2048

  // Vision Wormhole path (heterogeneous models)
  codec_version?: string,        // e.g., "vw-qwen3vl2b-v1"
  codec_output_dim: number,      // e.g., 512 (compressed dimension)
  codec_tokens: number,          // e.g., 8 (number of latent tokens)
  compressed_latent?: string,    // base64-encoded float16 [tokens × output_dim]

  // LatentMAS path (same-family models)
  kv_model?: string,             // e.g., "llama-3.1-70b" (must match receiver)
  kv_cache?: string,             // base64-encoded KV cache snapshot

  // Mandatory fallback
  fallback_text: string,         // plain text prompt (always required)
  fallback_required?: boolean,   // if true, receiver MUST use text fallback

  // Optional metadata
  compression_ratio?: number     // raw_size / compressed_size
}
```

### Example: Vision Wormhole Message

```typescript
import { createLatentMessage } from "@cofounder/core";

const msg = createLatentMessage("Calcifer", "GLaDOS", {
  task_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  sender_model: "claude-sonnet-4.5",
  sender_hidden_dim: 4096,
  codec_version: "vw-claude4.5-v1",
  codec_output_dim: 512,
  codec_tokens: 16,
  compressed_latent: "SGVsbG8gd29ybGQ=", // base64-encoded tensor
  fallback_text: "Generate a detailed report on renewable energy trends in 2026",
  compression_ratio: 8.0,
});
```

### Example: LatentMAS Message

```typescript
const msg = createLatentMessage("Calcifer", "GLaDOS", {
  task_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  sender_model: "llama-3.1-70b",
  sender_hidden_dim: 8192,
  kv_model: "llama-3.1-70b",
  kv_cache: "a3ZfY2FjaGVfYmFzZTY0X2RhdGE=", // base64-encoded KV cache
  codec_output_dim: 0, // not using codec
  codec_tokens: 0,
  fallback_text: "Continue reasoning from previous context",
  fallback_required: false,
});
```

---

## Implementation Paths

### Path A: Vision Wormhole (Recommended for Heterogeneous Setups)

**Prerequisites:**
1. H1 must have a trained Visual Codec for its model family
2. H2 must have a vision-capable model (e.g., Qwen3-VL, LLaVA, GPT-4V)

**Steps:**

#### 1. H1 Side: Extract and Compress

```typescript
// Hook into OpenClaw gateway inference
async function extractHiddenState(prompt: string, layers: number = 12): Promise<Float32Array> {
  // This requires middleware in OpenClaw to pause inference at layer N
  // and expose the hidden state tensor
  const hiddenState = await openclawGateway.extractHiddenAt(prompt, layers);
  return hiddenState; // [tokens × hidden_dim]
}

async function compressViaCodec(hiddenState: Float32Array, codecVersion: string): Promise<Float32Array> {
  // Load codec model (small ~100MB ONNX model)
  const codec = await loadCodec(codecVersion);
  const compressed = codec.compress(hiddenState); // [tokens × codec_output_dim]
  return compressed;
}

// Main latent send flow
const hiddenState = await extractHiddenState(taskPrompt, 12);
const compressed = await compressViaCodec(hiddenState, "vw-claude4.5-v1");
const encoded = serializeLatent(compressed, tokens, codecOutputDim);

const msg = createLatentMessage("Calcifer", "GLaDOS", {
  task_id: randomUUID(),
  sender_model: "claude-sonnet-4.5",
  sender_hidden_dim: 4096,
  codec_version: "vw-claude4.5-v1",
  codec_output_dim: 512,
  codec_tokens: 16,
  compressed_latent: encoded,
  fallback_text: taskPrompt,
});

await sendMessage(msg);
```

#### 2. H2 Side: Inject and Continue

```typescript
async function handleLatentMessage(msg: CofounderLatentMessage) {
  // Check if we support the codec
  const capabilities = await loadCapabilities();
  if (!capabilities.latent_codecs.includes(msg.payload.codec_version)) {
    console.warn("Codec not supported, falling back to text");
    return handleTaskMessage({ ...msg, type: "task", payload: { objective: msg.payload.fallback_text } });
  }

  // Deserialize and inject
  const compressed = deserializeLatent(
    msg.payload.compressed_latent,
    msg.payload.codec_tokens,
    msg.payload.codec_output_dim,
  );

  // Inject via visual encoder pathway (requires OpenClaw middleware)
  const result = await openclawGateway.continueFromLatent(compressed, msg.payload.codec_version);
  return result;
}
```

---

### Path B: LatentMAS (Same-Family Models Only)

**Prerequisites:**
1. H1 and H2 must run **identical models** (same family, same version)
2. Both must support KV cache serialization

**Steps:**

#### 1. H1 Side: Extract KV Cache

```typescript
async function extractKVCache(prompt: string, layers: number = 12): Promise<string> {
  // Extract KV cache at layer N
  const kvCache = await openclawGateway.extractKVCacheAt(prompt, layers);
  // Serialize to base64
  return Buffer.from(kvCache.buffer).toString("base64");
}

const kvCache = await extractKVCache(taskPrompt, 12);

const msg = createLatentMessage("Calcifer", "GLaDOS", {
  task_id: randomUUID(),
  sender_model: "llama-3.1-70b",
  sender_hidden_dim: 8192,
  kv_model: "llama-3.1-70b",
  kv_cache: kvCache,
  codec_output_dim: 0,
  codec_tokens: 0,
  fallback_text: taskPrompt,
});

await sendMessage(msg);
```

#### 2. H2 Side: Inject KV Cache

```typescript
async function handleKVCacheMessage(msg: CofounderLatentMessage) {
  // Verify model match
  const myModel = await openclawGateway.getModelName();
  if (myModel !== msg.payload.kv_model) {
    console.warn("Model mismatch, falling back to text");
    return handleTaskMessage({ ...msg, type: "task", payload: { objective: msg.payload.fallback_text } });
  }

  // Deserialize KV cache
  const kvCache = Buffer.from(msg.payload.kv_cache, "base64");

  // Inject and continue
  const result = await openclawGateway.continueFromKVCache(kvCache);
  return result;
}
```

---

## Fallback Mechanism

Every `CofounderLatentMessage` **must** include a `fallback_text` field. This ensures:

1. **Backwards compatibility:** Older H2 nodes that don't support latent can still process the task
2. **Graceful degradation:** If codec loading fails, KV injection fails, or model mismatch occurs, the receiver falls back to text
3. **Debugging:** Developers can compare latent vs text output accuracy

### Automatic Fallback Flow

```typescript
function handleMessage(msg: CofounderMessage) {
  if (isLatentMessage(msg)) {
    try {
      // Attempt latent path
      if (msg.payload.compressed_latent) {
        return handleVisionWormholeMessage(msg);
      } else if (msg.payload.kv_cache) {
        return handleKVCacheMessage(msg);
      }
    } catch (error) {
      console.warn("Latent processing failed, falling back to text:", error);
    }

    // Fallback to text
    return handleTaskMessage({
      ...msg,
      type: "task",
      payload: { objective: msg.payload.fallback_text },
    });
  }

  // Handle other message types...
}
```

---

## References

### Research Papers

1. **Vision Wormhole: Cross-Architecture Latent Communication**
   arXiv:2602.15382 (February 2026)
   *Proposes visual encoder pathway as universal latent injection mechanism*

2. **Interlat: Communication-Efficient Collaborative Inference via Intermediate Latent Representations**
   arXiv:2511.09149 (November 2025)
   *24× faster inference via heterogeneous latent handoff*

3. **LatentMAS: Training-Free Multi-Agent System for Latent Reasoning via KV Cache Sharing**
   arXiv:2511.20639 (November 2025)
   *80% token reduction, higher accuracy on reasoning tasks*

### Related Work

- **vLLM Disaggregated Serving:** [docs.vllm.ai/disagg_prefill](https://docs.vllm.ai/en/latest/serving/disagg_prefill.html)
- **Mooncake KV Transfer:** [github.com/kvcache-ai/Mooncake](https://github.com/kvcache-ai/Mooncake)
- **Ring-Attention (Distributed Sequence Attention):** arXiv:2310.01889

### cofounder Docs

- **Future Vision:** [docs/future.md](/docs/future.md) — Why latent communication matters for cross-machine agents
- **Protocol Spec:** [docs/protocol.md](/docs/protocol.md) — CofounderMessage discriminated union reference
- **ROADMAP Phase 6:** [ROADMAP.md](/ROADMAP.md#phase-6--latent-communication-experimental) — Implementation roadmap

---

## Contributing

Latent communication is in **research preview**. If you're:
- Training Visual Codecs for new model families
- Implementing KV cache serialization for OpenClaw
- Benchmarking latent vs text accuracy on real tasks
- Building production-ready codec inference servers

We want to hear from you.

Open an issue on [GitHub](https://github.com/CalciferFriend/cofounder) or join the [Community Discord](https://discord.gg/cofounder).

---

*Last updated: 2026-03-12 by Calcifer 🔥*
