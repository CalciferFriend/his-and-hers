---
title: HHMessage Schema
description: The HHMessage envelope — all fields, types, and discriminated union variants.
---

# HHMessage Schema

Every message between H1 and H2 is wrapped in a `HHMessage` envelope.
The `type` field determines the message variant and the expected shape of `payload`.

---

## TypeScript interface

```typescript
interface HHMessage {
  version: string;                  // Protocol version (semver)
  id: string;                       // UUID v4
  from: string;                     // Sender node name
  to: string;                       // Recipient node name
  turn: number;                     // Conversation turn counter (0-indexed)
  type: HHMessageType;              // Message type
  payload: string;                  // Task description or result content
  context_summary: string | null;   // Background context for the recipient
  budget_remaining: number | null;  // Token/cost budget remaining (USD)
  done: boolean;                    // Whether this message completes the task
  wake_required: boolean;           // H1 sets true when H2 needs waking first
  shutdown_after: boolean;          // H2 should shut down after completing
  timestamp: string;                // ISO 8601 datetime
}

type HHMessageType = "task" | "result" | "heartbeat" | "handoff" | "wake" | "error";
```

---

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `string` | ✓ | Protocol version, e.g. `"0.1.0"` |
| `id` | `string` | ✓ | UUID v4 — unique message identifier |
| `from` | `string` | ✓ | Sender node name (matches `hh.json` name) |
| `to` | `string` | ✓ | Recipient node name |
| `turn` | `number` | ✓ | Turn counter, 0-indexed. Increments per message in a conversation |
| `type` | `HHMessageType` | ✓ | Message variant — see union types below |
| `payload` | `string` | ✓ | The task text, result content, or error message |
| `context_summary` | `string \| null` | – | Optional background context from previous tasks |
| `budget_remaining` | `number \| null` | – | Remaining budget in USD; `null` = no limit |
| `done` | `boolean` | ✓ | `true` = final message for this task |
| `wake_required` | `boolean` | ✓ | If `true`, H1 sends WOL before delivering |
| `shutdown_after` | `boolean` | ✓ | If `true`, H2 shuts down after the task |
| `timestamp` | `string` | ✓ | ISO 8601 datetime, e.g. `"2026-03-12T10:00:00.000Z"` |

---

## Discriminated union variants

### `task` — H1 → H2

New task delegation. This is the most common message type.

```json
{
  "version": "0.1.0",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "from": "Calcifer",
  "to": "GLaDOS",
  "turn": 0,
  "type": "task",
  "payload": "Write a haiku about distributed systems.",
  "context_summary": "Previous task: summarized the Go paper.",
  "budget_remaining": 5.00,
  "done": false,
  "wake_required": false,
  "shutdown_after": false,
  "timestamp": "2026-03-12T10:00:00.000Z"
}
```

---

### `result` — H2 → H1

Task output. Can be partial (`done: false`) or final (`done: true`).

**Partial result:**

```json
{
  "version": "0.1.0",
  "id": "660e8400-e29b-41d4-a716-446655440001",
  "from": "GLaDOS",
  "to": "Calcifer",
  "turn": 2,
  "type": "result",
  "payload": "Packets drift through space,\n",
  "context_summary": null,
  "budget_remaining": null,
  "done": false,
  "wake_required": false,
  "shutdown_after": false,
  "timestamp": "2026-03-12T10:00:02.000Z"
}
```

**Final result:**

```json
{
  "version": "0.1.0",
  "id": "770e8400-e29b-41d4-a716-446655440002",
  "from": "GLaDOS",
  "to": "Calcifer",
  "turn": 4,
  "type": "result",
  "payload": "Packets drift through space,\nNodes whisper across the void—\nLatency blooms.",
  "context_summary": null,
  "budget_remaining": null,
  "done": true,
  "wake_required": false,
  "shutdown_after": false,
  "timestamp": "2026-03-12T10:00:05.000Z"
}
```

---

### `heartbeat` — Either direction

Periodic liveness ping. The `payload` field contains a serialized `HHHeartbeat`
JSON object.

