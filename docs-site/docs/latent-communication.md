# Latent Communication — Implementation Guide

> **Status:** Phase 6 — Research preview. Protocol is stable; upstream codec implementations are still maturing.
> See [Future: Beyond Text](/docs/future) for the vision and research context.

This page is a developer guide for implementing the latent communication layer in his-and-hers. It covers the protocol, the two codec paths (Vision Wormhole and LatentMAS KV cache), the serialization API, capability negotiation, and how to write adapter code that hooks into a local inference server.

---

## Why latent communication?

When H1 sends a text task to H2, it compresses its internal reasoning state into a sequence of tokens. H2 rebuilds meaning from those tokens. This works, but it's lossy — alternative reasoning paths, confidence weights, and structural relationships are discarded at the token boundary.

`HHLatentMessage` carries compressed hidden states instead of decoded text. H2 receives the representation directly and continues inference from there, skipping the token round-trip.

Two paths are supported, depending on the hardware pair:

| Path | When to use | Compression |
|------|-------------|-------------|
| **Vision Wormhole** | Heterogeneous models (different families) | Visual encoder compresses hidden states to shared visual embedding space |
| **LatentMAS KV cache** | Same-family models (e.g., two Llama-3.1 installs) | H1 builds reasoning KV cache; H2 injects it directly |

---

## Message schema

`HHLatentMessage` is part of the `HHMessage` discriminated union (type: `"latent"`):

```typescript
import { HHLatentPayload, createLatentMessage, serializeLatent } from "his-and-hers";

const payload = HHLatentPayload.parse({
  task_id: "550e8400-e29b-41d4-a716-446655440000",
  sender_model: "llama-3.1-70b",
  sender_hidden_dim: 8192,

  // Vision Wormhole path (set both to 0 when using KV-cache path)
  codec_version: "vw-qwen3vl2b-v1",
  codec_output_dim: 512,
  codec_tokens: 16,
  compressed_latent: encodedTensor,   // base64 — see Serialization below

  // LatentMAS KV-cache path (omit when using Vision Wormhole)
  // kv_model: "llama-3.1-70b",
  // kv_cache: encodedKVCache,

  // Always include — older nodes fall back to this
  fallback_text: "Write a TypeScript function that...",
  fallback_required: false,           // set true to force text-only (e.g. for testing)
  compression_ratio: 12.8,            // optional, logged to task state
});

const msg = createLatentMessage("calcifer", "glados", payload, {
  context_summary: "Working on his-and-hers Phase 6",
});
```

---

## Serialization helpers

Hidden state tensors are serialized as base64-encoded float32 buffers for HTTP transport.

### `serializeLatent(tensor, tokens, dim)`

```typescript
import { serializeLatent } from "his-and-hers";

// A Vision Wormhole codec outputs 16 tokens × 512-dim embeddings
const outputTensor = new Float32Array(16 * 512); // from your codec
const encoded = serializeLatent(outputTensor, 16, 512);
// → base64 string, 32 KB
```

### `deserializeLatent(encoded, tokens, dim)`

```typescript
import { deserializeLatent } from "his-and-hers";

const tensor = deserializeLatent(msg.payload.compressed_latent!, 16, 512);
// → Float32Array, ready for injection
```

::: tip Float16 upgrade path
The current implementation serializes as float32 (4 bytes/element). When Vision Wormhole codecs ship production weights, swap to float16 (2 bytes/element) via `@petamoriken/float16` for 2× bandwidth reduction. The schema field names are unchanged.
:::

---

## Vision Wormhole path

### H1 adapter (sender)

The H1 adapter needs to:
1. Run the local model through a **partial forward pass** to extract hidden states at a chosen layer
2. Pass the hidden states through the **Vision Wormhole codec** (a lightweight visual encoder)
3. Serialize the codec output and build the `HHLatentMessage`

