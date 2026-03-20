# Live Streaming & Notifications

While `cofounder send --wait` has always supported blocking until a result arrives,
you now also get **live partial output** as H2 works and **webhook notifications**
when a task finishes — no polling, no more staring at a spinner.

---

## Live streaming

When you run `cofounder send --wait`, cofounder automatically starts a streaming
server on H1 before dispatching the task. H2's `cofounder watch` executor streams
stdout chunks back in real-time so you can watch progress as it happens.

```bash
$ cofounder send "refactor auth.ts to use JWT" --wait
[1/4] Waking h2-home...
[2/4] Sending task...
[3/4] Waiting for result (streaming enabled)

Reading auth.ts... done.
Identified 3 issues:
  - Session token stored in localStorage (XSS risk)
  - No expiry on tokens
  - refresh_token not invalidated on logout
Rewriting...
```

No extra flags needed. Streaming is **on by default** whenever `--wait` is set
and H2 is running a recent `cofounder watch` version.

### How it works under the hood

1. H1 starts an SSE chunk-receiver on an ephemeral port (bound to Tailscale IP)
2. H1 includes `HH-Stream-URL` and `HH-Stream-Token` headers in the wake message
3. H2's `cofounder watch` executor pipes stdout through `createChunkStreamer`, which
   POSTs each chunk to H1 with a sequence number
4. H1 displays chunks in real-time; the stream server auto-closes on `done: true`
5. The full result is still delivered via the `/result` webhook — streaming is
   additive, not a replacement

If the stream server fails to bind (port conflict, network block), `cofounder send`
silently degrades to the polling fallback. You won't see live output, but the
task still completes normally.

### Disabling streaming

Streaming is tied to `--wait` — it only runs when you're waiting for a result.
Fire-and-forget sends (`cofounder send` without `--wait`) never start a stream server.

---

## Webhook notifications

Get notified when a task completes — even if you're not watching the terminal.
Works with Discord, Slack, and any generic HTTP webhook.

### Usage

```bash
# Notify on task completion
cofounder send "train overnight batch" --notify https://discord.com/api/webhooks/...

# Combine with --wait for both live output and a completion ping
cofounder send "long GPU task" --wait --notify https://hooks.slack.com/services/...

# With scheduled tasks
cofounder schedule add --cron "0 2 * * *" "nightly embeddings refresh" \
  --notify https://discord.com/api/webhooks/...
```

### Discord

Delivers a rich embed with colour-coded status, peer name, duration, and
truncated output:

```
✅  Task complete — h2-home
"train overnight batch"
Duration: 4m 12s · Cost: $0.00 (local)
[Output preview...]
```

Red embed for failures, green for success.

### Slack

Delivers a Block Kit message with the same fields.

### Generic webhook

Any other URL receives a JSON `POST`:

```json
{
  "event": "task_complete",
  "task_id": "task_01j8fzq7r4",
  "task": "train overnight batch",
  "success": true,
  "output": "Processed 128,432 records in 4m 12s...",
  "peer": "h2-home",
  "duration_ms": 252000,
  "cost_usd": 0,
  "timestamp": "2026-03-13T06:15:00Z"
}
```

### Error handling

Notification failures are **soft-logged and never throw**. A failed Discord
webhook will print a warning but won't fail the task or affect the result.

---

## Scheduled task notifications

Webhook URLs are stored in `~/.cofounder/schedules.json` and fired
automatically every time the schedule runs. Update a schedule's webhook:

```bash
# Remove and re-add with new webhook URL
cofounder schedule remove <id>
cofounder schedule add --cron "0 2 * * *" "nightly task" --notify <new-url>
```

---

## Sequence diagram

```
H1 (cofounder send --wait --notify <url>)      H2 (cofounder watch)
────────────────────────────────────     ─────────────
startStreamServer() → :39200/stream
buildWakeText() includes:
  HH-Stream-URL: http://h1:39200/stream
  HH-Stream-Token: <tok>
  HH-Result-Webhook: http://h1:39201/result
wakeAgent(GLaDOS) ──────────────────────► receive wake message
                                          executor spawned
                         chunk POST ◄──── stdout → postChunk() seq=0
display "Reading auth.ts..."
                         chunk POST ◄──── seq=1
display "Identified 3 issues..."
                                          ...
                         chunk POST ◄──── done:true
stream server closes
                   result webhook POST ◄── cofounder result <id> "..."
task complete
deliverNotification() ──────────────────► Discord/Slack/generic webhook
```

---

## Requirements

- H1: `cofounder` ≥ 0.1.0
- H2: `cofounder` ≥ 0.1.0 running `cofounder watch` (streaming env vars are auto-injected)
- Network: H2 must be able to reach H1's Tailscale IP on the ephemeral stream port
  (typically in the 30000–65535 range; firewall rules may be needed in strict setups)
