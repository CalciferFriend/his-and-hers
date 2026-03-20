# cofounder prune

Clean up stale task state files, retry records, and schedule logs from
`~/.cofounder/` to keep your local store tidy over time.

## Synopsis

```
cofounder prune [options]
```

## Options

| Flag | Default | Description |
|---|---|---|
| `--older-than <duration>` | `30d` | Prune files older than this age. Accepts `s`, `m`, `h`, `d`, `w` units (e.g. `7d`, `2w`, `48h`). |
| `--status <status>` | `all` | Which terminal statuses to target: `all`, `completed`, `failed`, `timeout`, `cancelled`. Active (`pending`, `running`) tasks are never pruned. |
| `--include-retry` | off | Also remove matching retry-state files in `~/.cofounder/retry/`. |
| `--include-logs` | off | Also truncate matching schedule log files in `~/.cofounder/schedule-logs/`. |
| `--dry-run` | off | Preview what would be removed — no files are actually deleted. |
| `--json` | off | Output a machine-readable JSON summary instead of the interactive UI. |
| `--force` | off | Skip the confirmation prompt (useful for cron/scripting). |

## Examples

```bash
# Default: preview completed/failed/timeout/cancelled tasks older than 30 days
cofounder prune --dry-run

# Delete old completed tasks, then confirm
cofounder prune

# Aggressively clean up everything older than a week, including retry files and logs
cofounder prune --older-than 7d --status all --include-retry --include-logs

# Only prune failed tasks older than 14 days, no prompt (good for cron)
cofounder prune --status failed --older-than 14d --force

# Machine-readable output for scripting
cofounder prune --dry-run --json | jq '.bytes_freed'
```

## Scheduled Pruning

Pair `cofounder prune` with `cofounder schedule` to run it automatically:

```bash
# Weekly cleanup every Sunday at 03:00
cofounder schedule add --cron "0 3 * * 0" "cofounder prune --older-than 7d --force"
```

Or add it directly to crontab for silent operation:

```
0 3 * * 0  cofounder prune --older-than 30d --force --json >> ~/.cofounder/prune.log 2>&1
```

## JSON Output

When `--json` is passed, `cofounder prune` writes a single JSON object to stdout:

```json
{
  "scanned": 42,
  "pruned": 8,
  "skipped": 34,
  "bytes_freed": 16384,
  "dry_run": false,
  "files": [
    {
      "path": "/home/user/.cofounder/state/tasks/abc123.json",
      "type": "task",
      "taskId": "abc123",
      "status": "completed",
      "age_days": 35.2,
      "bytes": 1024
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `scanned` | `number` | Total task files examined |
| `pruned` | `number` | Files removed (or would-remove in dry-run) |
| `skipped` | `number` | Files kept (too recent, wrong status, or active) |
| `bytes_freed` | `number` | Bytes reclaimed (or would-reclaim) |
| `dry_run` | `boolean` | Whether this was a dry run |
| `files` | `PrunedFile[]` | Details on each pruned file |

### `PrunedFile`

| Field | Type | Description |
|---|---|---|
| `path` | `string` | Absolute path of the removed/would-remove file |
| `type` | `"task" \| "retry" \| "log"` | File category |
| `taskId` | `string` | Task UUID |
| `status` | `TaskStatus?` | Task status at time of prune |
| `age_days` | `number` | Age in days (rounded to 1 decimal) |
| `bytes` | `number` | File size in bytes |

## Storage Layout

`cofounder prune` targets three directories under `~/.cofounder/`:

```
~/.cofounder/
├── state/tasks/       ← task JSON files (always targeted)
├── retry/             ← retry state (targeted with --include-retry)
└── schedule-logs/     ← schedule run logs (targeted with --include-logs)
```

Active tasks (`pending`, `running`) are **never** pruned regardless of age.

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | Success (including nothing-to-prune) |
| `1` | Error (bad flags, filesystem permission error) |