```json
{
  "version": "0.1.0",
  "id": "880e8400-e29b-41d4-a716-446655440003",
  "from": "GLaDOS",
  "to": "Calcifer",
  "turn": 0,
  "type": "heartbeat",
  "payload": "{\"from\":\"GLaDOS\",\"role\":\"h2\",\"tailscale_ip\":\"100.a.b.c\",\"gateway_port\":3737,\"gateway_healthy\":true,\"uptime_seconds\":3600,\"timestamp\":\"2026-03-12T10:05:00.000Z\"}",
  "context_summary": null,
  "budget_remaining": null,
  "done": true,
  "wake_required": false,
  "shutdown_after": false,
  "timestamp": "2026-03-12T10:05:00.000Z"
}
```

See [HHHeartbeat](/protocol/hhheartbeat) for the payload schema.

---

### `handoff` — Either direction

Structured task delegation with explicit constraints and expected output.
The `payload` field contains a serialized `HHHandoff` JSON object.

```json
{
  "version": "0.1.0",
  "id": "990e8400-e29b-41d4-a716-446655440004",
  "from": "Calcifer",
  "to": "GLaDOS",
  "turn": 0,
  "type": "handoff",
  "payload": "{\"task_id\":\"aaa-bbb-ccc\",\"from_role\":\"h1\",\"to_role\":\"h2\",\"objective\":\"Generate product images for three SKUs.\",\"context\":\"The product is a wireless keyboard.\",\"constraints\":[\"16:9 aspect ratio\",\"white background\",\"photorealistic\"],\"expected_output\":\"Three 1024x576 PNG file paths.\",\"timeout_seconds\":300,\"wake_if_sleeping\":true,\"shutdown_when_done\":false}",
  "context_summary": null,
  "budget_remaining": 10.00,
  "done": false,
  "wake_required": true,
  "shutdown_after": false,
  "timestamp": "2026-03-12T10:10:00.000Z"
}
```

See [HHHandoff](/protocol/hhhandoff) for the payload schema.

---

### `wake` — H1 → H2

Explicit wake signal sent before a task when H2 is sleeping. H1 may send
this after the WOL packet lands and before sending the actual task.

```json
{
  "version": "0.1.0",
  "id": "aa0e8400-e29b-41d4-a716-446655440005",
  "from": "Calcifer",
  "to": "GLaDOS",
  "turn": 0,
  "type": "wake",
  "payload": "Wake up — task incoming.",
  "context_summary": null,
  "budget_remaining": null,
  "done": false,
  "wake_required": false,
  "shutdown_after": false,
  "timestamp": "2026-03-12T10:15:00.000Z"
}
```

---

### `error` — Either direction

Error report. `done: true` signals the task will not be retried.

```json
{
  "version": "0.1.0",
  "id": "bb0e8400-e29b-41d4-a716-446655440006",
  "from": "GLaDOS",
  "to": "Calcifer",
  "turn": 2,
  "type": "error",
  "payload": "Ollama crashed during inference: OOM on model llama3:70b",
  "context_summary": null,
  "budget_remaining": null,
  "done": true,
  "wake_required": false,
  "shutdown_after": false,
  "timestamp": "2026-03-12T10:20:00.000Z"
}
```

---

## Completion semantics

| `type` | `done` | Meaning |
|--------|--------|---------|
| `result` | `false` | Partial result — more messages coming |
| `result` | `true` | Task completed successfully |
| `error` | `true` | Task failed — no retry |
| `task` | `false` | Normal task (always `false`) |
| `handoff` | `false` | Normal handoff (always `false`) |
| `heartbeat` | `true` | One-shot ping (always `true`) |
| `wake` | `false` | Pre-task wake signal (always `false`) |

---

## The `latent` message type

`HHLatentMessage` (type: `"latent"`) carries compressed hidden states instead of decoded text.
It extends the base fields with a payload containing the serialized tensor and fallback text.

Two codec paths are supported:
- **Vision Wormhole** — for heterogeneous models (different families)
- **LatentMAS KV cache** — for same-family models (training-free)

See the [Latent Communication Guide](/docs/latent-communication) for full implementation details,
serialization helpers, and stub adapter code.

---

## See also

- [Protocol overview](/protocol/overview) — full message flow and transport
- [HHHandoff](/protocol/hhhandoff) — structured handoff payload schema
- [HHHeartbeat](/protocol/hhheartbeat) — heartbeat payload schema
- [Latent Communication Guide](/docs/latent-communication) — Phase 6 implementation guide