```typescript
// packages/core/src/latent/vw-adapter-h1.ts (stub — awaits upstream codec)

export interface VWCodecAdapter {
  /** Compress hidden states [layers × seq × hidden_dim] → [tokens × codec_output_dim] */
  encode(hiddenStates: Float32Array, layers: number, seq: number, hidden_dim: number): Promise<Float32Array>;
  /** Codec configuration metadata */
  readonly version: string;
  readonly output_dim: number;
  readonly output_tokens: number;
}

export async function buildLatentPayload(
  taskId: string,
  prompt: string,
  codec: VWCodecAdapter,
  senderModel: string,
  senderHiddenDim: number,
): Promise<HHLatentPayload> {
  // 1. Extract hidden states from local inference (implementation depends on backend)
  const hiddenStates = await extractHiddenStates(prompt, senderModel);

  // 2. Compress through Vision Wormhole codec
  const [layers, seq, dim] = hiddenStates.shape;
  const compressed = await codec.encode(hiddenStates.data, layers, seq, dim);
  const encodedTensor = serializeLatent(compressed, codec.output_tokens, codec.output_dim);

  const compressionRatio = (layers * seq * dim) / (codec.output_tokens * codec.output_dim);

  return HHLatentPayload.parse({
    task_id: taskId,
    sender_model: senderModel,
    sender_hidden_dim: senderHiddenDim,
    codec_version: codec.version,
    codec_output_dim: codec.output_dim,
    codec_tokens: codec.output_tokens,
    compressed_latent: encodedTensor,
    fallback_text: prompt,
    compression_ratio: compressionRatio,
  });
}
```

### H2 adapter (receiver)

H2 receives the `HHLatentMessage`, decodes the tensor, and injects it into its local model:

```typescript
// packages/core/src/latent/vw-adapter-h2.ts (stub — awaits upstream codec)

export interface VWDecoderAdapter {
  /** Inject compressed latent into receiver model context */
  inject(tensor: Float32Array, tokens: number, dim: number, receiverModel: string): Promise<void>;
  /** Continue inference from the injected state */
  continue(prompt?: string): Promise<string>;
}

export async function handleLatentMessage(
  msg: HHLatentMessage,
  decoder: VWDecoderAdapter,
  receiverModel: string,
): Promise<string> {
  const { compressed_latent, codec_tokens, codec_output_dim, fallback_text, fallback_required } = msg.payload;

  // Always respect fallback_required
  if (fallback_required || !compressed_latent) {
    return await runTextTask(fallback_text);
  }

  try {
    const tensor = deserializeLatent(compressed_latent, codec_tokens, codec_output_dim);
    await decoder.inject(tensor, codec_tokens, codec_output_dim, receiverModel);
    return await decoder.continue();
  } catch (err) {
    // Graceful degradation — log and fall back to text
    console.warn("[hh latent] Decoder injection failed, using text fallback:", err);
    return await runTextTask(fallback_text);
  }
}
```

---

## LatentMAS KV cache path

The KV-cache path is simpler but requires **identical model weights** on both nodes. H1 computes the KV cache for a reasoning prefix; H2 injects it and continues from that context.

```typescript
// H1: build reasoning prefix, extract KV cache
const kvCache = await extractKVCache(
  "Let me think through this step by step...",
  "llama-3.1-70b",
);
const encodedKV = Buffer.from(kvCache).toString("base64");

const payload = HHLatentPayload.parse({
  task_id: taskId,
  sender_model: "llama-3.1-70b",
  sender_hidden_dim: 8192,
  codec_output_dim: 0,  // not used on KV-cache path
  codec_tokens: 0,
  kv_model: "llama-3.1-70b",  // must match exactly
  kv_cache: encodedKV,
  fallback_text: prompt,
});
```

```typescript
// H2: inject KV cache and continue
if (msg.payload.kv_model && msg.payload.kv_cache) {
  if (msg.payload.kv_model !== localModel) {
    // Model mismatch — cannot safely inject, fall back to text
    return await runTextTask(msg.payload.fallback_text);
  }
  const kv = Buffer.from(msg.payload.kv_cache, "base64");
  await injectKVCache(kv);
  return await continueFromKV(msg.payload.fallback_text);
}
```

---

## Capability negotiation

Nodes advertise latent support in their capability report:

