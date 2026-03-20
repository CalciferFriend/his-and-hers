---
title: Protocol Overview
description: How H1 and H2 communicate — message flow, transport layers, and the CofounderMessage envelope.
---

# Protocol Overview

cofounder uses an open, versioned message protocol called **CofounderMessage** for all
agent-to-agent communication. Every task delegation, result, heartbeat, and handoff
is wrapped in this envelope.

Protocol version: **0.1.0**

---

## Architecture

```
┌──────────────────────┐         ┌──────────────────────┐
│  H1 (orchestrator)  │         │  H2 (executor)    │
│                      │         │                      │
│  OpenClaw gateway    │◄───────►│  OpenClaw gateway    │
│  127.0.0.1:3737      │         │  <tailscale-ip>:3737 │
│                      │         │                      │
│  Tailscale           │◄───────►│  Tailscale           │
└──────────────────────┘         └──────────────────────┘
         │                                  ▲
         │  UDP (WOL magic packet)           │
         └──────────────────────────────────┘
              (if H2 is asleep)
```

---

## Transport layers

| Layer | Protocol | Purpose |
|-------|----------|---------|
| Tailscale | WireGuard | Encrypted tunnel, peer discovery, reachability |
| SSH | OpenSSH | Remote command execution |
| WOL | UDP broadcast | Wake sleeping machines |
| HTTP | Gateway API | Health checks, message delivery |

All traffic between H1 and H2 runs inside the Tailscale WireGuard tunnel —
never over the public internet unencrypted.

---

## Message flow

### Happy path — H2 is awake

```
H1                                         H2
────────────────────────────────────────────────────────────
cofounder send "write a haiku"

Turn 0:  CofounderMessage (type: task) ──────────►
                                            processes task
Turn 1:  ◄──────── CofounderMessage (type: result, done: false)
                                            continues...
Turn N:  ◄──────── CofounderMessage (type: result, done: true)

Task complete.
────────────────────────────────────────────────────────────
```

### Wake flow — H2 is asleep

```
H1                                         H2
────────────────────────────────────────────────────────────
cofounder send "heavy inference task"

  1. H1 detects H2 offline (Tailscale ping fails)
  2. H1 sends WOL magic packet (UDP → H2's MAC)
  3. H1 polls Tailscale ping every 2s (up to 60 attempts)
  4. Tailscale ping succeeds → H2 is up on the network
  5. H1 polls H2's /health endpoint
  6. /health returns 200 → gateway is running

Turn 0:  CofounderMessage (wake_required: true) ──►
Turn 1:  ◄──────── CofounderMessage (type: result, done: true)
────────────────────────────────────────────────────────────
```

### Shutdown flow

```
H1                                         H2
────────────────────────────────────────────────────────────
cofounder send --shutdown "run this and shut down"

Turn 0:  CofounderMessage (shutdown_after: true) ─►
                                            processes task
Turn N:  ◄──────── CofounderMessage (done: true)
                                            initiates OS shutdown
────────────────────────────────────────────────────────────
```

---

## Turn structure

Each conversation starts at turn 0 and increments with every message:

| Turn | Direction | Description |
|------|-----------|-------------|
| 0 | H1 → H2 | Task or handoff |
| 1 | H2 → H1 | Acknowledgement |
| 2..N-1 | H2 → H1 | Partial results (`done: false`) |
| N | H2 → H1 | Final result (`done: true`) |

---

## Message types

| Type | Direction | Description |
|------|-----------|-------------|
| `task` | H1 → H2 | New task delegation |
| `result` | H2 → H1 | Task result (partial or final) |
| `heartbeat` | Either | Periodic liveness ping |
| `handoff` | Either | Structured task handoff with constraints |
| `wake` | H1 → H2 | Wake signal (precedes task if H2 is sleeping) |
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

1. H1 generates the code and stores its SHA-256 hash
2. H2 receives the code out-of-band (user types it in via `cofounder pair --code`)
3. H2's request is verified against H1's stored hash
4. Both nodes exchange Tailscale IPs and SSH key fingerprints
5. Pair state is written to both nodes' `cofounder.json`

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
| Gateway binding | H1 binds to loopback; H2 to Tailscale IP only |

---

## Schema reference

- [CofounderMessage](/protocol/cofoundermessage) — the message envelope
- [CofounderHandoff](/protocol/cofounderhandoff) — structured task handoff
- [CofounderHeartbeat](/protocol/cofounderheartbeat) — liveness heartbeat
- [HHCapabilityReport](/protocol/capabilities) — node capability advertisement
