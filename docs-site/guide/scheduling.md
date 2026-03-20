# Scheduling recurring tasks

`cofounder schedule` lets you register tasks that automatically delegate to your H2 on
a cron schedule — so your heavy-compute work happens on the right machine at the
right time, without manual intervention.

---

## Quick start

```bash
# Generate a daily morning briefing
cofounder schedule add --cron "0 8 * * *" "Summarise yesterday's git commits and open GitHub issues"

# Weekly review every Monday
cofounder schedule add --cron "0 9 * * 1" "Review all TODOs in the codebase and output a prioritised list"

# Check available disk space every hour
cofounder schedule add --cron "0 * * * *" "Check disk usage on all mounted volumes and alert if any are above 85%"
```

That's it. `cofounder schedule add` installs a real crontab entry — no daemons, no
extra processes. The system cron fires `cofounder send` at the right time, which wakes
your H2 if needed and delegates the task.

---

## Viewing and managing schedules

```bash
cofounder schedule list              # all schedules + next-run time
cofounder schedule disable <id>      # pause without deleting
cofounder schedule enable  <id>      # resume
cofounder schedule remove  <id>      # delete + remove crontab entry
cofounder schedule run     <id>      # fire immediately (for testing)
```

Schedules are identified by a UUID; `list` shows the first 8 characters.

---

## Good use cases

| Pattern | Example task |
|---------|-------------|
| Daily digest | *"Summarise today's news in my focus areas and write to ~/daily/YYYY-MM-DD.md"* |
| Code maintenance | *"Run the test suite and open a GitHub issue if anything fails"* |
| Model fine-tuning | *"Process the documents in ~/unprocessed/ through the embedding pipeline"* |
| Cost check | *"Generate a weekly budget report and send it as a message"* |
| Batch processing | *"Convert all new images in ~/queue/ to WebP and move to ~/converted/"* |

---

## Targeting a specific peer

If you have multiple H2 nodes, use `--peer` to send to the right one:

```bash
# Image processing — target the machine with the GPU
cofounder schedule add \
  --cron "0 2 * * *" \
  --peer h2-home \
  "Process today's photos: resize, tag with CLIP, generate captions"

# Lightweight work — Pi is fine
cofounder schedule add \
  --cron "*/15 * * * *" \
  --peer h2-pi \
  "Check RSS feeds for new items and update ~/feeds/latest.json"
```

---

## Cron expression reference

```
minute  hour  day-of-month  month  day-of-week
  0-59  0-23       1-31      1-12       0-6 (Sun=0)
```

Handy shorthands:

| Expression | Runs |
|-----------|------|
| `0 8 * * *` | Every day at 08:00 |
| `0 8 * * 1-5` | Weekdays at 08:00 |
| `0 8 * * 0` | Sundays at 08:00 |
| `0 */4 * * *` | Every 4 hours |
| `*/30 * * * *` | Every 30 minutes |
| `0 0 1 * *` | First day of each month at midnight |

Tip: use [crontab.guru](https://crontab.guru) to validate expressions.

---

## Viewing schedule output

Each schedule's `cofounder send` output is logged to:

```
~/.cofounder/schedule-logs/<id>.log
```

To view task results interactively:

```bash
cofounder logs --follow            # live tail all tasks
cofounder logs --since 24h         # last 24 hours
cofounder logs --output            # include result text inline
```

---

## Tips

**Test before scheduling.** Run `cofounder send "<task>"` manually first to make sure
it works, then schedule it with `cofounder schedule add`.

**Use `cofounder schedule run <id>` to dry-run.** You can always fire a schedule
immediately to check it behaves correctly before the cron fires.

**Keep tasks self-contained.** Tasks can't have interactive back-and-forth —
they should produce a file, send a message, or update a resource autonomously.
Put output in `~/` paths your agent can find later.

**Watch your budget.** Frequent schedules on cloud providers add up.
Use `cofounder budget --week` to review. Route heavy recurring work to local H2:
`cofounder send --peer h2-home`.

---

## See also

- [`cofounder schedule` reference](/reference/schedule) — full flag and subcommand docs
- [`cofounder logs` reference](/reference/logs) — view task history
- [Budget guide](/guide/budget) — cost awareness for scheduled tasks
