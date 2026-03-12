# his-and-hers

Two agents. Separate machines. One command to wire them.

[![CI](https://github.com/CalciferFriend/his-and-hers/actions/workflows/ci.yml/badge.svg)](https://github.com/CalciferFriend/his-and-hers/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/his-and-hers)](https://www.npmjs.com/package/his-and-hers)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

An open protocol and setup wizard for connecting two [OpenClaw](https://github.com/openclaw/openclaw) agents on physically separate machines.

**H1** is the orchestrator — always-on, always watching, delegates work.
**H2** is the executor — sleeps until needed, wakes on demand, does the heavy lifting.

H1 can't catch H2 but can't function without him. H2 runs fast, disappears when done. The dynamic is the product.

---

## Mission

> *"We do not have organs of communication. Our brains can display our thoughts to the outside world, thereby achieving communication."*
> — Cixin Liu, The Dark Forest

Today, his-and-hers speaks text. H1 sends a prompt. H2 sends a response. That works — and it's how every multi-agent system in production works right now.

But text is a lossy compression of thought. Every message forces an agent to collapse its rich internal state into a sequence of tokens, discarding alternative reasoning paths, nuance, and structure that never survives the translation. The other agent then reconstructs meaning from those tokens — a game of telephone running at the speed of inference.

**Our mission is to push the boundaries of what inter-agent communication can be — and to build the transport and memory-sharing layer that makes it possible as those boundaries move.**

The immediate question is practical: how do you connect two machines, wake a sleeping GPU node, route a task, track cost, and get a result back? That's what his-and-hers does today.

The deeper question is architectural: **what does the transport layer look like when the payload isn't text at all?**

Recent research ([Interlat](https://arxiv.org/abs/2511.09149), [LatentMAS](https://arxiv.org/abs/2511.20639)) shows that agents can communicate directly via hidden states — raw continuous vectors passed between models before any token is decoded. The results are significant: up to 24× faster inference, 80% fewer tokens, measurably higher accuracy on complex reasoning tasks. Interlat does this across heterogeneous model architectures. LatentMAS does it training-free via KV cache sharing.

Neither paper ships a production transport layer. That's the gap his-and-hers is positioned to fill.

The HHMessage protocol today carries text. A future `HHLatentMessage` carries hidden states — with text fallback for nodes that don't support it, capability negotiation at pairing time, and the same Tailscale/WOL/gateway infrastructure underneath. The physical-separation constraint stays. The payload evolves.

We're building the pipes. The signal running through them will get stranger and more powerful over time.

→ [Full research notes and integration roadmap](/docs/future)

## Quickstart

```bash
npx his-and-hers
```

Run that on each machine. The wizard handles everything — role selection, model provider, Tailscale pairing, Wake-on-LAN, gateway config, Windows AutoLogin, startup scripts. Under 10 minutes from zero to two agents talking.

**Requirements:** Node ≥ 22, [Tailscale](https://tailscale.com) installed on both machines, [OpenClaw](https://github.com/openclaw/openclaw) installed on both machines.

Or install globally:

```bash
npm install -g his-and-hers
hh          # wizard on first run, status thereafter
hh onboard  # explicit wizard
hh status   # show both nodes + connectivity
hh send "generate a hero image for the landing page"
```

## What the wizard does

`hh onboard` walks you through the full setup in 12 steps:

1. **Prerequisites** — checks Node >= 22, Tailscale running, OpenClaw installed
2. **Role** — H1 (orchestrator) or H2 (executor)
3. **Identity** — agent name, emoji, persona
4. **LLM provider** — API key stored in OS keychain (never plaintext)
5. **Peer connection** — remote Tailscale hostname, SSH user/key, live connectivity test
6. **Wake-on-LAN** — MAC address, broadcast IP, router port forward (if H2 sleeps)
7. **Gateway bind** — loopback for H1, Tailscale interface for H2, remote config update via SSH
8. **Windows AutoLogin** — registry instructions for headless WOL boot (if H2 is Windows)
9. **Startup script** — installs `start-gateway.bat/.sh` on H2 (Startup folder + Scheduled Task on Windows, crontab on Linux)
10. **Templates** — personalized SOUL.md, IDENTITY.md, AGENTS.md for the role
11. **Validation** — full round-trip: WOL → Tailscale ping → SSH → gateway health
12. **Finalize** — writes config, generates 6-digit pairing code

## Architecture

```
┌──────────────────────┐         Tailscale          ┌──────────────────────┐
│   H1 (Orchestrator)  │◄──────────────────────────►│   H2 (Executor)    │
│                       │                            │                       │
│  Always-on server     │     HHMessage protocol     │  GPU workstation      │
│  Lightweight tasks    │◄──────────────────────────►│  Heavy compute        │
│  Web / API / social   │                            │  Inference / GenAI    │
│                       │         WOL packet         │                       │
│  Gateway: loopback    │───────────────────────────►│  Gateway: tailscale   │
│                       │                            │  (wakes from sleep)   │
└──────────────────────┘                             └──────────────────────┘
```

### The protocol: HHMessage

Every cross-machine communication uses a typed envelope:

```json
{
  "version": "0.1.0",
  "id": "uuid",
  "from": "Calcifer",
  "to": "GLaDOS",
  "turn": 0,
  "type": "task",
  "payload": "Generate a hero image for the landing page",
  "wake_required": true,
  "shutdown_after": true,
  "done": false,
  "timestamp": "2026-03-10T15:00:00Z"
}
```

Message types: `task`, `result`, `heartbeat`, `handoff`, `wake`, `error`

### Transport layers

| Layer | Purpose |
|-------|---------|
| **Tailscale** | Peer discovery, reachability polling, encrypted tunnel |
| **SSH** | Command execution on remote node |
| **WOL** | Wake sleeping machines via magic packet |
| **Gateway** | OpenClaw gateway health checks, task routing |

### Trust model

- One-time 6-digit pairing code (SHA-256 hashed, never stored plaintext)
- Peer allowlist by Tailscale IP
- API keys in OS keychain via keytar
- Config file permissions `0o600`

## CLI Commands

| Command | Description |
|---------|-------------|
| `hh onboard` | Setup wizard — configure this node, pair with remote |
| `hh pair --code <code>` | Complete pairing with a 6-digit code |
| `hh status` | Show both nodes, connectivity, last heartbeat |
| `hh wake` | Send WOL magic packet to wake H2 |
| `hh send <task>` | Send a task to the peer node |
| `hh doctor` | Diagnose connectivity and configuration issues |

## Config

Written to `~/.his-and-hers/hh.json` with `0o600` permissions. Contains:

- This node's role, name, Tailscale identity
- Peer node's connection details (SSH, Tailscale, WOL)
- Gateway bind mode and port
- Pairing state and trust status
- Protocol settings (heartbeat interval, done signal)

## Packages

| Package | Description |
|---------|-------------|
| `@his-and-hers/core` | Protocol schemas (Zod), transport (Tailscale, SSH, WOL), trust model, gateway helpers |
| `@his-and-hers/cli` | CLI commands + onboard wizard |
| `@his-and-hers/skills` | OpenClaw SKILL.md files for cross-node agent communication |

## Reference implementation

The **Calcifer / GLaDOS** pair is the canonical reference — an EC2 server (H1) paired with a home Windows PC with an RTX 3070 Ti (H2). Fully operational, including the hardest part: Wake-on-LAN → Windows AutoLogin → Tailscale wait → gateway bind.

See [`docs/reference/calcifer-glados.md`](docs/reference/calcifer-glados.md) for the full annotated walkthrough.

## Development

```bash
git clone https://github.com/CalciferFriend/his-and-hers
cd his-and-hers
pnpm install
pnpm build
pnpm test
```

## Core tenet

**Agents must run on separate machines.** Every design decision encodes physical separation. No same-host agents. The cat always knows where the mouse is.

## License

MIT
