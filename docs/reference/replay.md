# `cofounder replay`

Re-send a previously dispatched task with the same objective and constraints.
Useful when a task fails, times out, or you want to retry with a different peer.

```
cofounder replay <id>                 # replay by task ID (or prefix)
cofounder replay <id> --peer gpu      # override the target peer
cofounder replay <id> --wait          # block until result arrives
cofounder replay <id> --dry-run       # show what would be sent without sending
cofounder replay <id> --dry-run --json
```

The original task state is untouched — replay creates a **new task ID** so it
appears as a separate entry in `cofounder logs`.

---

## Arguments

| Argument | Description |
|----------|-------------|
| `<id>` | Task ID or unique prefix (at least 4 chars). Use `cofounder logs` to find IDs. |

---

## Flags

| Flag | Description |
|------|-------------|
| `--peer <name>` | Override the peer for this replay (default: use original peer) |
| `--wait` | Block until the replayed task completes and print the result |
| `--no-webhook` | Disable result webhook server; use polling only (--wait mode) |
| `--notify` | Post a notification when the result arrives |
| `--dry-run` | Print the task that would be sent without actually sending it |
| `--json` | Combine with `--dry-run` to emit the replay plan as JSON |

---

## Examples

**Replay a failed task:**

```sh
cofounder logs --status failed
# ✗ failed   b3e4a2f1  10m ago  → glados
#            Write unit tests for auth module

cofounder replay b3e4a2f1
```

**Retry on a different peer:**

```sh
cofounder replay b3e4a2f1 --peer piper
```

**Replay and wait for result:**

```sh
cofounder replay b3e4a2f1 --wait
```

Blocks until the new task completes and prints the output inline.

**Inspect what would be sent:**

```sh
cofounder replay b3e4a2f1 --dry-run
# Replay plan:
#   Original:  b3e4a2f1 (failed)
#   New task:  send "Write unit tests for auth module" to glados
```

---

## How it works

`cofounder replay` finds the original task by ID prefix, extracts the `objective`,
routing hint, and model constraints, then calls `cofounder send` internally with those
parameters. You get a fresh task with a new ID — the original record is left
intact as a historical reference.

---

## See also

- [`cofounder logs`](./logs.md) — find task IDs and see failure reasons
- [`cofounder send`](./cli.md) — send a new task from scratch
- [`cofounder cancel`](./cli.md) — cancel a pending or running task
