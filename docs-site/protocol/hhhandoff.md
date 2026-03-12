---
title: HHHandoff Schema
description: The HHHandoff payload schema for structured task delegation.
---

# HHHandoff Schema

`HHHandoff` is a structured task delegation payload used when Tom or Jerry wants
to hand off work with explicit constraints, expected output, and execution bounds.
It is carried in a `HHMessage` with `type: "handoff"`.

---

## TypeScript interface

```typescript
interface HHHandoff {
  task_id: string;               // UUID v4 — stable identifier for this handoff
  from_role: "tom" | "jerry";    // Who is delegating
  to_role: "tom" | "jerry";      // Who should execute
  objective: string;             // Clear description of the task
  context: string;               // Background information
  constraints: string[];         // Rules and boundaries for execution
  expected_output: string;       // Description of what a successful result looks like
  timeout_seconds: number;       // Max execution time before Tom considers it failed
  wake_if_sleeping: boolean;     // Send WOL magic packet if target is offline
  shutdown_when_done: boolean;   // Target should shut down after completing
}
```

---

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `task_id` | `string` | ✓ | UUID v4 — used to correlate results back to this handoff |
| `from_role` | `"tom" \| "jerry"` | ✓ | The role delegating the task |
| `to_role` | `"tom" \| "jerry"` | ✓ | The role that should execute |
| `objective` | `string` | ✓ | Clear, unambiguous task description |
| `context` | `string` | ✓ | Background info to help the executor understand scope |
| `constraints` | `string[]` | ✓ | List of rules and boundaries (can be empty `[]`) |
| `expected_output` | `string` | ✓ | What the result should look like when done |
| `timeout_seconds` | `number` | ✓ | Max execution time. Tom marks the task failed if exceeded |
| `wake_if_sleeping` | `boolean` | ✓ | If `true`, send WOL magic packet before delivery |
| `shutdown_when_done` | `boolean` | ✓ | If `true`, executor shuts down after sending the result |

---

## Example — image generation handoff

```json
{
  "task_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "from_role": "tom",
  "to_role": "jerry",
  "objective": "Generate three product images for a wireless keyboard.",
  "context": "The product is the Keychron K2 Pro in white. Customer target: professional home office users.",
  "constraints": [
    "16:9 aspect ratio (1920x1080 or 1024x576)",
    "White or very light background",
    "Photorealistic rendering — no cartoon or illustration styles",
    "One image: hero shot. One: lifestyle (on desk with Mac). One: close-up of keycaps."
  ],
  "expected_output": "Three PNG files saved to /tmp/keychron-images/, paths returned in result payload.",
  "timeout_seconds": 300,
  "wake_if_sleeping": true,
  "shutdown_when_done": false
}
```

---

## Example — code review handoff

```json
{
  "task_id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "from_role": "tom",
  "to_role": "jerry",
  "objective": "Review the pull request diff and identify bugs or regressions.",
  "context": "This PR adds the HHHandoff discriminated union to the Zod schema. Prior schema used a plain string payload field.",
  "constraints": [
    "Focus on correctness, not style",
    "Flag any cases where backward compatibility is broken",
    "Max review length: 500 words"
  ],
  "expected_output": "Bullet list of issues found, severity (critical/warning/info), and suggested fix for each.",
  "timeout_seconds": 120,
  "wake_if_sleeping": false,
  "shutdown_when_done": false
}
```

---

## Example — shutdown handoff

```json
{
  "task_id": "c3d4e5f6-a7b8-9012-cdef-123456789012",
  "from_role": "tom",
  "to_role": "jerry",
  "objective": "Run the nightly fine-tuning job and shut down when complete.",
  "context": "Dataset: /data/finetune-2026-03-12.jsonl. Base model: llama3:8b.",
  "constraints": [
    "Use Axolotl config at /home/glados/axolotl/config.yaml",
    "Save checkpoint to /data/checkpoints/2026-03-12/",
    "Log stderr to /tmp/finetune.log"
  ],
  "expected_output": "Final checkpoint path and training loss in the result payload.",
  "timeout_seconds": 14400,
  "wake_if_sleeping": true,
  "shutdown_when_done": true
}
```

---

## Carrying a HHHandoff in a HHMessage

The `HHHandoff` is JSON-serialized and placed in the `payload` field of a
[`HHMessage`](/protocol/hhmessage) with `type: "handoff"`:

```typescript
const handoff: HHHandoff = { /* ... */ };

const message: HHMessage = {
  version: "0.1.0",
  id: crypto.randomUUID(),
  from: "Calcifer",
  to: "GLaDOS",
  turn: 0,
  type: "handoff",
  payload: JSON.stringify(handoff),
  context_summary: "Previous task completed: dataset preprocessing.",
  budget_remaining: 0.00,  // local-only task
  done: false,
  wake_required: handoff.wake_if_sleeping,
  shutdown_after: handoff.shutdown_when_done,
  timestamp: new Date().toISOString(),
};
```

---

## Responding to a handoff

Jerry responds with a standard `HHMessage` of `type: "result"`, using the same
`task_id` to correlate. The result `payload` should match the `expected_output`
described in the handoff.

---

## See also

- [HHMessage](/protocol/hhmessage) — the outer envelope
- [Protocol overview](/protocol/overview) — message flow and wake/shutdown sequences
- [`tj send`](/reference/send) — how `--handoff` tasks are constructed
