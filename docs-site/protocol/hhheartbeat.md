---
title: HHHeartbeat Schema
description: The HHHeartbeat payload schema for liveness pings between H1 and H2.
---

# HHHeartbeat Schema

`HHHeartbeat` is the payload carried by `HHMessage` messages with `type: "heartbeat"`.
H2 sends a heartbeat on a regular interval so H1 knows the node is alive
and its gateway is healthy.

---

## TypeScript interface

```typescript
interface HHHeartbeat {
  from: string;              // Sender node name
  role: "h1" | "jerry";    // Role of the sender
  tailscale_ip: string;     // Current Tailscale IP (useful if it changed)
  gateway_port: number;     // Gateway port this node is listening on
  gateway_healthy: boolean; // Whether the local gateway passed its own /health check
  uptime_seconds: number;   // Seconds since the gateway process started
  timestamp: string;        // ISO 8601 datetime
}
```

---

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | `string` | ✓ | Node name matching `hh.json` |
| `role` | `"tom" \| "jerry"` | ✓ | Role of the sender |
| `tailscale_ip` | `string` | ✓ | Current Tailscale IPv4 address |
| `gateway_port` | `number` | ✓ | Port H1 should use to reach this node's gateway |
| `gateway_healthy` | `boolean` | ✓ | Result of the node's own `/health` check |
| `uptime_seconds` | `number` | ✓ | Seconds the gateway process has been running |
| `timestamp` | `string` | ✓ | ISO 8601 datetime of this heartbeat |

---

## Example

```json
{
  "from": "GLaDOS",
  "role": "jerry",
  "tailscale_ip": "100.a.b.c",
  "gateway_port": 3737,
  "gateway_healthy": true,
  "uptime_seconds": 7200,
  "timestamp": "2026-03-12T10:05:00.000Z"
}
```

---

## As a HHMessage

Heartbeats are carried as the `payload` of a `HHMessage` with `type: "heartbeat"`:

```json
{
  "version": "0.1.0",
  "id": "d4e5f6a7-b8c9-0123-def0-123456789abc",
  "from": "GLaDOS",
  "to": "Calcifer",
  "turn": 0,
  "type": "heartbeat",
  "payload": "{\"from\":\"GLaDOS\",\"role\":\"jerry\",\"tailscale_ip\":\"100.a.b.c\",\"gateway_port\":3737,\"gateway_healthy\":true,\"uptime_seconds\":7200,\"timestamp\":\"2026-03-12T10:05:00.000Z\"}",
  "context_summary": null,
  "budget_remaining": null,
  "done": true,
  "wake_required": false,
  "shutdown_after": false,
  "timestamp": "2026-03-12T10:05:00.000Z"
}
```

Note: `done` is always `true` for heartbeat messages — they are one-shot pings,
not part of a multi-turn conversation.

---

## Heartbeat interval

H2's gateway sends a heartbeat to H1 every **30 seconds** by default.
H1 updates its last-seen timestamp for the peer on receipt.

`hh status` displays the age of the last heartbeat:

```bash
$ hh status

H2  (h2-home 🤖)
  ✓  last heartbeat   8s ago
```

If no heartbeat is received for more than **90 seconds**, H1 marks the peer as
potentially unhealthy (⚠️ stale). After **5 minutes** with no heartbeat, H1
flags the peer as offline.

---

## Troubleshooting stale heartbeats

```bash
# Check if H2's gateway is running
$ hh status --peer h2-home

# If gateway is stopped, restart it on H2:
$ sudo systemctl restart hh-gateway     # Linux
$ openclaw gateway start                # Manual start
```

---

## See also

- [HHMessage](/protocol/hhmessage) — the outer message envelope
- [Protocol overview](/protocol/overview) — full message flow
- [`hh status`](/reference/status) — viewing heartbeat age in the live status output
