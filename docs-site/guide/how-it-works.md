# How it works

his-and-hers is three things wired together: **a transport layer** (Tailscale + SSH + WOL), **a message protocol** (HHMessage), and **an agent runtime** (OpenClaw gateway).

---

## Architecture overview

```
┌──────────────────────────────────────────────────────────────┐
│  H1 (always-on)                                             │
│  ┌────────────────┐    ┌──────────────────────────────────┐  │
│  │  OpenClaw       │    │  his-and-hers CLI               │  │
│  │  (main agent)  │◄──►│  hh send / hh status / hh logs   │  │
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
              │ + WOL (Magic Packet if H2 is sleeping)
              │
┌─────────────▼────────────────────────────────────────────────┐
│  H2 (sleeps when idle)                                     │
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

### 1. Task dispatch (`hh send`)

```
H1                              H2
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

H2 sends a `HHHeartbeatMessage` to H1 every 60 seconds while awake. H1 uses this to track H2's last-seen time and whether it's idle enough to go back to sleep.

### 3. Capability advertisement

On startup, H2 runs `hh capabilities advertise`:

1. Scans for GPU (nvidia-smi / rocm-smi / Metal)
2. Lists Ollama models via `/api/tags`
3. Detects ComfyUI, AUTOMATIC1111, LM Studio, Whisper
4. Writes `~/.his-and-hers/capabilities.json`
5. H1 fetches this via `hh capabilities fetch` and caches it as `peer-capabilities.json`

H1's `routeTask()` then uses these capabilities to decide which H2 to use (if you have multiple) and whether to route locally or to the cloud.

---

## Wake-on-LAN

When H1 needs H2 and H2 is offline:

1. H1 checks Tailscale reachability (HTTP ping to H2's gateway)
2. If unreachable: sends a Magic Packet to H2's MAC address
3. If H2 is on a different subnet: packet goes via a router port forward (UDP 9)
4. H1 polls H2's gateway health endpoint every 5s, up to 90s
5. Once H2's gateway responds: task is dispatched normally

H2's BIOS must have WOL enabled. The `hh onboard` wizard provides guidance for this.

---

## Security model

- **Tailscale** provides the network layer — all traffic is WireGuard-encrypted, point-to-point
- **Gateway token** — each gateway has a shared secret; H1 includes it in requests, H2 verifies it
- **SSH** — H1 uses SSH to push config updates to H2 (no inbound SSH on H1 required)
- **API keys** — stored in the OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service) — never written to config files in plaintext
- **No cloud relay** — all traffic stays on your Tailscale network

---

## Multi-H2

H1 can manage multiple H2 nodes. Each peer gets its own config entry:

```
~/.his-and-hers/peers/
  h2-home.json       ← RTX 3070 Ti, Windows PC
  h2-pi.json         ← Raspberry Pi 5, always-on
  h2-beast.json      ← RTX 4090 workstation
```

`routeTask()` picks the best peer based on task requirements and peer capabilities. You can also explicitly target a peer:

```bash
hh send "70B inference task" --peer h2-beast
hh send "embedding batch" --peer h2-pi
```
