# `hh pipeline`

Run a sequence of tasks across one or more peers, automatically threading each
step's output into the next step's prompt.

```
hh pipeline "peer1:task one -> peer2:review {{previous.output}}"
hh pipeline --file pipeline.json
hh pipeline --file pipeline.json --json
hh pipeline --file pipeline.json --timeout 180
```

## Why pipelines?

Single-shot `hh send` is great for discrete tasks. Pipelines let you chain
agents into a **workflow** — write code on GLaDOS, review it on Piper, notify
Slack via a webhook step, all in one command.

---

## Inline spec

The simplest way to define a pipeline is an inline string. Each step is
`peer:task`, separated by ` -> `:

```sh
hh pipeline "glados:write a Python fizzbuzz -> piper:review {{previous.output}}"
```

Placeholder substitution:

| Placeholder | Resolves to |
|---|---|
| `{{previous.output}}` | Output text from the immediately preceding step |
| `{{previous.error}}` | Error message from the immediately preceding step |
| `{{steps.1.output}}` | Output from step 1 (1-based index) |
| `{{steps.N.error}}` | Error from step N |

If a placeholder refers to a step that hasn't run or has no output, it
substitutes as an empty string.

---

## Pipeline files

For more complex workflows, write a JSON pipeline definition and pass it with
`--file`:

```json
{
  "name": "code-review-loop",
  "description": "Generate code on GLaDOS, review on Piper, summarize on Calcifer",
  "steps": [
    {
      "peer": "glados",
      "task": "Write a TypeScript function that validates an email address",
      "label": "Generate code",
      "timeout": 90
    },
    {
      "peer": "piper",
      "task": "Review this code for correctness and style:\n\n{{previous.output}}",
      "label": "Code review",
      "timeout": 60
    },
    {
      "peer": "local",
      "task": "Summarize the review feedback in 3 bullet points:\n\n{{previous.output}}",
      "label": "Summarize",
      "continueOnError": true,
      "timeout": 30
    }
  ]
}
```

### Step fields

| Field | Type | Required | Description |
|---|---|---|---|
| `peer` | string | ✓ | Peer name from your `hh.json` config |
| `task` | string | ✓ | Task text (supports `{{...}}` placeholders) |
| `label` | string | | Human-readable step label for output |
| `timeout` | number | | Per-step timeout in seconds (default: 120) |
| `continueOnError` | boolean | | Keep running if this step fails (default: false) |

---

## Options

| Flag | Description |
|---|---|
| `--file <path>` | Load pipeline definition from a JSON file |
| `--timeout <s>` | Override per-step timeout for all steps |
| `--json` | Emit machine-readable JSON result |

---

## Output

### Human-readable (default)

```
◇ Pipeline: code-review-loop [a1b2c3d4]
│  3 steps — Generate code → piper → Summarize
│
◆ [1/3] Generate code → glados
│  Task: Write a TypeScript function that validates an email address
│  ⏳ Waiting for result (timeout: 90s) …
│  ✓ Done in 12.3s · 450 tokens · $0.0023
│  Output: export function validateEmail(email: string): boolean { …
│
◆ [2/3] Code review → piper
│  Task (interpolated): Review this code for correctness and style: …
│  ⏳ Waiting for result (timeout: 60s) …
│  ✓ Done in 8.1s · 310 tokens · $0.0015
│
◆ [3/3] Summarize → local
│  Task (interpolated): Summarize the review feedback in 3 bullet points: …
│  ⏳ Waiting for result (timeout: 30s) …
│  ✓ Done in 4.2s · 180 tokens · $0.0009
│
◇ Pipeline COMPLETED — 3/3 steps completed · $0.0047 total · 940 tokens

Final output:
• The email regex is RFC 5322 compliant.
• Error handling for null inputs is missing.
• Consider extracting the regex as a named constant.
```

### JSON output (`--json`)

```json
{
  "pipeline_id": "a1b2c3d4",
  "name": "code-review-loop",
  "status": "completed",
  "steps": [
    {
      "stepIndex": 0,
      "label": "Generate code",
      "peer": "glados",
      "task_id": "uuid-1",
      "status": "completed",
      "output": "export function validateEmail…",
      "tokens_used": 450,
      "cost_usd": 0.0023,
      "duration_ms": 12340
    }
  ],
  "total_steps": 3,
  "completed_steps": 3,
  "failed_steps": 0,
  "total_cost_usd": 0.0047,
  "total_tokens": 940,
  "total_duration_ms": 24600,
  "started_at": "2026-03-15T06:30:00.000Z",
  "finished_at": "2026-03-15T06:30:24.600Z"
}
```

---

## Failure handling

By default, if any step fails the pipeline **aborts** and remaining steps are
marked `skipped`. Set `continueOnError: true` on a step to keep the pipeline
running past that step's failure.

The top-level `status` field reflects the aggregate result:

| Value | Meaning |
|---|---|
| `completed` | All steps succeeded |
| `partial` | Some steps succeeded, some failed/timed out |
| `failed` | All steps failed or the first step failed |

---

## SDK usage

```ts
import { parsePipelineSpec, parsePipelineFile, interpolatePipelineTask } from "@his-and-hers/core";

// Parse an inline spec into steps
const steps = parsePipelineSpec("glados:write code -> piper:review {{previous.output}}");

// Parse a JSON pipeline file
const def = parsePipelineFile(fs.readFileSync("pipeline.json", "utf8"), "pipeline.json");

// Manually interpolate a step task
const resolved = interpolatePipelineTask(step.task, priorResults);
```

---

## Tips

- **Reuse output across steps** — `{{steps.1.output}}` lets any step reference
  any prior step, not just the previous one.
- **Long-running steps** — increase `--timeout` or set `timeout` per step in
  the JSON file.
- **Debugging** — run with `--json` and pipe to `jq` for structured inspection:
  `hh pipeline --file p.json --json | jq '.steps[] | {label, status, duration_ms}'`
- **Combine with clusters** — `hh broadcast` fans out; `hh pipeline` chains. Use
  both patterns together for map-reduce workflows.
