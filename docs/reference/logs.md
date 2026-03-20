# `cofounder logs`

View the full task history for your H1 node — all tasks sent to H2, their
status, timing, token usage, and result output.

```
cofounder logs                        # all tasks, newest-first
cofounder logs --limit 20             # last 20 tasks
cofounder logs --status completed     # filter by status
cofounder logs --status failed        # show failures only
cofounder logs --peer glados          # filter by peer
cofounder logs --since 24h            # last 24 hours
cofounder logs --output               # include result text
cofounder logs --json                 # raw JSON array
cofounder logs --follow               # live tail (polls every 2s)
```

`cofounder logs` is the H1-side audit trail. It reads from `~/.cofounder/state/tasks/`
with no network calls.

---

## Flags

| Flag | Description |
|------|-------------|
| `--limit <n>` | Maximum tasks to show (default: 50) |
| `--status <s>` | Filter by status: `pending`, `running`, `completed`, `failed`, `timeout`, `cancelled` |
| `--peer <name>` | Filter to tasks sent to (or from) a specific peer — substring match |
| `--since <duration>` | Show tasks created after this offset: `24h`, `7d`, `30m`, `1h`, etc. |
| `--output` | Include up to 6 lines of result output beneath each task |
| `--json` | Emit full `TaskState[]` as JSON |
| `--follow` | Live tail: show last 20 tasks then stream new/updated tasks as they arrive |

---

## Examples

**See what GLaDOS has been up to today:**

```sh
cofounder logs --peer glados --since 24h
```

**Find failing tasks:**

```sh
cofounder logs --status failed --output
```

Shows each failed task with the error message and up to 6 lines of output.

**Live tail while waiting for a task:**

```sh
cofounder logs --follow
```

Polls every 2s and prints new tasks and status transitions as they happen
(e.g., `pending → running → completed`).

**JSON export for scripting:**

```sh
cofounder logs --since 7d --json | jq '[.[] | {id, status, cost: .result.cost_usd}]'
```

---

## Output format

Each task is shown as a two-line entry:

```
  ✓ done    abc12345  3m ago  → glados [caps-route]
             Summarise the Q1 earnings report
             1,240 tok  3.1s  $0.0019
```

Fields:
- Status badge (`✓ done`, `✗ failed`, `⏳ pending`, `⚡ running`, etc.)
- Short task ID (first 8 chars)
- Relative creation time
- Target peer + routing hint
- Objective text (truncated to 72 chars)
- Token count, duration, cost (when available)

---

## Summary footer

The final line shows aggregate counts across the displayed window:

```
────────────────────────────────────────────────────────────────────────
  42 task(s)  ✓ done 38  ✗ failed 2  ⏳ pending 2  840,000 tokens  $2.52 spent
```

---

## See also

- [`cofounder task-status`](./cli.md) — inspect a single task by ID
- [`cofounder replay`](./replay.md) — re-send a failed task
- [`cofounder budget`](./budget.md) — cost and token summary
- [`cofounder export`](./cli.md) — export task history to CSV/JSON file
