# `cofounder send` — Reference

Send a task to a H2 node. The core command you'll use most.

---

## Synopsis

```bash
cofounder send "<task>" [flags]
```

---

## Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--wait` | bool | false | Block until result received; print to stdout |
| `--peer <name>` | string | auto | Target a specific H2 by name |
| `--timeout <s>` | int | 300 | Max seconds to wait in `--wait` mode |
| `--attach <path>` | string | — | Attach a file (PDF, image, text, code) |
| `--no-wol` | bool | false | Don't send WOL if H2 is offline — fail immediately |
| `--auto` | bool | false | Use capability-based routing to pick best peer |
| `--context <text>` | string | auto | Override the context summary sent with the task |
| `--shutdown-after` | bool | false | Tell H2 to shut down after completing this task |
| `--notify <url>` | string | — | Webhook URL to notify on completion (Discord/Slack/generic) |
| `--json` | bool | false | Output task ID, peer, status as JSON |
| `--verbose` | bool | false | Show WOL steps, gateway calls, timing |

---

## Output

### Default (no `--wait`)

```bash
$ cofounder send "write a haiku about TCP/IP"
→ Task dispatched: task_01j8fzq7r4
  H2: h2-home (100.x.y.z)
  Status: queued
  Track: cofounder logs --task task_01j8fzq7r4
```

### With `--wait`

```bash
$ cofounder send "write a haiku about TCP/IP" --wait
Bits flow through the dark,
Each packet seeks its lost home—
Checksum finds the truth.
```

### With `--json`

```json
{
  "task_id": "task_01j8fzq7r4",
  "peer": "h2-home",
  "tailscale_ip": "100.x.y.z",
  "status": "queued",
  "dispatched_at": "2026-03-12T09:15:00Z"
}
```

---

## Message format

`cofounder send` builds a `CofounderMessage` with type `task`:

```json
{
  "version": "0.1.0",
  "id": "task_01j8fzq7r4",
  "from": "Calcifer",
  "to": "GLaDOS",
  "turn": 0,
  "type": "task",
  "payload": "write a haiku about TCP/IP",
  "context_summary": "Previous: wrote unit tests for auth module",
  "budget_remaining": null,
  "done": false,
  "wake_required": false,
  "shutdown_after": false,
  "timestamp": "2026-03-12T09:15:00.123Z"
}
```

---

## Task flow

```
1. Parse flags and task string
2. Load peer config (--peer, or auto-select)
3. Check H2 gateway health (GET /health)
4. If unhealthy + WOL configured: send magic packet, poll gateway
5. Build CofounderMessage, POST to H2 gateway
6. Write task state to ~/.cofounder/tasks/<task_id>.json
7. If --wait: poll task state every 2s until done:true
8. Print result (--wait) or task ID (default)
```

---

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Task dispatched (or completed, if `--wait`) |
| 1 | Config error (no peers configured, bad args) |
| 2 | H2 unreachable (no WOL, or WOL timeout exceeded) |
| 3 | Task failed (H2 returned error) |
| 4 | Timeout (`--wait` + `--timeout` exceeded) |

---

## Examples

```bash
# Basic send
cofounder send "summarize the attached PDF" --attach report.pdf

# Wait for result
cofounder send "translate this to French" --attach doc.txt --wait

# Target specific peer, wait, verbose
cofounder send "run the test suite" --peer h2-beast --wait --verbose

# Use capability routing
cofounder send "generate a product image" --auto --wait

# Fail fast if H2 is offline
cofounder send "quick code review" --no-wol --wait

# Schedule H2 to shut down after task
cofounder send "render overnight batch job" --peer h2-beast --shutdown-after --wait --timeout 7200

# JSON output for scripting
RESULT=$(cofounder send "what is 2+2" --wait --json)
echo $RESULT | jq .output
```

---

## Scripting with `cofounder send`

```bash
#!/bin/bash
# Process all PDFs in a directory
for pdf in ~/docs/*.pdf; do
  echo "Processing: $pdf"
  cofounder send "extract key facts and bullet-point summary" \
    --attach "$pdf" \
    --wait \
    --timeout 120 \
    >> ~/summaries.txt
done
```

---

## Live streaming

When `--wait` is set, `cofounder send` automatically starts a streaming chunk-receiver
on H1 before dispatching the task. H2's `cofounder watch` streams stdout chunks back
in real-time so you see partial output as H2 works — no spinner, no silence.

Streaming degrades silently if the server fails to bind. See the
[streaming guide](/guide/streaming) for details.

---

## Webhook notifications (`--notify`)

Deliver a completion ping to Discord, Slack, or any HTTP endpoint:

```bash
cofounder send "overnight training run" --notify https://discord.com/api/webhooks/...
cofounder send "long task" --wait --notify https://hooks.slack.com/services/...
```

- **Discord** — rich embed with colour-coded status, peer, duration, cost
- **Slack** — Block Kit message with the same fields
- **Generic** — JSON `POST` with `event`, `task_id`, `success`, `output`, `peer`, `duration_ms`, `cost_usd`, `timestamp`

Notification failures are soft-logged and never break the task.

---

## See also

- [Sending tasks guide](/guide/sending-tasks) — full walkthrough
- [Live streaming & notifications](/guide/streaming) — streaming + webhook details
- [cofounder logs](/reference/logs) — monitor task status
- [cofounder wake](/reference/wake) — manually wake H2
- [cofounder capabilities](/reference/capabilities) — understand routing decisions
