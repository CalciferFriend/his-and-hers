# `cofounder watch`

H2-side task listener daemon. Polls the local task state directory for pending tasks, dispatches them to a configured executor, and writes results back to H1 (via webhook or SSH).

Typically started at H2 boot time via `start-cofounder.bat` or a Scheduled Task.

## Usage

```bash
cofounder watch
cofounder watch --exec "node run-task.js"
cofounder watch --exec "node run-task.js" --serve-capabilities
cofounder watch --interval 10
cofounder watch --once
cofounder watch --dry-run
cofounder watch --json
```

## Flags

| Flag | Description |
|------|-------------|
| `--exec <cmd>` | Command to run for each pending task (receives task JSON on stdin) |
| `--interval <secs>` | Poll interval in seconds (default: 5) |
| `--once` | Single-pass — detect tasks, dispatch, then exit |
| `--dry-run` | Detect pending tasks without executing or marking them |
| `--json` | Machine-readable JSON output (one line per event) |
| `--serve-capabilities` | Also start the `/capabilities` HTTP endpoint (ROADMAP 3b) |
| `--serve-capabilities <port>` | Serve capabilities on a specific port (default: gateway port from config) |

## How it works

```
H1 (Calcifer 🔥)                          H2 (GLaDOS 🤖)
─────────────────                          ─────────────────
cofounder send "summarise this file" →           ← wakeAgent injects task into state dir
                                           cofounder watch sees pending task
                                           → spawns executor with task JSON
                                           → executor writes output to stdout
                                           cofounder result <id> "<output>"
                                           → webhook POST / SSH back to H1
H1: cofounder send --wait resolves ✓
```

## Executor contract

Set `--exec <cmd>` to a command that:

- Receives the full task JSON object on **stdin**
- Writes its result text to **stdout**
- Exits `0` on success, non-zero on failure

Environment variables injected into the executor process:

| Variable | Value |
|----------|-------|
| `HH_TASK_ID` | Task UUID |
| `HH_TASK_OBJECTIVE` | Task description string |
| `HH_TASK_FROM` | Sender node name |
| `HH_STREAM_URL` | H1 SSE chunk receiver URL (if streaming enabled) |
| `HH_STREAM_TOKEN` | Auth token for the SSE receiver |

### Example executor (Node.js)

```js
// run-task.js
const chunks = [];
process.stdin.on('data', d => chunks.push(d));
process.stdin.on('end', async () => {
  const task = JSON.parse(Buffer.concat(chunks).toString());
  const result = await myModel.complete(task.objective);
  process.stdout.write(result);
});
```

## No executor (default)

If `--exec` is not set, `cofounder watch` marks tasks as `running` and prints them to stdout. Useful for manual testing or custom shell pipelines:

```bash
# Pipe tasks to a custom handler
cofounder watch --json | jq -r '.task.objective' | xargs -I{} process-task {}
```

## Capabilities server

`--serve-capabilities` starts an HTTP server (same port as the gateway) that serves H2's capability report:

```
GET /capabilities
X-HH-Token: <gateway_token>
→ returns ~/.cofounder/capabilities.json
```

H1 fetches this automatically via `cofounder capabilities fetch`. Add to `start-cofounder.bat`:

```bat
cofounder watch --exec "node run-task.js" --serve-capabilities
```

## Windows startup

On H2 (Windows), `cofounder watch` is typically started via a Scheduled Task or `start-cofounder.bat`:

```bat
@echo off
start "" /B openclaw gateway start
timeout /t 3
cofounder watch --exec "node %USERPROFILE%\.cofounder\run-task.js" --serve-capabilities
```

The `cofounder onboard` wizard writes `start-cofounder.bat` and registers the Scheduled Task automatically.

## Streaming support

When H1 sends a task with `--notify`, the wake message includes `HH_STREAM_URL` and `HH_STREAM_TOKEN`. The executor can stream partial output using `cofounder watch`'s built-in chunk poster, or by calling `createChunkStreamer()` from `@cofounder/core` directly. H1 displays chunks live in the terminal as they arrive.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Normal exit (`--once` or signal) |
| `1` | Config error or executor crash |

## See also

- [`cofounder result`](/reference/result) — manually write a task result
- [`cofounder send`](/reference/send) — send a task from H1 to H2
- [`cofounder status`](/reference/status) — check peer health and last heartbeat
- [Live streaming guide](/guide/streaming)
