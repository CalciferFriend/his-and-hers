# `cofounder status` — Reference

Show the health and state of all configured nodes.

---

## Synopsis

```bash
cofounder status [flags]
```

---

## Flags

| Flag | Description |
|------|-------------|
| `--peer <name>` | Show detailed status for one peer |
| `--json` | JSON output |
| `--watch` | Refresh every 5 seconds (live view) |

---

## Output

### Default

```bash
$ cofounder status

cofounder v0.5.2

H1  (Calcifer 🔥)
  ✓  gateway healthy      127.0.0.1:3737
  ✓  Tailscale up         100.x.y.z
  ✓  provider             anthropic/claude-sonnet-4-5

H2  (GLaDOS 🤖  —  h2-home)
  ✓  Tailscale reachable  100.a.b.c
  ✓  gateway healthy      100.a.b.c:3737
  ✓  last heartbeat       8s ago
  ✓  Ollama running       3 models
  ✓  WOL configured       D8:5E:D3:04:18:B4
     GPU                  NVIDIA RTX 3070 Ti · 8 GB VRAM

H2  (h2-pi 🍓)
  ✓  Tailscale reachable  100.c.d.e
  ✓  gateway healthy      100.c.d.e:3737
  ✓  last heartbeat       22s ago
     WOL                  not configured

H2  (h2-beast 🦾)
  ✗  Tailscale offline    (last seen: 4h 12m ago)
  ✓  WOL configured       D8:5E:D3:AA:BB:CC
     Capabilities cached  (fetched 4h ago)

Budget (today): $0.18 cloud / $0.00 local (5 tasks)
```

### With `--peer`

```bash
$ cofounder status --peer h2-beast

H2 (h2-beast 🦾)  —  RTX 4090
  Tailscale IP:    100.a.b.c
  Status:          OFFLINE (last seen 4h 12m ago)
  WOL:             ✓ configured  MAC: D8:5E:D3:AA:BB:CC
  Gateway port:    3737

  Cached capabilities (4h old):
    GPU:      NVIDIA RTX 4090 · 24 GB VRAM · CUDA 12.3
    Ollama:   4 models
              - llama3:70b-instruct-q4_0
              - qwen2.5-coder:32b
              - nomic-embed-text
              - llava:13b
    Skills:   inference:70b, image-gen, code, vision, embeddings

  Budget (today): $0.00 (0 tasks)
```

---

## JSON output

```bash
$ cofounder status --json
```

```json
{
  "version": "0.5.2",
  "h1": {
    "name": "Calcifer",
    "emoji": "🔥",
    "tailscale_ip": "100.x.y.z",
    "gateway_healthy": true,
    "gateway_url": "127.0.0.1:3737",
    "provider": "anthropic",
    "model": "claude-sonnet-4-5"
  },
  "peers": [
    {
      "name": "h2-home",
      "emoji": "🤖",
      "tailscale_ip": "100.a.b.c",
      "tailscale_reachable": true,
      "gateway_healthy": true,
      "last_heartbeat_seconds_ago": 8,
      "wol_configured": true,
      "capabilities": {
        "gpu": "NVIDIA RTX 3070 Ti",
        "vram_gb": 8,
        "ollama_running": true,
        "ollama_model_count": 3,
        "skill_tags": ["ollama", "gpu-inference"]
      }
    },
    {
      "name": "h2-beast",
      "tailscale_reachable": false,
      "gateway_healthy": false,
      "last_seen_seconds_ago": 15120,
      "wol_configured": true
    }
  ],
  "budget_today": {
    "cloud_cost_usd": 0.18,
    "local_cost_usd": 0.00,
    "task_count": 5
  }
}
```

---

## Status indicators

| Symbol | Meaning |
|--------|---------|
| `✓` | Check passed |
| `✗` | Check failed |
| (blank) | Info only, not a health check |

---

## What `cofounder status` checks

1. **H1 gateway** — HTTP GET `http://127.0.0.1:3737/health`
2. **Tailscale** — `tailscale status` for this node
3. **For each peer:**
   - Tailscale reachability — `tailscale ping <peer-ip>` (fast, cached)
   - Gateway health — HTTP GET `http://<peer-ip>:<port>/health`
   - Last heartbeat — age of last `CofounderHeartbeat` received from H2
   - WOL config — whether MAC address is configured

Heartbeat is passive — it uses the last-received time. `cofounder status` does not actively contact H2's heartbeat endpoint.

---

## `cofounder doctor`

For deeper diagnostics (SSH, WOL, config validation):

```bash
cofounder doctor
```

Output:

```
Diagnosing...

✓  Node.js v22.14.0
✓  Tailscale running (100.x.y.z)
✓  OpenClaw gateway healthy (127.0.0.1:3737)
✓  h2-home: Tailscale reachable (12ms)
✓  h2-home: gateway healthy
✓  h2-home: SSH access OK
✓  h2-home: WOL configured
✗  h2-beast: Tailscale unreachable (offline)
⚠  h2-beast: capabilities cache is 4h old (stale)

1 error, 1 warning
Run `cofounder wake --peer h2-beast` to check WOL setup.
```

---

## See also

- [cofounder logs](/reference/logs) — task history
- [cofounder wake](/reference/wake) — wake offline H2
- [cofounder doctor](/reference/cli#hh-doctor) — deep diagnostics
