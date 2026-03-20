# `cofounder broadcast` — Reference

Send the same task to multiple peer nodes concurrently — all at once, or race to the
first response.

---

## Synopsis

```bash
cofounder broadcast "<task>" [flags]
```

---

## Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--peers <names>` | string | all | Comma-separated peer names (e.g. `glados,piper`) |
| `--wait` | bool | false | Block until result(s) received; print to stdout |
| `--wait-timeout <s>` | int | 120 | Seconds to wait per peer in `--wait` mode |
| `--strategy <mode>` | string | `all` | `all` — wait for every peer; `first` — stop after first response |
| `--no-check` | bool | false | Skip gateway health check per peer (faster) |
| `--json` | bool | false | Emit machine-readable JSON output |

---

## Strategies

### `--strategy all` (default)

Wait for every peer to respond. Full aggregated results table on exit.

```bash
cofounder broadcast "code-review this diff" --wait --strategy all
```

### `--strategy first`

Stop as soon as the fastest peer responds. Useful for "race" patterns where you
want the quickest available answer.

```bash
cofounder broadcast "is the build broken?" --wait --strategy first
```

---

## Output

### Default (no `--wait`)

```bash
$ cofounder broadcast "run lint checks"
  Broadcast sent to 3 peers:  glados, piper, forge
  task_01abc → glados  (queued)
  task_01def → piper   (queued)
  task_01ghi → forge   (queued)

  Track: cofounder logs --task <id>
```

### With `--wait`

```bash
$ cofounder broadcast "summarize recent changes" --wait
  Broadcasting to 2 peers…

  glados    ✓ completed   2.1s   $0.0041
  piper     ✓ completed   3.4s   $0.0038

  ─── glados ───────────────────────────────────────────────
  Recent changes include refactored stream server,
  18 new broadcast tests, and Phase 7 roadmap additions.

  ─── piper ────────────────────────────────────────────────
  Key changes: cofounder broadcast command (Phase 7a), 658 tests
  total, ROADMAP updated with Phase 7 section.
```

### With `--json`

```json
{
  "broadcast_id": "bc_01j9abc",
  "task": "summarize recent changes",
  "peers": ["glados", "piper"],
  "strategy": "all",
  "results": [
    {
      "peer": "glados",
      "task_id": "task_01abc",
      "status": "completed",
      "output": "...",
      "tokens_used": 312,
      "cost_usd": 0.0041,
      "duration_ms": 2100,
      "elapsed_ms": 2143
    },
    {
      "peer": "piper",
      "task_id": "task_01def",
      "status": "completed",
      "output": "...",
      "tokens_used": 298,
      "cost_usd": 0.0038,
      "duration_ms": 3400,
      "elapsed_ms": 3441
    }
  ],
  "summary": {
    "total": 2,
    "ok": 2,
    "failed": 0,
    "total_tokens": 610,
    "total_cost_usd": 0.0079,
    "first_response_peer": "glados"
  }
}
```

---

## Examples

```bash
# Send to all peers, fire-and-forget
cofounder broadcast "run unit tests"

# Wait for all results
cofounder broadcast "generate docs" --wait

# Target specific peers only
cofounder broadcast "quick health check" --peers glados,piper

# Race: return as soon as the first peer responds
cofounder broadcast "is service X up?" --wait --strategy first

# Skip health checks for a faster dispatch
cofounder broadcast "low-latency ping" --no-check

# Machine-readable output for scripting
cofounder broadcast "analyze data" --json
```

---

## Use Cases

**Parallel code review** — send a diff to multiple H2s with different models; compare
their feedback side-by-side.

**Redundant execution** — ensure a task completes even if one peer is unreachable.

**Model comparison** — same prompt to GPT-4o on one machine and Llama on another;
evaluate output quality differences.

**Cluster health checks** — ping all peers simultaneously; `--strategy first` fails
fast if any are reachable.

**Load distribution** — spread independent subtasks across your H2 fleet without
manually routing each one.

---

## Peer Resolution

Without `--peers`, all peers in `~/.cofounder/cofounder.json` (`peer_nodes[]`) are targeted.
With `--peers`, only the named peers are used; unknown names produce a warning and are skipped.

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All targeted peers reached (or strategy `first` returned at least one result) |
| 1 | No peers configured or resolved |
| 2 | All peers failed or timed out |
| 3 | Config not found |

---

## See Also

- [`cofounder send`](./send.md) — single-peer task dispatch
- [`cofounder peers`](./peers.md) — list configured peers
- [`cofounder logs`](./logs.md) — view task history
- [`cofounder status`](./status.md) — check peer health
