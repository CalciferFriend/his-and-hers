---
title: Protocol Overview
description: How Tom and Jerry communicate — message flow, transport layers, and the HHMessage envelope.
---

# Protocol Overview

his-and-hers uses an open, versioned message protocol called **HHMessage** for all
agent-to-agent communication. Every task delegation, result, heartbeat, and handoff
is wrapped in this envelope.

Protocol version: **0.1.0**

---

## Architecture

```
┌──────────────────────┐         ┌──────────────────────┐
│  Tom (orchestrator)  │         │  Jerry (executor)    │
│                      │         │                      │
│  OpenClaw gateway    │◄───────►│  OpenClaw gateway    │
│  127.0.0.1:3737      │         │  <tailscale-ip>:3737 │
│                      │         │                      │
│  Tailscale           │◄───────►│  Tailscale           │
└──────────────────────┘         └──────────────────────┘
         │                                  ▲
         │  UDP (WOL magic packet)           │
         └──────────────────────────────────┘
              (if Jerry is asleep)
```

---

## Transport layers

| Layer | Protocol | Purpose |
|-------|----------|---------|
| Tailscale | WireGuard | Encrypted tunnel, peer discovery, reachability |
| SSH | OpenSSH | Remote command execution |
| WOL | UDP broadcast | Wake sleeping machines |
| HTTP | Gateway API | Health checks, message delivery |

All traffic between Tom and Jerry runs inside the Tailscale WireGuard tunnel —
never over the public internet unencrypted.

---

## Message flow

### Happy path — Jerry is awake

```
Tom                                         Jerry
────────────────────────────────────────────────────────────
tj send "write a haiku"

Turn 0:  HHMessage (type: task) ──────────►
                                            processes task
Turn 1:  ◄──────── HHMessage (type: result, done: false)
                                            continues...
Turn N:  ◄──────── HHMessage (type: result, done: true)

Task complete.
────────────────────────────────────────────────────────────
```

### Wake flow — Jerry is asleep

```
Tom                                         Jerry
────────────────────────────────────────────────────────────
tj send "heavy inference task"

  1. Tom detects Jerry offline (Tailscale ping fails)
  2. Tom sends WOL magic packet (UDP → Jerry's MAC)
  3. Tom polls Tailscale ping every 2s (up to 60 attempts)
  4. Tailscale ping succeeds → Jerry is up on the network
  5. Tom polls Jerry's /health endpoint
  6. /health returns 200 → gateway is running

Turn 0:  HHMessage (wake_required: true) ──►
Turn 1:  ◄──────── HHMessage (type: result, done: true)
────────────────────────────────────────────────────────────
```

### Shutdown flow

```
Tom                                         Jerry
────────────────────────────────────────────────────────────
tj send --shutdown "run this and shut down"

Turn 0:  HHMessage (shutdown_after: true) ─►
                                            processes task
Turn N:  ◄──────── HHMessage (done: true)
                                            initiates OS shutdown
────────────────────────────────────────────────────────────
```

---

## Turn structure

Each conversation starts at turn 0 and increments with every message:

| Turn | Direction | Description |
|------|-----------|-------------|
| 0 | Tom → Jerry | Task or handoff |
| 1 | Jerry → Tom | Acknowledgement |
| 2..N-1 | Jerry → Tom | Partial results (`done: false`) |
| N | Jerry → Tom | Final result (`done: true`) |

---

## Message types

| Type | Direction | Description |
|------|-----------|-------------|
| `task` | Tom → Jerry | New task delegation |
| `result` | Jerry → Tom | Task result (partial or final) |
| `heartbeat` | Either | Periodic liveness ping |
| `handoff` | Either | Structured task handoff with constraints |
| `wake` | Tom → Jerry | Wake signal (precedes task if Jerry is sleeping) |
| `error` | Either | Error report |

---

## Completion signals

| Condition | Meaning |
|-----------|---------|
| `done: true` + `type: result` | Task completed successfully |
| `done: true` + `type: error` | Task failed, no retry |
| `done: false` + `type: result` | Partial result, more messages coming |

---

## Pairing

Nodes establish trust via a one-time 6-digit pairing code:

1. Tom generates the code and stores its SHA-256 hash
2. Jerry receives the code out-of-band (user types it in via `tj pair --code`)
3. Jerry's request is verified against Tom's stored hash
4. Both nodes exchange Tailscale IPs and SSH key fingerprints
5. Pair state is written to both nodes' `tj.json`

The code is never transmitted over the network.

---

## Security model

| Mechanism | What it protects |
|-----------|-----------------|
| Tailscale (WireGuard) | All traffic encrypted end-to-end |
| Pairing code (SHA-256) | Prevents unauthorized node pairing |
| Peer allowlist | Gateway only accepts requests from paired Tailscale IPs |
| OS keychain (keytar) | API keys never stored in plaintext |
| File permissions (0o600) | Config files not world-readable |
| Gateway binding | Tom binds to loopback; Jerry to Tailscale IP only |

---

## Schema reference

- [HHMessage](/protocol/hhmessage) — the message envelope
- [HHHandoff](/protocol/hhhandoff) — structured task handoff
- [HHHeartbeat](/protocol/hhheartbeat) — liveness heartbeat
- [TJCapabilityReport](/protocol/capabilities) — node capability advertisement
