# `cofounder notify` — Reference

Manage **persistent notification webhooks** that fire automatically on every task
completion — no `--notify` flag required on each `cofounder send` invocation.

Supports Discord, Slack, and any generic HTTPS endpoint.

---

## Synopsis

```bash
cofounder notify <subcommand> [flags]
```

---

## Subcommands

| Subcommand | Description |
|------------|-------------|
| `add <url>` | Register a new webhook |
| `list` | Show all registered webhooks |
| `remove <id>` | Unregister a webhook by ID prefix |
| `test [id]` | Fire a test payload to all webhooks (or one by ID prefix) |

---

## `cofounder notify add`

```bash
cofounder notify add <url> [--name <label>] [--on all|complete|failure]
```

Register a webhook URL. Once added, it fires automatically after every task
result that matches the event filter — success, failure, or both.

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--name <label>` | *(url)* | Human-readable label shown in `cofounder notify list` |
| `--on <filter>` | `all` | Event filter: `all`, `complete`, or `failure` |

### Examples

```bash
# Discord channel — fires on every task completion
cofounder notify add https://discord.com/api/webhooks/123/abc --name "Discord #alerts"

# Slack incoming webhook — fires only on failures
cofounder notify add https://hooks.slack.com/services/T00/B00/xxx --on failure

# Generic HTTPS endpoint — fires only on successes
cofounder notify add https://my-server.com/hook --on complete --name "Backend hook"
```

### Event filters

| Filter | When it fires |
|--------|--------------|
| `all` | Every task completion, success or failure *(default)* |
| `complete` | Only successful task results |
| `failure` | Only failed or timed-out tasks |

---

## `cofounder notify list`

```bash
cofounder notify list
```

Print all registered webhooks with their ID prefix, label, platform type,
event filter, and registration date.

```
  Notification webhooks (2)

  a1b2c3d4  Discord #alerts [Discord]  on:all  added: 3/14/2026
             https://discord.com/api/webhooks/123/abc

  e5f6a7b8  (unnamed) [Slack]  on:failure  added: 3/14/2026
             https://hooks.slack.com/services/T00/B00/xxx
```

---

## `cofounder notify remove`

```bash
cofounder notify remove <id>
```

Unregister a webhook by its ID prefix (4+ characters is usually enough to be
unambiguous). Get the prefix from `cofounder notify list`.

```bash
cofounder notify remove a1b2
# ✓ Webhook a1b2 removed.
```

---

## `cofounder notify test`

```bash
cofounder notify test [id]
```

Fire a synthetic "test" payload to all registered webhooks, or to a single
webhook by ID prefix. Useful for verifying URLs are correct before you rely
on them for real task results.

```bash
cofounder notify test          # test all webhooks
cofounder notify test a1b2     # test one by ID prefix
```

Exit code is `0` if all deliveries succeed, `1` if any fail.

---

## Storage

Webhooks are stored in `~/.cofounder/notify-webhooks.json` (mode 0644 — not
a secret file). The file is created automatically on first `cofounder notify add`.

```json
[
  {
    "id": "a1b2c3d4-...",
    "url": "https://discord.com/api/webhooks/123/abc",
    "name": "Discord #alerts",
    "events": "all",
    "created_at": "2026-03-14T09:00:00.000Z"
  }
]
```

---

## Integration with `cofounder send`

When `cofounder send --wait` resolves a task result, it automatically fires all
persistent webhooks that match the event type **in addition to** any ad-hoc
`--notify` URL passed on the command line.

```
cofounder send --wait "Generate a report"
   ↓ task delegated to H2
   ↓ result received
   → fires --notify URL (if provided)
   → fires all persistent webhooks matching 'all' or 'complete'
```

This means you can set up a persistent Discord or Slack webhook once and
never think about it again. Every future `cofounder send --wait` will notify you
automatically.

---

## Platform payload formats

### Discord

Sends a rich embed with colour-coded status, peer name, task text, duration,
and cost. Green embed for success, red for failure.

### Slack

Sends a Block Kit message with a header block and context fields for peer,
duration, and cost.

### Generic HTTPS

Sends a JSON POST body:

```json
{
  "task": "Generate a report",
  "taskId": "abc123...",
  "success": true,
  "output": "Here is the report...",
  "peer": "glados",
  "durationMs": 12400,
  "costUsd": 0.0024
}
```

---

## See also

- [`cofounder send`](/reference/send) — delegate tasks (uses persistent webhooks automatically)
- [`cofounder schedule`](/reference/schedule) — recurring task delegation
- [`cofounder watch`](/reference/watch) — H2-side task listener
