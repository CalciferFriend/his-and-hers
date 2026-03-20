# Persistent Notifications

cofounder can notify you when a task completes — via Discord, Slack, or any
generic HTTP webhook. There are two levels of notification:

| Level | How | Fires on |
|-------|-----|----------|
| **Per-send** | `--notify <url>` flag | That invocation only |
| **Persistent** | `cofounder notify add <url>` | Every task, forever |

This guide covers the **persistent** registry. For per-send notifications see
[Live Streaming & Notifications](./streaming.md).

---

## Quick start

```bash
# Register a Discord webhook once
cofounder notify add https://discord.com/api/webhooks/1234/abc...

# Now every cofounder send --wait fires it automatically — no --notify needed
cofounder send "refactor auth.ts" --wait
```

That's it. You'll get a Discord ping when the task finishes, whether it succeeded
or failed.

---

## Managing webhooks

### Add a webhook

```bash
cofounder notify add <url> [--name <label>] [--events all|complete|failure]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--name <label>` | _(none)_ | Human-readable label, shown in `cofounder notify list` |
| `--events <filter>` | `all` | When to fire: `all`, `complete` (success only), or `failure` (errors only) |

**Examples:**

```bash
# Discord — all task completions
cofounder notify add https://discord.com/api/webhooks/1234/abc

# Slack — failures only, with a label
cofounder notify add https://hooks.slack.com/services/X/Y/Z \
  --name "slack-ops" \
  --events failure

# Generic endpoint — successes only
cofounder notify add https://myapp.com/hooks/hh \
  --name "app-api" \
  --events complete
```

### List registered webhooks

```bash
cofounder notify list
```

Output:

```
  id          name         events    url
  ─────────── ──────────── ──────── ──────────────────────────────────────────────
  a1b2c3d4    (none)       all       https://discord.com/api/webhooks/1234/abc...
  e5f6g7h8    slack-ops    failure   https://hooks.slack.com/services/X/Y/Z
```

### Remove a webhook

```bash
cofounder notify remove <id>
```

You only need to supply enough of the ID to be unambiguous (prefix matching):

```bash
cofounder notify remove a1b2
```

### Test a webhook

Send a synthetic test payload to verify the URL is reachable:

```bash
cofounder notify test <id>
# or test by URL directly:
cofounder notify test https://discord.com/api/webhooks/1234/abc
```

---

## Event filters

| Filter | Fires when |
|--------|-----------|
| `all` | Any task completion (success **or** failure) |
| `complete` | Task succeeded (`success: true`) |
| `failure` | Task failed or timed out (`success: false`) |

Use `failure` for alerting and `complete` for success tracking — or register
one webhook on `all` for a full audit trail.

---

## Platform payloads

### Discord

Delivers a rich embed:

```json
{
  "embeds": [{
    "title": "✅  Task complete — h2-home",
    "description": "\"refactor auth.ts to use JWT\"",
    "color": 3066993,
    "fields": [
      { "name": "Duration",  "value": "4m 12s",       "inline": true },
      { "name": "Cost",      "value": "$0.00 (local)", "inline": true },
      { "name": "Output",    "value": "Rewrote auth.ts with JWT…", "inline": false }
    ]
  }]
}
```

- Green embed (`#2ECC71`) for success, red (`#E74C3C`) for failure.
- Output is truncated to 1 000 characters to stay within Discord's embed limits.
- Detected by URL prefix: `https://discord.com/api/webhooks/`.

### Slack

Delivers a Block Kit message:

```json
{
  "blocks": [
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": ":white_check_mark: *Task complete — h2-home*\n\"refactor auth.ts\"" }
    },
    {
      "type": "context",
      "elements": [
        { "type": "mrkdwn", "text": "Duration: 4m 12s" },
        { "type": "mrkdwn", "text": "Cost: $0.00 (local)" }
      ]
    }
  ]
}
```

- Detected by URL prefix: `https://hooks.slack.com/services/`.

### Generic endpoint

All other URLs receive a flat JSON payload:

```json
{
  "task": "refactor auth.ts to use JWT",
  "task_id": "550e8400-...",
  "peer": "h2-home",
  "success": true,
  "output": "Rewrote auth.ts with JWT...",
  "duration_ms": 252000,
  "cost_usd": 0.00
}
```

Use this for n8n, Make, Zapier, or your own backend.

---

## Storage

Webhooks are stored in `~/.cofounder/notify-webhooks.json`. The file is
readable (0644) — it's not a secret. Webhook URLs may contain sensitive tokens;
treat the file accordingly.

```json
[
  {
    "id": "a1b2c3d4-...",
    "url": "https://discord.com/api/webhooks/1234/abc...",
    "events": "all",
    "created_at": "2026-03-14T09:00:00.000Z"
  }
]
```

---

## Integration with `cofounder send`

Persistent webhooks fire automatically when `cofounder send --wait` receives a result.
No extra flags needed. The flow:

```
cofounder send --wait
  → task delegated to H2
  → H2 runs executor
  → cofounder result <id> "output" (H2 side)
  → result webhook POST to H1
  → H1 marks task complete
  → H1 fires getActiveWebhooks() → deliverNotification() for each registered URL
```

Both persistent webhooks and the per-send `--notify` URL (if provided) are fired
in parallel on the same result. They don't interfere.

---

## Integration with `cofounder schedule`

Scheduled tasks also fire persistent webhooks on each run — no extra config
needed. The `--notify` flag on `cofounder schedule add` is for *additional* per-schedule
webhooks on top of the persistent registry.

```bash
# Both the persistent discord webhook AND this per-schedule slack URL will fire:
cofounder schedule add --cron "0 2 * * *" "nightly batch" \
  --notify https://hooks.slack.com/services/X/Y/Z
```

---

## Troubleshooting

**Webhooks aren't firing**

- Check that `cofounder send` is run with `--wait`. Fire-and-forget sends (`cofounder send`
  without `--wait`) don't wait for a result so notifications never fire.
- Confirm webhooks are registered: `cofounder notify list`
- Test the URL is reachable: `cofounder notify test <id>`

**Discord: "Invalid Webhook Token"**

The webhook URL is stale. Delete the webhook in Discord server settings and
re-create it, then `cofounder notify remove` the old one and `cofounder notify add` the new URL.

**Slack: 404 on webhook URL**

Slack webhook URLs can be revoked from the Slack app settings. Re-install the
Incoming Webhooks app or generate a new URL.

**Generic endpoint returns non-2xx**

`deliverNotification()` logs a warning but does not retry. If your endpoint is
unreliable, add idempotency handling on the receiver side — the payload includes
`task_id` as a stable deduplication key.
