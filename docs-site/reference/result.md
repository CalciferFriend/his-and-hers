# `cofounder result`

Mark a pending task as completed (or failed) and write back the output. Called by H2 after processing a delegated task from H1.

## Usage

```bash
cofounder result <id> [output]
cofounder result <id> --fail "error message"
cofounder result <id> --output-file /tmp/result.txt
cofounder result <id> --json '{"output":"...","artifacts":["/tmp/cat.png"]}'
```

`<id>` is the task UUID (from `cofounder logs` or the `HH_TASK_ID` env var injected by `cofounder watch`).

## Flags

| Flag | Description |
|------|-------------|
| `--fail` | Mark the task as failed instead of completed |
| `--output-file <path>` | Read output from a file instead of the CLI argument |
| `--json <payload>` | Supply the full result as a raw JSON `TaskResult` object |
| `--tokens <n>` | Token count for budget tracking |
| `--duration-ms <n>` | Wall-clock duration in milliseconds |
| `--artifacts <path>` | File path(s) to attach as task artifacts (repeatable) |
| `--webhook-url <url>` | POST the result back to H1 immediately (extracted from the wake message) |

## How it works

`cofounder result` writes a `TaskResult` to `~/.cofounder/state/tasks/<id>.json`. H1's `cofounder send --wait` polling loop reads this file and resolves when the status changes.

When `--webhook-url` is supplied (typically embedded automatically in the H1 wake message), the result is also POSTed to H1 directly — resolving `cofounder send --wait` without any polling delay and triggering any configured notification webhook.

## Examples

```bash
# Standard result: task completed successfully
cofounder result abc-1234 "Image saved to /tmp/cat.png"

# Task failed
cofounder result abc-1234 --fail "Ollama model not available: llama3.2"

# Read large output from a file
cofounder result abc-1234 --output-file /tmp/transcription.txt

# Full structured result with artifacts and cost metadata
cofounder result abc-1234 --json '{
  "output": "Processed in 12.4s",
  "artifacts": ["/tmp/output.mp4"],
  "tokens": 1840,
  "duration_ms": 12400
}'

# With webhook delivery (URL injected by cofounder send):
cofounder result abc-1234 "done" \
  --webhook-url http://100.x.x.x:38791/result
```

## Executor integration

When H2 runs `cofounder watch --exec <cmd>`, the executor is launched with `HH_TASK_ID`, `HH_TASK_OBJECTIVE`, and `HH_TASK_FROM` set as environment variables. The typical pattern:

```bash
#!/bin/bash
# run-task.sh — H2 executor script
input=$(cat)  # receives full task JSON on stdin
output=$(process_task "$input")
cofounder result "$HH_TASK_ID" "$output"
```

## Remote delivery via SSH

H1 can trigger result delivery remotely:

```bash
ssh glados "cofounder result <id> 'task done'"
```

Though the webhook path (embedded in the wake message) is faster and doesn't require SSH access from H2 back to H1.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Result written (and delivered via webhook if `--webhook-url` supplied) |
| `1` | Task not found, invalid JSON, or webhook delivery failed |

## See also

- [`cofounder send`](/reference/send) — send a task from H1 to H2
- [`cofounder watch`](/reference/watch) — H2 daemon that auto-dispatches tasks
- [`cofounder logs`](/reference/logs) — view task history and statuses
- [`cofounder replay`](/reference/replay) — re-send a previous task
