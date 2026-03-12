# Budget Tracking

his-and-hers tracks the cost of every task — cloud API tokens and local compute both. `hh budget` shows you where your money is going and advises when to route to local instead of cloud.

---

## How cost tracking works

Every task result includes a `cost_usd` field calculated from:
- Token count (input + output) × provider's per-token rate
- Local Ollama inference = $0.00

Pricing tables are built in for the major providers:

| Provider | Model | Input $/1M | Output $/1M |
|----------|-------|------------|-------------|
| Anthropic | claude-haiku-3-5 | $0.80 | $4.00 |
| Anthropic | claude-sonnet-4-5 | $3.00 | $15.00 |
| Anthropic | claude-opus-4 | $15.00 | $75.00 |
| OpenAI | gpt-4o | $2.50 | $10.00 |
| OpenAI | gpt-4o-mini | $0.15 | $0.60 |
| OpenAI | o3-mini | $1.10 | $4.40 |
| Ollama (any) | — | $0.00 | $0.00 |
| LM Studio (any) | — | $0.00 | $0.00 |

Costs are stored in task state files at `~/.his-and-hers/tasks/`.

---

## `hh budget` — daily summary

```bash
hh budget
```

Output:

```
Budget — today (Thu Mar 12)
───────────────────────────────────────────
Cloud tokens:   42,831 in / 8,204 out
Cloud cost:     $0.18
Local tokens:   284,900 in / 61,200 out
Local cost:     $0.00
Local savings:  ~$4.27  (vs. Sonnet pricing)

Tasks run:      23 (18 cloud, 5 local)
Avg task cost:  $0.008 (cloud)
───────────────────────────────────────────
Routing tip: 5 tasks routed to cloud could have run locally.
             Consider: hh send with --peer h2-home for coding tasks.
```

---

## Time ranges

```bash
hh budget           # today (default)
hh budget --week    # last 7 days
hh budget --month   # current calendar month
hh budget --all     # all time
hh budget --since 2026-03-01  # custom start date
```

---

## Per-task breakdown

```bash
hh budget --tasks
```

Output:

```
Task breakdown (today)
─────────────────────────────────────────────────────────────
task_01j8g1...  claude-sonnet  "summarize the repo..."   $0.04   local → h2-pi
task_01j8g2...  gpt-4o         "generate test plan"      $0.03   cloud
task_01j8g3...  ollama/mistral "write unit tests"        $0.00   h2-home
task_01j8g4...  claude-haiku   "route: is this GPU..."   $0.00
task_01j8g5...  ollama/llama3  "review PR diff"          $0.00   h2-home
─────────────────────────────────────────────────────────────
Total: $0.07
```

---

## JSON output

```bash
hh budget --json
```

```json
{
  "period": "today",
  "cloud_cost_usd": 0.18,
  "local_cost_usd": 0.00,
  "local_savings_estimate_usd": 4.27,
  "cloud_tokens": { "input": 42831, "output": 8204 },
  "local_tokens": { "input": 284900, "output": 61200 },
  "task_count": 23,
  "by_provider": {
    "anthropic": { "cost_usd": 0.12, "tasks": 14 },
    "openai": { "cost_usd": 0.06, "tasks": 4 },
    "ollama": { "cost_usd": 0.00, "tasks": 5 }
  }
}
```

---

## Cost routing

his-and-hers can automatically route tasks to minimize cloud spend. Set thresholds in `hh.json`:

```json
{
  "cost_routing": {
    "lightweight_threshold_tokens": 1000,
    "lightweight_provider": "anthropic",
    "lightweight_model": "claude-haiku-3-5",
    "standard_provider": "anthropic",
    "standard_model": "claude-sonnet-4-5",
    "heavy_route": "jerry"
  }
}
```

With this config:
- Short tasks (≤ 1000 estimated tokens): Haiku (~$0.001)
- Standard tasks: Sonnet (~$0.01)
- Heavy/GPU tasks: routed to H2 at $0.00

### Local-first routing

To always prefer H2's local models and only fall back to cloud:

```json
{
  "cost_routing": {
    "prefer_local": true,
    "local_fallback_threshold_tokens": 50000,
    "cloud_fallback_provider": "anthropic",
    "cloud_fallback_model": "claude-sonnet-4-5"
  }
}
```

This routes everything to H2. If H2 is offline and WOL fails within the timeout, it falls back to cloud.

---

## Budget alerts

Set a daily budget limit to get notified before you overspend:

```json
{
  "budget": {
    "daily_limit_usd": 1.00,
    "alert_at_pct": 80
  }
}
```

When 80% of the daily limit is reached, H1 logs a warning and can optionally block further cloud tasks:

```bash
$ hh send "complex reasoning task"
⚠️  Daily budget 82% used ($0.82/$1.00).
   Routing to H2 (local) instead of cloud.
→ Task dispatched to h2-home (Ollama/mistral)
```

---

## Per-peer breakdown

```bash
hh budget --peer h2-home --week
```

```
Budget — h2-home (last 7 days)
──────────────────────────────────
Tasks:    47
Tokens:   1.2M in / 210k out
Cost:     $0.00 (all local)
Models:   mistral (34), llama3.2 (8), codellama (5)
```

---

## Resetting budget data

Budget data lives in task state files. To reset:

```bash
# Archive old tasks (don't delete — you might want them)
mkdir ~/.his-and-hers/tasks-archive
mv ~/.his-and-hers/tasks/task_* ~/.his-and-hers/tasks-archive/

# Or start fresh (destructive)
rm ~/.his-and-hers/tasks/task_*
```
