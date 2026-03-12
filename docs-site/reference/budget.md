# `hh budget` — Reference

View cost tracking by time period, provider, model, or peer.

---

## Synopsis

```bash
hh budget [flags]
```

---

## Flags

| Flag | Description |
|------|-------------|
| `--today` | Today's costs (default) |
| `--week` | Last 7 days |
| `--month` | Current calendar month |
| `--all` | All time |
| `--since <date>` | Costs since a specific date (YYYY-MM-DD) |
| `--tasks` | Per-task cost breakdown |
| `--peer <name>` | Filter by peer |
| `--provider <name>` | Filter by provider (anthropic, openai, ollama) |
| `--json` | Machine-readable JSON output |

---

## Default output (today)

```bash
$ hh budget
```

```
Budget — today (Thu Mar 12)
───────────────────────────────────────────────────────────
Cloud tokens:   42,831 in / 8,204 out
Cloud cost:     $0.18
Local tokens:   284,900 in / 61,200 out
Local cost:     $0.00
Local savings:  ~$4.27  (vs. claude-sonnet-4-5 pricing)

Tasks run:      23  (18 cloud · 5 local)
Avg cost/task:  $0.008 (cloud)
───────────────────────────────────────────────────────────
Routing tip: 5 tasks routed to cloud could have run on H2.
             Try: hh send "..." --auto (uses local when capable)
```

---

## `--tasks` output

```bash
$ hh budget --tasks
```

```
Per-task breakdown (today)
──────────────────────────────────────────────────────────────────
task_01j8g1fk  ollama/mistral    "summarize the repo README"       $0.00   h2-home
task_01j8g0xq  claude-sonnet     "write unit tests for auth.ts"    $0.04   cloud (H1)
task_01j8fzq7  claude-haiku      "translate doc to French"         $0.01   cloud (H1)
task_01j8fzp1  ollama/llama3.2   "embed document corpus"           $0.00   h2-pi
task_01j8fzk3  claude-sonnet     "generate test plan for v2"       $0.08   cloud (H1)
──────────────────────────────────────────────────────────────────
Total: $0.13
```

---

## Weekly output

```bash
$ hh budget --week
```

```
Budget — last 7 days
───────────────────────────────────────────────────────────
Cloud cost:     $1.24
Local cost:     $0.00
Local savings:  ~$28.40

Daily breakdown:
  Thu Mar 12   $0.18   (23 tasks)
  Wed Mar 11   $0.22   (31 tasks)
  Tue Mar 10   $0.15   (18 tasks)
  Mon Mar 09   $0.31   (42 tasks)
  Sun Mar 08   $0.08   (9 tasks)
  Sat Mar 07   $0.20   (27 tasks)
  Fri Mar 06   $0.10   (14 tasks)
───────────────────────────────────────────────────────────
Total:          $1.24  (164 tasks)
```

---

## JSON output

```bash
$ hh budget --json
```

```json
{
  "period": "today",
  "period_start": "2026-03-12T00:00:00Z",
  "period_end": "2026-03-12T23:59:59Z",
  "cloud_cost_usd": 0.18,
  "local_cost_usd": 0.00,
  "local_savings_estimate_usd": 4.27,
  "cloud_tokens": {
    "input": 42831,
    "output": 8204
  },
  "local_tokens": {
    "input": 284900,
    "output": 61200
  },
  "task_count": 23,
  "cloud_task_count": 18,
  "local_task_count": 5,
  "by_provider": {
    "anthropic": { "cost_usd": 0.12, "tasks": 14, "tokens_in": 38000, "tokens_out": 7100 },
    "openai":    { "cost_usd": 0.06, "tasks": 4,  "tokens_in": 4831,  "tokens_out": 1104 },
    "ollama":    { "cost_usd": 0.00, "tasks": 5,  "tokens_in": 284900, "tokens_out": 61200 }
  },
  "by_peer": {
    "h2-home": { "cost_usd": 0.00, "tasks": 3 },
    "h2-pi":   { "cost_usd": 0.00, "tasks": 2 },
    "cloud":      { "cost_usd": 0.18, "tasks": 18 }
  }
}
```

---

## Per-peer budget

```bash
$ hh budget --peer h2-home --week
```

```
Budget — h2-home (last 7 days)
──────────────────────────────────────────────
Tasks:    47
Tokens:   1.2M in / 210k out
Cost:     $0.00 (all local)
Models:   mistral:7b (34), llama3.2:3b (8), codellama:7b (5)
──────────────────────────────────────────────
```

---

## Pricing reference

Built-in pricing tables (used for cost calculation):

| Provider | Model | $/1M input | $/1M output |
|----------|-------|------------|-------------|
| Anthropic | claude-haiku-3-5 | $0.80 | $4.00 |
| Anthropic | claude-sonnet-4-5 | $3.00 | $15.00 |
| Anthropic | claude-opus-4 | $15.00 | $75.00 |
| OpenAI | gpt-4o | $2.50 | $10.00 |
| OpenAI | gpt-4o-mini | $0.15 | $0.60 |
| OpenAI | o3-mini | $1.10 | $4.40 |
| Ollama (any) | — | $0.00 | $0.00 |
| LM Studio | — | $0.00 | $0.00 |

Prices are baked into the binary and updated with releases. For the latest prices, check the provider's pricing page.

---

## See also

- [Budget guide](/guide/budget) — cost routing, budget alerts, local-first config
- [hh logs](/reference/logs) — per-task detail including cost
