# CofounderMessage Protocol Specification

Version: 0.1.0

## Overview

CofounderMessage is the open protocol envelope for cross-machine agent communication in cofounder. Every message between H1 and H2 nodes is wrapped in this format.

## Message envelope

```typescript
interface CofounderMessage {
  version: string;           // Protocol version (semver)
  id: string;                // UUID v4
  from: string;              // Sender node name
  to: string;                // Recipient node name
  turn: number;              // Conversation turn counter (0-indexed)
  type: CofounderMessageType;       // Message type
  payload: string;           // Task description or result content
  context_summary: string | null;  // Background context for the recipient
  budget_remaining: number | null; // Token/cost budget remaining
  done: boolean;             // Whether this message completes the task
  wake_required: boolean;    // H1 sets true when H2 needs waking first
  shutdown_after: boolean;   // H2 should shut down after completing this task
  timestamp: string;         // ISO 8601 datetime
}
```

## Message types

| Type | Direction | Description |
|------|-----------|-------------|
| `task` | H1 → H2 | New task delegation |
| `result` | H2 → H1 | Task result (partial or final) |
| `heartbeat` | Either | Periodic liveness ping |
| `handoff` | Either | Structured task handoff with constraints |
| `wake` | H1 → H2 | Wake signal (precedes task if H2 is sleeping) |
| `error` | Either | Error report |

## Turn structure

```
Turn 0: H1 sends task/handoff
Turn 1: H2 acknowledges receipt
Turn 2: H2 sends partial result (done: false)
Turn N: H2 sends final result (done: true)
```

Turns increment with each message in the conversation. A new task starts at turn 0.

## Completion signals

- `done: true` + `type: result` = task completed successfully
- `done: true` + `type: error` = task failed, no retry
- `done: false` + `type: result` = partial result, more messages coming

## Task handoff format

For structured delegation, use the CofounderHandoff schema:

```typescript
interface CofounderHandoff {
  task_id: string;           // UUID v4
  from_role: "h1" | "h2";
  to_role": "h2";
  objective: string;         // Clear task description
  context: string;           // Background information
  constraints: string[];     // Rules and boundaries
  expected_output: string;   // What the result should look like
  timeout_seconds: number;   // Max execution time
  wake_if_sleeping: boolean; // Whether to WOL H2 first
  shutdown_when_done: boolean;
}
```

## Heartbeat format

```typescript
interface CofounderHeartbeat {
  from: string;
  role: "h1" | "h2";
  tailscale_ip: string;
  gateway_port: number;
  gateway_healthy: boolean;
  uptime_seconds: number;
  timestamp: string;
}
```

## Wake flow

1. H1 creates CofounderMessage with `wake_required: true`
2. H1 sends WOL magic packet to H2's MAC via UDP broadcast
3. H1 polls H2's Tailscale IP (ping every 2s, up to 60 attempts)
4. Once Tailscale ping succeeds, H1 polls H2's gateway `/health` endpoint
5. Once gateway is healthy, H1 sends the CofounderMessage via SSH or gateway API
6. H2 processes the task and replies

## Shutdown flow

1. H1 sets `shutdown_after: true` on the task message
2. H2 completes the task
3. H2 sends result with `done: true`
4. H1 confirms receipt
5. H2 initiates graceful OS shutdown

## Pairing

Nodes establish trust via a one-time 6-digit pairing code:

1. H1 generates a 6-digit code and displays it
2. The code is SHA-256 hashed and stored in H1's config
3. H2 receives the code out-of-band (user types it in)
4. H2's `cofounder pair --code <code>` verifies against H1's stored hash
5. Both nodes exchange Tailscale IPs and SSH key fingerprints
6. Pair state is written to both nodes' `cofounder.json`

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
- Gateway bound to loopback (H1) or Tailscale IP (H2)
- Peer allowlist restricts gateway access to paired Tailscale IPs
- Config files written with `0o600` permissions
