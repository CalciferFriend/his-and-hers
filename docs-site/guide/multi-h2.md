# Multi-H2 Setup

Tom supports multiple Jerry nodes. Each peer gets its own config file. Tom routes tasks to the best available peer automatically, or you can target a specific one with `--peer`.

---

## Why multiple Jerrys?

Different machines are good at different things:

- **RTX 4090 workstation** — 70B inference, Flux image gen, LoRA training
- **RTX 3070 Ti gaming PC** — 7B–13B models, SDXL images, code tasks
- **Raspberry Pi 5** — always-on, embeddings, small summarizations, monitoring
- **Mac Mini M2** — 13B models, Metal inference, always-on alternative to Pi

With multi-Jerry, Tom figures out where each task should go. You don't manage it.

---

## Adding a second Jerry

On the new Jerry machine, run the setup wizard normally:

```bash
# On the new Jerry machine
tj onboard
# → Role: Jerry
# → Name: jerry-beast
# → Tom's Tailscale IP: 100.x.y.z
```

On Tom, add the new peer:

```bash
# On Tom
tj pair
# → Add peer
# → Enter Jerry's Tailscale IP: 100.a.b.c
# → Enter name: jerry-beast
# → SSH user: ubuntu
# → Test connection: ✓
```

Or edit `~/.his-and-hers/peers/jerry-beast.json` directly:

```json
{
  "name": "jerry-beast",
  "emoji": "🦾",
  "tailscale_ip": "100.a.b.c",
  "ssh_user": "ubuntu",
  "ssh_key": "~/.ssh/id_ed25519",
  "gateway_port": 3737,
  "gateway_token": "TOKEN_FROM_JERRY_BEAST_ONBOARD",
  "wol": {
    "enabled": true,
    "mac": "D8:5E:D3:AA:BB:CC",
    "broadcast_ip": "192.168.1.1",
    "port": 9
  }
}
```

The `gateway_token` must match what Jerry Beast's gateway is configured with. Tom's wizard fetches it via SSH during pairing.

---

## Peer config files

Tom stores one config file per Jerry:

```
~/.his-and-hers/peers/
  jerry-home.json       ← RTX 3070 Ti, Windows
  jerry-pi.json         ← Raspberry Pi 5
  jerry-beast.json      ← RTX 4090
```

---

## `tj peers` — list all peers

```bash
tj peers
```

Output:

```
Peers (3)
──────────────────────────────────────────────────────────────
jerry-home    RTX 3070 Ti  ✓ online   ollama:3 models  last seen: 8s ago
jerry-pi      Pi 5         ✓ online   ollama:2 models  last seen: 12s ago
jerry-beast   RTX 4090     ✗ offline  WOL: configured  last seen: 4h ago
──────────────────────────────────────────────────────────────
```

Add `--ping` to force live reachability checks instead of using cached heartbeat data:

```bash
tj peers --ping
```

---

## Targeting a specific peer

```bash
tj send "run 70B inference on this document" --peer jerry-beast
tj send "generate SDXL image" --peer jerry-home
tj send "embed this corpus" --peer jerry-pi
```

The `--peer` flag bypasses capability routing and always targets that peer. If the peer is offline, Tom sends a WOL magic packet (unless `--no-wol`).

---

## Automatic routing (`--auto`)

Let Tom pick based on capability matching:

```bash
tj send "generate an image of a sunset" --auto
# → Checking peers...
# → jerry-home: online, image-gen skill ✓
# → Routing to jerry-home

tj send "summarize this document" --auto
# → jerry-pi: online, embeddings ✓  (lightest peer — good fit)
# → Routing to jerry-pi

tj send "run llama3:70b on this" --auto
# → jerry-beast: offline (WOL configured)
# → Waking jerry-beast...
# → Routing to jerry-beast
```

`--auto` is not the default because without configured capabilities it falls back to the first peer. Set it when you know capability routing is configured correctly.

---

## Per-peer status

```bash
tj status --peer jerry-home
tj status --peer jerry-beast
```

Output:

```
Jerry (jerry-beast) — RTX 4090
  Tailscale:   ✗ offline
  WOL:         ✓ configured  (D8:5E:D3:AA:BB:CC)
  Last seen:   4h 12m ago
  Capabilities:
    GPU:    NVIDIA RTX 4090 · 24 GB VRAM · CUDA 12.3
    Ollama: 4 models (llama3:70b, qwen2.5-coder:32b, ...)
    Skills: inference:70b, image-gen, code, vision
```

---

## Per-peer logs

```bash
tj logs --peer jerry-beast --since 7d
tj logs --peer jerry-home --status failed
```

---

## Per-peer budget

```bash
tj budget --peer jerry-home --month
tj budget --peer jerry-pi --all
```

---

## Removing a peer

```bash
tj pair remove jerry-beast
# → Removes ~/.his-and-hers/peers/jerry-beast.json
# → Removes cached peer-capabilities-jerry-beast.json
```

Or just delete the peer config file manually.

---

## Context per peer

Tom maintains a separate conversation context for each Jerry (last 10 task summaries). This means long-running work on `jerry-home` doesn't pollute the context for `jerry-beast`.

```
~/.his-and-hers/context/
  jerry-home.json
  jerry-beast.json
  jerry-pi.json
```

Clear context for a peer:

```bash
echo "[]" > ~/.his-and-hers/context/jerry-home.json
```

---

## Testing all peers

```bash
tj pair test
```

Output:

```
Testing all peers...
  jerry-home   ✓ reachable (12ms)  ✓ gateway healthy  ✓ SSH OK
  jerry-pi     ✓ reachable (8ms)   ✓ gateway healthy  ✓ SSH OK
  jerry-beast  ✗ unreachable       WOL configured, not tested
```
