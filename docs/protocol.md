# HHMessage Protocol Specification

Version: 0.1.0

## Overview

HHMessage is the open protocol envelope for cross-machine agent communication in his-and-hers. Every message between Tom and Jerry nodes is wrapped in this format.

## Message envelope

```typescript
interface HHMessage {
  version: string;           // Protocol version (semver)
  id: string;                // UUID v4
  from: string;              // Sender node name
  to: string;                // Recipient node name
  turn: number;              // Conversation turn counter (0-indexed)
  type: HHMessageType;       // Message type
  payload: string;           // Task description or result content
  context_summary: string | null;  // Background context for the recipient
  budget_remaining: number | null; // Token/cost budget remaining
  done: boolean;             // Whether this message completes the task
  wake_required: boolean;    // Tom sets true when Jerry needs waking first
  shutdown_after: boolean;   // Jerry should shut down after completing this task
  timestamp: string;         // ISO 8601 datetime
}
```

## Message types

| Type | Direction | Description |
|------|-----------|-------------|
| `task` | Tom → Jerry | New task delegation |
| `result` | Jerry → Tom | Task result (partial or final) |
| `heartbeat` | Either | Periodic liveness ping |
| `handoff` | Either | Structured task handoff with constraints |
| `wake` | Tom → Jerry | Wake signal (precedes task if Jerry is sleeping) |
| `error` | Either | Error report |

## Turn structure

```
Turn 0: Tom sends task/handoff
Turn 1: Jerry acknowledges receipt
Turn 2: Jerry sends partial result (done: false)
Turn N: Jerry sends final result (done: true)
```

Turns increment with each message in the conversation. A new task starts at turn 0.

## Completion signals

- `done: true` + `type: result` = task completed successfully
- `done: true` + `type: error` = task failed, no retry
- `done: false` + `type: result` = partial result, more messages coming

## Task handoff format

For structured delegation, use the HHHandoff schema:

```typescript
interface HHHandoff {
  task_id: string;           // UUID v4
  from_role: "tom" | "jerry";
  to_role: "tom" | "jerry";
  objective: string;         // Clear task description
  context: string;           // Background information
  constraints: string[];     // Rules and boundaries
  expected_output: string;   // What the result should look like
  timeout_seconds: number;   // Max execution time
  wake_if_sleeping: boolean; // Whether to WOL Jerry first
  shutdown_when_done: boolean;
}
```

## Heartbeat format

```typescript
interface HHHeartbeat {
  from: string;
  role: "tom" | "jerry";
  tailscale_ip: string;
  gateway_port: number;
  gateway_healthy: boolean;
  uptime_seconds: number;
  timestamp: string;
}
```

## Wake flow

1. Tom creates HHMessage with `wake_required: true`
2. Tom sends WOL magic packet to Jerry's MAC via UDP broadcast
3. Tom polls Jerry's Tailscale IP (ping every 2s, up to 60 attempts)
4. Once Tailscale ping succeeds, Tom polls Jerry's gateway `/health` endpoint
5. Once gateway is healthy, Tom sends the HHMessage via SSH or gateway API
6. Jerry processes the task and replies

## Shutdown flow

1. Tom sets `shutdown_after: true` on the task message
2. Jerry completes the task
3. Jerry sends result with `done: true`
4. Tom confirms receipt
5. Jerry initiates graceful OS shutdown

## Pairing

Nodes establish trust via a one-time 6-digit pairing code:

1. Tom generates a 6-digit code and displays it
2. The code is SHA-256 hashed and stored in Tom's config
3. Jerry receives the code out-of-band (user types it in)
4. Jerry's `tj pair --code <code>` verifies against Tom's stored hash
5. Both nodes exchange Tailscale IPs and SSH key fingerprints
6. Pair state is written to both nodes' `tj.json`

## Transport

| Layer | Protocol | Purpose |
|-------|----------|---------|
| Tailscale | WireGuard | Encrypted tunnel, peer discovery, reachability |
| SSH | OpenSSH | Remote command execution |
| WOL | UDP broadcast | Wake sleeping machines |
| HTTP | Gateway API | Health checks, message delivery |

## Security

- All traffic encrypted via Tailscale (WireGuard)
- Pairing codes hashed with SHA-256
- API keys stored in OS keychain (never plaintext)
- Gateway bound to loopback (Tom) or Tailscale IP (Jerry)
- Peer allowlist restricts gateway access to paired Tailscale IPs
- Config files written with `0o600` permissions
