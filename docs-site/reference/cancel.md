# `cofounder cancel`

Mark a pending or running task as cancelled. Useful when you sent the wrong task, a task is stuck pending because H2 never woke, or you want to clean up the queue before a replay.

Only `pending` and `running` tasks can be cancelled by default — completed, failed, and timed-out tasks are already terminal. Use `--force` to override this guard.

## Usage

```bash
cofounder cancel <id>
cofounder cancel --all-pending
```

`<id>` is a task ID or unambiguous prefix (from `cofounder logs`).

## Flags

| Flag | Description |
|------|-------------|
| `--force` | Cancel even if the task is already in a terminal state |
| `--all-pending` | Cancel every pending task at once |
| `--json` | Machine-readable JSON output |

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Cancelled successfully (or `--all-pending` with ≥1 task cancelled) |
| `1` | Task not found, already terminal (without `--force`), or no pending tasks |

## Examples

```bash
# Cancel a specific task
cofounder cancel abc123

# Cancel even if it's already failed/completed
cofounder cancel abc123 --force

# Nuke the whole pending queue
cofounder cancel --all-pending

# Machine-readable confirmation
cofounder cancel abc123 --json
```

## Notes

- Cancelling does not interrupt an already-running executor on H2; it only marks the task cancelled on H1.
- Cancelled tasks still appear in `cofounder logs` with `[cancelled]` status.
- To retry after cancelling, use `cofounder replay <id>`.

## See also

- [`cofounder replay`](/reference/replay) — re-send a task after failure or cancellation
- [`cofounder logs`](/reference/logs) — view and filter task history
- [`cofounder send`](/reference/send) — send a new task
