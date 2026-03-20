# `cofounder schedule` — Reference

Register recurring tasks that run automatically on a cron schedule and are
delegated to your H2 peer.

---

## Synopsis

```bash
cofounder schedule <subcommand> [flags]
```

---

## Subcommands

| Subcommand | Description |
|------------|-------------|
| `add` | Register a new recurring schedule |
| `list` | Show all schedules with next-run time |
| `remove <id>` | Unregister a schedule and remove its crontab entry |
| `enable <id>` | Re-enable a disabled schedule |
| `disable <id>` | Pause a schedule without removing it |
| `run <id>` | Trigger a schedule immediately (manual fire) |

---

## `cofounder schedule add`

```bash
cofounder schedule add --cron "<expr>" "<task>" [flags]
```

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--cron <expr>` | *(required)* | Standard 5-field cron expression |
| `--peer <name>` | auto | Target a specific H2 by name |
| `--name <label>` | *(task text)* | Human-readable label |
| `--latent` | false | Use latent communication if peer supports it |

### Cron expression format

```
minute  hour  day  month  weekday
  *      *     *     *       *
```

| Example | Meaning |
|---------|---------|
| `0 2 * * *` | Every day at 02:00 |
| `0 9 * * 1` | Every Monday at 09:00 |
| `*/30 * * * *` | Every 30 minutes |
| `0 8 * * 1-5` | Weekdays at 08:00 |

### Example

```bash
# Generate a daily summary every morning
cofounder schedule add --cron "0 8 * * *" "Generate a project status summary and save to ~/summaries/"

# Weekly code review — target a specific peer
cofounder schedule add --cron "0 10 * * 1" "Review the git diff from the last 7 days and suggest improvements" --peer h2-home --name "weekly-review"

# Every 30 minutes — lightweight local task
cofounder schedule add --cron "*/30 * * * *" "Check disk usage and alert if above 90%" --peer h2-home
```

### Output

```
◆  Adding scheduled task

✓ Crontab entry installed
  Schedule ID: a7f3c2b1 (full: a7f3c2b1-9e4d-4f2a-b8c1-0d3e5f6a7b8c)
  Cron:        0 8 * * *
  Task:        Generate a project status summary and save to ~/summaries/
  Peer:        auto
  Next run:    Sat Mar 14 08:00:00 UTC 2026

◆  Schedule added. View all: cofounder schedule list
```

---

## `cofounder schedule list`

```bash
cofounder schedule list [--json]
```

```
Schedules (3)
────────────────────────────────────────────────────────────────────
  a7f3c2b1  ● enabled   "daily-summary"         0 8 * * *    next: in 21h 40m
  c4d5e6f7  ● enabled   "weekly-review"         0 10 * * 1   next: in 6d 23h
  b8a9c0d1  ○ disabled  "disk-check"            */30 * * * * next: —
────────────────────────────────────────────────────────────────────
```

### JSON output

```bash
cofounder schedule list --json
```

```json
[
  {
    "id": "a7f3c2b1-...",
    "name": "daily-summary",
    "cron": "0 8 * * *",
    "task": "Generate a project status summary...",
    "peer": null,
    "latent": false,
    "enabled": true,
    "created_at": "2026-03-13T10:19:00Z",
    "last_run": null,
    "next_run": "2026-03-14T08:00:00Z"
  }
]
```

---

## `cofounder schedule remove <id>`

Remove a schedule and uninstall its crontab entry. Accepts a full UUID or
a short prefix (first 8 characters, as shown in `list`).

```bash
cofounder schedule remove a7f3c2b1
```

---

## `cofounder schedule enable / disable <id>`

Pause or resume a schedule without removing it. Disabling removes the crontab
entry but keeps the schedule in `schedules.json` so it can be re-enabled later.

```bash
cofounder schedule disable b8a9c0d1
cofounder schedule enable  b8a9c0d1
```

---

## `cofounder schedule run <id>`

Immediately fire a schedule as if its cron time had arrived. Updates `last_run`
and delegates the task via `cofounder send`. Useful for testing.

```bash
cofounder schedule run a7f3c2b1
```

---

## Storage

Schedules are persisted at `~/.cofounder/schedules.json`. Logs from cron
executions are written to `~/.cofounder/schedule-logs/<id>.log`.

---

## How it works

`cofounder schedule add` installs a crontab entry of the form:

```
0 8 * * *  cofounder send "Generate a project status summary..." >> ~/.cofounder/schedule-logs/<id>.log 2>&1
# HH_SCHEDULE_ID=a7f3c2b1-...
```

The comment line is used by `cofounder schedule remove` / `disable` to find and
remove the entry without touching your other crontab rules.

---

## See also

- [Scheduling guide](/guide/scheduling) — use cases, tips, and best practices
- [cofounder send](/reference/send) — manual task delegation
- [cofounder logs](/reference/logs) — view task history from scheduled runs