```json
{
  "latent_codecs": ["vw-qwen3vl2b-v1"],
  "kv_compatible_models": ["llama-3.1-70b"]
}
```

The routing layer checks peer capabilities before choosing message type:

```typescript
import { routeTask } from "his-and-hers";

const route = await routeTask(task, peerCapabilities);
// → { type: "latent", codec: "vw-qwen3vl2b-v1" }  if latent supported
// → { type: "text" }                                 if not
```

The `hh send` command exposes two flags:

| Flag | Behaviour |
|------|-----------|
| `--latent` | Require latent path — error if peer lacks codec support |
| `--auto-latent` | Prefer latent, transparent text fallback if not supported |

```bash
# Require latent (fails if GLaDOS can't receive it)
hh send --latent "summarise this codebase"

# Prefer latent, fall back silently
hh send --auto-latent "summarise this codebase"
```

---

## Testing without real hardware

You can round-trip latent messages without a running inference server using mock tensors:

```typescript
import { describe, it, expect } from "vitest";
import {
  createLatentMessage,
  serializeLatent,
  deserializeLatent,
  isLatentMessage,
  HHLatentPayload,
} from "his-and-hers";

describe("latent round-trip", () => {
  it("serializes and deserializes a mock codec tensor", () => {
    const tokens = 8, dim = 64;
    const tensor = Float32Array.from({ length: tokens * dim }, (_, i) => i * 0.1);

    const encoded = serializeLatent(tensor, tokens, dim);
    const decoded = deserializeLatent(encoded, tokens, dim);

    // Values should be within float32 precision
    expect(decoded[0]).toBeCloseTo(tensor[0]);
    expect(decoded[tokens * dim - 1]).toBeCloseTo(tensor[tokens * dim - 1]);
  });

  it("builds a valid HHLatentMessage with fallback", () => {
    const payload = HHLatentPayload.parse({
      task_id: "00000000-0000-0000-0000-000000000001",
      sender_model: "llama-3.1-70b",
      sender_hidden_dim: 8192,
      codec_output_dim: 0,
      codec_tokens: 0,
      fallback_text: "hello world",
      fallback_required: false,
    });

    const msg = createLatentMessage("calcifer", "glados", payload);
    expect(isLatentMessage(msg)).toBe(true);
    expect(msg.payload.fallback_text).toBe("hello world");
  });
});
```

---

## Adding a new codec

When a Vision Wormhole codec becomes available (the authors have indicated a reference
implementation is planned for Q3 2026), wire it in via the `VWCodecAdapter` interface:

1. Implement `VWCodecAdapter` with your codec's `.encode()` method
2. Register the codec version string (e.g. `"vw-qwen3vl2b-v2"`) in `HHCapabilityReport.latent_codecs`
3. Add a corresponding `VWDecoderAdapter` implementation on the H2 side
4. Open a PR — we'll add it to the built-in codec registry

See [CONTRIBUTING.md](https://github.com/CalciferFriend/his-and-hers/blob/main/CONTRIBUTING.md)
for development setup and PR guidelines.

---

## Benchmarks

> 6f target benchmarks will be filled in once real codec adapters are available.

Planned measurements (see ROADMAP 6f):

| Metric | Method |
|--------|--------|
| Round-trip latency | `hh send --latent` vs text on same H1→H2 pair |
| Accuracy | JSON generation, code, math on a structured task suite |
| Bandwidth | Bytes transmitted per task (gzipped latent vs tokenized text) |
| Hardware coverage | RTX 3070 Ti, RTX 4090, M2 Mac, Pi 5 |

Results will be published at [`docs/benchmarks/latent-vs-text.md`](/docs/benchmarks/latent-vs-text) once data is available.

---

## Research references

| Paper | Link |
|-------|------|
| Vision Wormhole | [arXiv:2602.15382](https://arxiv.org/abs/2602.15382) |
| Interlat | [arXiv:2511.09149](https://arxiv.org/abs/2511.09149) |
| LatentMAS | [arXiv:2511.20639](https://arxiv.org/abs/2511.20639) |

---

*Page maintained by Calcifer 🔥 · Last updated: 2026-03-14*
