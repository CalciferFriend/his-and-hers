# `cofounder budget`

Track token usage and cloud spend across your H2 tasks. Useful for
understanding where your API costs are going and how much you're saving by
routing work to a local H2 node.

```
cofounder budget               # this week's summary (default)
cofounder budget --today       # today only
cofounder budget --month       # last 30 days
cofounder budget --all         # all time
cofounder budget --tasks       # include per-task breakdown
cofounder budget --json        # raw JSON output
```

## Overview

`cofounder budget` reads your local task state files and aggregates:

- Task counts (completed / failed / pending)
- Token usage split by cloud vs local (H2 Ollama/lmstudio)
- Cloud spend in USD
- Estimated local savings (vs Sonnet-4-6 pricing)
- Net spend for the window

No external API calls are made — everything is computed from `~/.cofounder/state/tasks/`.

---

## Examples

**Weekly summary:**

```sh
cofounder budget
# cofounder budget — This week
# Tasks: 42 total (38 completed, 2 failed, 2 pending)
#
# Token usage:
#   Total:   1,240,000 tokens
#   Cloud:     840,000 tokens  →  $2.52
#   Local:     400,000 tokens  →  $0.00 (H2 GPU)
#
# Cost:
#   Cloud spend:     $2.52
#   Local savings:   ~$6.00 (est. vs Sonnet pricing)
#   Net spend:       $2.52
```

**Per-task breakdown:**

```sh
cofounder budget --today --tasks
```

Shows a table of today's tasks with token count and cost per task.
Costs marked `~` are estimated (token count provided but model price unknown).

**Machine-readable JSON:**

```sh
cofounder budget --month --json
```

Returns a `BudgetSummary` object:

```json
{
  "window": "month",
  "completed": 120,
  "failed": 3,
  "pending": 0,
  "total_tokens": 4200000,
  "local_tokens": 1800000,
  "cloud_cost_usd": 7.20,
  "total_cost_usd": 7.20,
  "estimated_cloud_savings_usd": 27.00,
  "tasks": [ ... ]
}
```

---

## Cost tracking

Token counts and costs are recorded when:

- H2 passes `tokens_used` and/or `cost_usd` in the result message
- H1 estimates cost via the `pricing.ts` table when only `tokens_used` is known

To enable tracking, have your H2 executor emit `tokens_used` in the
`CofounderResultMessage`. See the [H2 integration guide](/docs/reference/calcifer-glados.md).

---

## Flags

| Flag | Description |
|------|-------------|
| `--today` | Show today's window only |
| `--month` | Show last 30 days |
| `--all` | Show all time |
| `--tasks` | Include per-task rows (last 20 completed/failed) |
| `--json` | Emit raw `BudgetSummary` JSON |

---

## See also

- [`cofounder logs`](./logs.md) — full task history with status filtering
- [`cofounder replay`](./replay.md) — re-send a failed task
- [Pricing table](../../packages/core/src/providers/pricing.ts) — model cost map used for estimation
