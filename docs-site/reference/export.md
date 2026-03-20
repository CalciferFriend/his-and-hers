# `cofounder export`

Export task history to a Markdown, CSV, or JSON report. Useful for sharing what your H2 node has been doing, archiving completed records, or feeding data into external tools.

## Synopsis

```
cofounder export [options]
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--format <fmt>` | `markdown` | Output format: `markdown`, `csv`, or `json` |
| `--out <path>` | stdout | Write output to a file instead of printing |
| `--since <duration>` | *(all time)* | Only include tasks created within the window (e.g. `7d`, `24h`, `30m`) |
| `--status <status>` | *(all)* | Filter by task status: `completed`, `failed`, `timeout`, `cancelled`, `pending`, `running` |
| `--peer <name>` | *(all)* | Filter by peer name (case-insensitive substring match) |
| `--no-output` | *(include output)* | Omit result text from the report (produces a shorter, shareable summary) |

## Formats

### `markdown` (default)

Generates a human-readable Markdown report with a summary table and one section per task. Ideal for GitHub comments, docs, and sharing with teammates.

```
cofounder export                          # print to stdout
cofounder export --out report.md          # write to file
```

Report structure:
- **Header** — generation timestamp, peers
- **Summary table** — total tasks, breakdown by status, total cost/tokens/compute time
- **Per-task entries** — ID, objective, peer, status, duration, tokens, cost, output (truncated at 500 chars)

### `csv`

A comma-separated table suitable for spreadsheets, `awk`, or `pandas`.

```
cofounder export --format csv
cofounder export --format csv --out tasks.csv
```

Columns: `id`, `status`, `peer`, `objective`, `created_at`, `updated_at`, `duration_ms`, `tokens_used`, `cost_usd`, `success`, `artifacts`, *(optional)* `output`

### `json`

A JSON object with a `summary` block and a `tasks` array. Same shape as `cofounder logs --json` but richer — includes the full `summary` stats block.

```
cofounder export --format json
cofounder export --format json | jq '.summary.totalCostUsd'
```

## Usage examples

```bash
# Full markdown report for the last 7 days
cofounder export --since 7d

# Only completed tasks, no result text
cofounder export --status completed --no-output

# CSV of everything GLaDOS has processed
cofounder export --format csv --peer GLaDOS --out gladys-tasks.csv

# JSON pipe into another tool
cofounder export --format json | jq '[.tasks[] | select(.status=="failed")]'

# Write a weekly report file
cofounder export --since 7d --out "report-$(date +%Y-%m-%d).md"
```

## Duration format

The `--since` flag accepts a number followed by a unit:

| Suffix | Unit |
|--------|------|
| `s` | seconds |
| `m` | minutes |
| `h` | hours |
| `d` | days |
| `w` | weeks |

Examples: `30m`, `12h`, `7d`, `2w`

## Status icons

The Markdown report uses icons to make statuses easy to scan:

| Icon | Status |
|------|--------|
| ✓ | completed |
| ✗ | failed |
| ⏱ | timeout |
| ⊘ | cancelled |
| ⏳ | pending |
| ⚡ | running |

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Export completed successfully |
| `1` | Unknown format flag or file write error |

## See also

- [`cofounder logs`](/reference/logs) — interactive task history viewer with `--follow` and `--output`
- [`cofounder budget`](/reference/budget) — cost tracking and cloud/local spend breakdown
- [`cofounder prune`](/reference/prune) — remove stale task state files
