# How it works

his-and-hers is three things wired together: **a transport layer** (Tailscale + SSH + WOL), **a message protocol** (HHMessage), and **an agent runtime** (OpenClaw gateway).

---

## Architecture overview

```
┌──────────────────────────────────────────────────────────────┐
│  Tom (always-on)                                             │
│  ┌────────────────┐    ┌──────────────────────────────────┐  │
│  │  OpenClaw       │    │  his-and-hers CLI               │  │
│  │  (main agent)  │◄──►│  tj send / tj status / tj logs   │  │
│  └────────────────┘    └──────────────────────────────────┘  │
│          │                                                    │
│          │ HHMessage (JSON over HTTP)                         │
│          ▼                                                    │
│  ┌────────────────┐                                          │
│  │  Gateway       │  ← loopback:3737                         │
│  │  (OpenClaw)    │                                          │
│  └────────────────┘                                          │
└─────────────│────────────────────────────────────────────────┘
              │
              │ Tailscale (encrypted WireGuard tunnel)
              │ + SSH (gateway config push)
              │ + WOL (Magic Packet if Jerry is sleeping)
              │
┌─────────────▼────────────────────────────────────────────────┐
│  Jerry (sleeps when idle)                                     │
│  ┌────────────────┐                                          │
│  │  Gateway       │  ← tailscale-ip:3737                     │
│  │  (OpenClaw)    │                                          │
│  └────────────────┘                                          │
│          │                                                    │
│          ▼                                                    │
│  ┌────────────────┐    ┌──────────────────────────────────┐  │
│  │  OpenClaw       │    │  Ollama / ComfyUI / SD           │  │
│  │  (main agent)  │◄──►│  (local model execution)         │  │
│  └────────────────┘    └──────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## Message flow

### 1. Task dispatch (`tj send`)

```
Tom                              Jerry
 │                                 │
 │  1. ping Tailscale IP           │
 │─────────────────────────────►   │
 │  ✓ reachable? → skip WOL        │
 │  ✗ unreachable? → send Magic Packet + poll
 │                                 │
 │  2. build HHTaskMessage         │
 │     { id, from, to, payload }   │
 │─────────────────────────────►   │
 │                                 │  3. OpenClaw receives task
 │                                 │     runs it (Ollama / API / skill)
 │  4. HHResultMessage             │
 │◄─────────────────────────────   │
 │     { id, result, cost_usd }    │
 │                                 │
 │  5. save to task state          │
 │     ~/.his-and-hers/tasks/     │
```

### 2. Heartbeat

Jerry sends a `HHHeartbeatMessage` to Tom every 60 seconds while awake. Tom uses this to track Jerry's last-seen time and whether it's idle enough to go back to sleep.

### 3. Capability advertisement

On startup, Jerry runs `tj capabilities advertise`:

1. Scans for GPU (nvidia-smi / rocm-smi / Metal)
2. Lists Ollama models via `/api/tags`
3. Detects ComfyUI, AUTOMATIC1111, LM Studio, Whisper
4. Writes `~/.his-and-hers/capabilities.json`
5. Tom fetches this via `tj capabilities fetch` and caches it as `peer-capabilities.json`

Tom's `routeTask()` then uses these capabilities to decide which Jerry to use (if you have multiple) and whether to route locally or to the cloud.

---

## Wake-on-LAN

When Tom needs Jerry and Jerry is offline:

1. Tom checks Tailscale reachability (HTTP ping to Jerry's gateway)
2. If unreachable: sends a Magic Packet to Jerry's MAC address
3. If Jerry is on a different subnet: packet goes via a router port forward (UDP 9)
4. Tom polls Jerry's gateway health endpoint every 5s, up to 90s
5. Once Jerry's gateway responds: task is dispatched normally

Jerry's BIOS must have WOL enabled. The `tj onboard` wizard provides guidance for this.

---

## Security model

- **Tailscale** provides the network layer — all traffic is WireGuard-encrypted, point-to-point
- **Gateway token** — each gateway has a shared secret; Tom includes it in requests, Jerry verifies it
- **SSH** — Tom uses SSH to push config updates to Jerry (no inbound SSH on Tom required)
- **API keys** — stored in the OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service) — never written to config files in plaintext
- **No cloud relay** — all traffic stays on your Tailscale network

---

## Multi-H2

Tom can manage multiple Jerry nodes. Each peer gets its own config entry:

```
~/.his-and-hers/peers/
  jerry-home.json       ← RTX 3070 Ti, Windows PC
  jerry-pi.json         ← Raspberry Pi 5, always-on
  jerry-beast.json      ← RTX 4090 workstation
```

`routeTask()` picks the best peer based on task requirements and peer capabilities. You can also explicitly target a peer:

```bash
tj send "70B inference task" --peer jerry-beast
tj send "embedding batch" --peer jerry-pi
```
