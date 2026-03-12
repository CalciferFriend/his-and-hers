# `tj logs` — Reference

View task history, filter by status/peer/time, and follow live updates.

---

## Synopsis

```bash
tj logs [flags]
```

---

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--follow`, `-f` | false | Live tail — polls every 2s, highlights new/updated tasks |
| `--limit <n>` | 20 | Number of tasks to show |
| `--status <s>` | all | Filter: `queued`, `running`, `complete`, `failed`, `timeout` |
| `--peer <name>` | all | Filter by Jerry name |
| `--since <t>` | — | Time window: `30m`, `24h`, `7d`, `2026-03-01` |
| `--task <id>` | — | Show a single task by ID |
| `--output` | false | Include result text inline |
| `--json` | false | Machine-readable JSON output |

---

## Default output

```bash
$ tj logs
```

```
Task history (last 20)
──────────────────────────────────────────────────────────────────────────
task_01j8g1fk   complete   2m ago    jerry-home    "summarize the repo README"
task_01j8g0xq   complete   8m ago    jerry-home    "write unit tests for auth.ts"
task_01j8fzq7   complete   22m ago   jerry-home    "translate this to French"
task_01j8fzp1   failed     1h ago    jerry-beast   "render overnight batch — timed out"
task_01j8fzk3   complete   2h ago    jerry-pi      "embed this document corpus"
```

---

## With `--output`

```bash
$ tj logs --task task_01j8g1fk --output
```

```
task_01j8g1fk — complete — jerry-home — 2m ago
Tokens: 1,243 in / 312 out — $0.00 (ollama/mistral)
──────────────────────────────────────────────────────────────────────────
# his-and-hers

his-and-hers is an open protocol for connecting two OpenClaw agents
across separate machines. Tom orchestrates; Jerry executes.

## Key points:
- WOL-based wake when Jerry is sleeping
- HHMessage protocol for cross-machine communication
- Capability routing (GPU, Ollama, ComfyUI detection)
- Budget tracking per task and provider
```

---

## Live follow

```bash
$ tj logs --follow
```

```
[09:15:01] task_01j8g2xk   queued    → jerry-home   "generate product hero image"
[09:15:02] task_01j8g2xk   running   Jerry received task
[09:15:04] task_01j8g2xk   running   Jerry: loading SDXL...
[09:15:16] task_01j8g2xk   complete  14.2s · $0.00 local
```

Press `Ctrl+C` to exit follow mode.

---

## JSON output

```bash
$ tj logs --json --limit 3
```

```json
[
  {
    "task_id": "task_01j8g1fk",
    "status": "complete",
    "peer": "jerry-home",
    "created_at": "2026-03-12T09:13:00Z",
    "completed_at": "2026-03-12T09:13:22Z",
    "duration_seconds": 22.1,
    "prompt": "summarize the repo README",
    "provider": "ollama",
    "model": "mistral",
    "tokens_in": 1243,
    "tokens_out": 312,
    "cost_usd": 0.00
  },
  ...
]
```

---

## Task states

| State | Description |
|-------|-------------|
| `queued` | Dispatched to Jerry, not yet picked up |
| `running` | Jerry is executing the task |
| `complete` | Task finished successfully |
| `failed` | Error during execution |
| `timeout` | Exceeded `--timeout` on `tj send --wait` |
| `wol-pending` | Waiting for Jerry to boot before dispatch |

---

## Task state files

Tasks are stored at `~/.his-and-hers/tasks/<task_id>.json`:

```json
{
  "task_id": "task_01j8g1fk",
  "peer": "jerry-home",
  "status": "complete",
  "prompt": "summarize the repo README",
  "created_at": "2026-03-12T09:13:00.000Z",
  "completed_at": "2026-03-12T09:13:22.100Z",
  "provider": "ollama",
  "model": "mistral",
  "tokens_in": 1243,
  "tokens_out": 312,
  "cost_usd": 0.00,
  "output": "# his-and-hers\n\nhis-and-hers is an open protocol..."
}
```

---

## Filtering examples

```bash
# Only failed tasks
tj logs --status failed

# Last 24 hours, from jerry-pi
tj logs --since 24h --peer jerry-pi

# Last 50 tasks with results
tj logs --limit 50 --output

# Failed tasks from the last week
tj logs --since 7d --status failed --output

# All tasks for a specific peer, JSON
tj logs --peer jerry-beast --all --json > jerry-beast-history.json
```

---

## See also

- [tj budget](/reference/budget) — cost breakdown per task
- [tj send](/reference/send) — dispatch tasks
- [Sending tasks guide](/guide/sending-tasks) — task lifecycle walkthrough
