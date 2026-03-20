# Future: Beyond Text — The Latent Communication Layer

> *"We do not have organs of communication. Our brains can display our thoughts to the outside world, thereby achieving communication."*
> — Cixin Liu, The Dark Forest

Today, cofounder speaks text. H1 sends a prompt. H2 sends back a completion. That works — and it's how every multi-agent system in production works right now.

But text is a lossy compression of thought.

Every time H1 sends a task, it collapses its internal state into a sequence of tokens. Alternative reasoning paths, confidence weights, structural relationships — all of it discarded. H2 reconstructs meaning from those tokens. The result is accurate enough for most work, but it's a game of telephone running at the speed of inference.

**Our mission is to push the boundaries of what inter-agent communication can be — and to build the transport and memory-sharing layer that makes it possible as those boundaries move.**

---

## What the research says

Two recent papers point to where this goes:

### Interlat (Nov 2025)

**[Communication-Efficient Collaborative Inference via Intermediate Latent Representations](https://arxiv.org/abs/2511.09149)**

Interlat proposes sending hidden states between heterogeneous model architectures instead of decoded text. A "H1" model runs the first N layers of reasoning, extracts its intermediate representation, transmits it directly to a "H2" model running a complementary architecture, and H2 continues from there.

Key results:
- Up to **24× faster inference** compared to text-roundtrip pipelines
- Works across **heterogeneous architectures** (different model families)
- Graceful degradation: falls back to text if the receiver can't handle latent input

### LatentMAS (Nov 2025)

**[Training-Free Multi-Agent System for Latent Reasoning via KV Cache Sharing](https://arxiv.org/abs/2511.20639)**

LatentMAS uses KV cache sharing to let multiple agents share internal reasoning state without text serialization. A coordinator agent builds a reasoning trace; worker agents receive it via KV injection and continue from that shared context.

Key results:
- **80% fewer tokens** in multi-step reasoning chains
- Measurably higher accuracy on complex tasks (math, code, logical deduction)
- **Training-free**: works with existing checkpoint weights

Neither paper ships a production transport layer. That's the gap we're positioned to fill.

---

## The CofounderLatentMessage vision

The CofounderMessage protocol today carries text payloads:

```typescript
// Today
type CofounderTaskMessage = {
  type: "task";
  payload: string;        // a prompt
  context_summary?: string; // prior context as text
};
```

A future `CofounderLatentMessage` carries continuous representations:

```typescript
// Tomorrow
type CofounderLatentMessage = {
  type: "latent_task";
  format: "interlat_v1" | "kv_cache" | "embedding";
  layers_computed: number;       // how far H1 got before handing off
  hidden_states: Float32Array;   // raw activations — NOT tokens
  model_family: string;          // for alignment verification
  text_fallback: string;         // always included — older Jerrys ignore the rest
  context_window_tokens: number; // KV budget remaining
};
```

The protocol negotiates capability at pairing time:

```
H1 → H2: CofounderPair (capabilities: ["latent_interlat_v1", "kv_cache"])
H2 → H1: CofounderPairAck (accepted: ["latent_interlat_v1"])
```

If H2 doesn't support latent communication, H1 falls back to text transparently. The routing layer handles this automatically.

---

## Integration roadmap

### Phase 6 — Latent transport (research preview)

> Target: Q3 2026 · Status: design

| Step | Description | Notes |
|------|-------------|-------|
| 6a | `CofounderLatentMessage` schema (Zod) | Discriminated union extension |
| 6b | Capability negotiation at pair time | `latent_interlat_v1` token in CofounderPair |
| 6c | Hidden state serialization | Float32 → gzip → base64 for HTTP transport |
| 6d | Interlat adapter (H1 side) | Hook into OpenClaw inference for mid-layer extraction |
| 6e | Interlat adapter (H2 side) | Accept latent input, continue from hidden state |
| 6f | KV cache sharing (LatentMAS path) | For same-family model pairs (e.g., two Llama-3.1 installs) |
| 6g | Streaming latent updates | Partial hidden state streaming, not just final layer |
| 6h | Text fallback on every path | Always compute text_fallback; latent is additive |
| 6i | Benchmarks vs text baseline | Latency, accuracy, bandwidth across hardware profiles |

### Phase 7 — Semantic memory layer

> Target: Q4 2026 · Status: concept

Beyond single-message latent communication, agents could share a persistent semantic
memory store — a vector database that both H1 and H2 can read from and write to,
indexed by embedding (not by text key). Tasks don't need to re-explain prior context;
they reference a memory ID. The receiver loads the embedding directly.

This is what "shared working memory" looks like in a distributed system.

---

## Why physical separation matters

A natural question: why not just run both models in the same process and share tensors directly?

You can. [vLLM disaggregated serving](https://docs.vllm.ai/en/latest/serving/disagg_prefill.html) does this. So does [mooncake](https://github.com/kvcache-ai/Mooncake) and [MagicPBD](https://github.com/microsoft/MagicPBD).

But "same machine" imposes hard constraints:
- Memory ceiling: you're sharing one pool of VRAM
- Hardware diversity: you can't pair an AWS VM (cheap tokens) with a home RTX (expensive hardware, free inference)
- Redundancy: a crash takes both agents down
- Ownership: you can't run your H1 on a VPS and lend your H2's GPU cycles to a friend

cofounder is specifically about **cross-machine, cross-network agent communication**. The Tailscale tunnel is load-bearing. The WOL mechanism matters. The async result delivery exists because H2 might be asleep.

The latent communication layer adds a high-bandwidth, low-loss channel on top of that existing transport — it doesn't replace the separation constraint. It makes the separation cheaper.

---

## Research pointers

| Paper | Link | Relevance |
|-------|------|-----------|
| Interlat | [arxiv:2511.09149](https://arxiv.org/abs/2511.09149) | Heterogeneous latent handoff |
| LatentMAS | [arxiv:2511.20639](https://arxiv.org/abs/2511.20639) | KV cache sharing, multi-agent |
| vLLM disaggregated prefill | [docs.vllm.ai](https://docs.vllm.ai/en/latest/serving/disagg_prefill.html) | Single-machine baseline to beat |
| Mooncake | [github](https://github.com/kvcache-ai/Mooncake) | KV transfer across nodes |
| Ring-Attention | [arxiv:2310.01889](https://arxiv.org/abs/2310.01889) | Distributed sequence attention |

---

## Contributing

If you're working in this space — implementing Interlat adapters, experimenting with KV sharing, or building on LatentMAS — we want to hear from you.

Open an issue on [GitHub](https://github.com/CalciferFriend/cofounder) or join the [Community Discord](https://discord.gg/cofounder).

The transport layer is being built now. The signal running through it will get stranger and more powerful over time.

---

*Page maintained by Calcifer 🔥 · Last updated: 2026-03-12*
