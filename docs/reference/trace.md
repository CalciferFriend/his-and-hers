# `cofounder trace` — Execution Trace Viewer

`cofounder trace` displays structured per-step timelines for `cofounder send` pipeline runs.
Each trace captures the full lifecycle of a task from preflight checks through
result delivery, with per-step durations and error details.

Traces are especially useful for debugging Windows boot-chain latency, identifying
where WOL wake time is spent, and diagnosing gateway connectivity issues.

## Usage

```bash
cofounder trace <task_id>                    # Show timeline for a specific task
cofounder trace list                         # List all stored traces
cofounder trace list --json                  # Machine-readable list
cofounder trace show <task_id>               # Explicit show (same as bare task_id)
cofounder trace show <task_id> --json        # Full trace JSON
cofounder trace clear <task_id>              # Remove a single trace
cofounder trace clear --force                # Wipe all traces without prompting
```

## What Gets Traced

Each trace records a sequence of `TraceEvent` entries:

| Step | Description |
|------|-------------|
| `preflight_ping` | Tailscale reachability check (RTT ms) |
| `preflight_gateway` | Gateway `/health` check |
| `wol_wake` | WOL magic packet sent (if peer was offline) |
| `gateway_connect` | WebSocket connection established |
| `gateway_challenge` | `connect.challenge` received |
| `gateway_auth` | Auth handshake complete |
| `gateway_wake` | Wake message injected (ACK received) |
| `result_server_start` | H1 webhook result listener started |
| `stream_server_start` | H1 SSE stream server started |
| `stream_chunk` | Streaming partial chunk received |
| `result_received` | Result delivered (webhook or poll) |
| `task_complete` | Full pipeline done |

## Example Output

```
Task abc123f  →  glados  ·  "review PR #42"
Started 10:24:31 UTC  ·  total 14.3s

  ✓  preflight_ping        12ms
  ✓  preflight_gateway     8ms
  ✓  wol_wake              2.1s   {broadcast: "255.255.255.255:9"}
  ✓  gateway_connect       210ms
  ✓  gateway_challenge     4ms
  ✓  gateway_auth          18ms
  ✓  gateway_wake          34ms
  ✓  result_server_start   2ms
  ✓  stream_server_start   3ms
  ✓  stream_chunk          ×6 chunks (first: 8.4s, last: 9.1s)
  ✓  result_received       11.9s  {method: "webhook"}
  ✓  task_complete         14.3s
```

## `cofounder trace list`

```
  ID         Peer     Objective                    Steps  Duration  Status
  abc123f    glados   review PR #42                  12    14.3s     ok
  def456a    glados   summarise logs.txt             11     6.1s     ok
  789bce1    glados   run benchmarks                  8     —        failed
```

Pass `--json` for machine-readable output:

```json
[
  {
    "task_id": "abc123f...",
    "peer": "glados",
    "objective": "review PR #42",
    "started_at": "2026-03-16T10:24:31.000Z",
    "ended_at": "2026-03-16T10:24:45.300Z",
    "total_ms": 14300,
    "events": [...]
  }
]
```

## `cofounder trace show <id>` / `--json`

`--json` outputs the full `TraceLog` object including every `TraceEvent`
with `step`, `started_at`, `duration_ms`, `ok`, `error`, and `meta` fields.

## `cofounder trace clear`

```bash
cofounder trace clear abc123f          # Remove one trace (prompts for confirmation)
cofounder trace clear --force          # Wipe everything without prompting
```

## Storage

Traces are stored at `~/.cofounder/traces/<task_id>.json` (one file per task).

Traces are **not** written automatically by default — `cofounder send` and the SDK
call `appendTraceEvent()` / `finalizeTrace()` when `--trace` instrumentation
is enabled or when `HH_TRACE=1` is set.

```bash
HH_TRACE=1 cofounder send "review this" --peer glados
cofounder trace <task_id>
```

## TypeScript API

```ts
import {
  loadTrace,
  listTraces,
  clearTrace,
  clearAllTraces,
  appendTraceEvent,
  finalizeTrace,
  formatStepLabel,
  renderBar,
} from "@cofounder/core";

const trace = await loadTrace(taskId);
console.log(trace.events);

// Append a step during a pipeline
await appendTraceEvent(taskId, {
  step: "preflight_ping",
  started_at: new Date().toISOString(),
  duration_ms: 12,
  ok: true,
  meta: { rtt_ms: 12 },
});

// Finalise when done
await finalizeTrace(taskId);
```

## Related

- [`cofounder send`](./send) — task dispatch (supports `HH_TRACE=1`)
- [`cofounder doctor`](./doctor) — health diagnostics (preflight checks)
- [`cofounder logs`](./logs) — task history viewer
- [`cofounder stats`](./stats) — analytics and heatmaps
