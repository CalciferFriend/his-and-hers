# Multi-H2 Setup

H1 supports multiple H2 nodes. Each peer gets its own config file. H1 routes tasks to the best available peer automatically, or you can target a specific one with `--peer`.

---

## Why multiple Jerrys?

Different machines are good at different things:

- **RTX 4090 workstation** — 70B inference, Flux image gen, LoRA training
- **RTX 3070 Ti gaming PC** — 7B–13B models, SDXL images, code tasks
- **Raspberry Pi 5** — always-on, embeddings, small summarizations, monitoring
- **Mac Mini M2** — 13B models, Metal inference, always-on alternative to Pi

With multi-H2, H1 figures out where each task should go. You don't manage it.

---

## Adding a second H2

On the new H2 machine, run the setup wizard normally:

```bash
# On the new H2 machine
hh onboard
# → Role: H2
# → Name: h2-beast
# → H1's Tailscale IP: 100.x.y.z
```

On H1, add the new peer:

```bash
# On H1
hh pair
# → Add peer
# → Enter H2's Tailscale IP: 100.a.b.c
# → Enter name: h2-beast
# → SSH user: ubuntu
# → Test connection: ✓
```

Or edit `~/.his-and-hers/peers/h2-beast.json` directly:

```json
{
  "name": "h2-beast",
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

The `gateway_token` must match what H2 Beast's gateway is configured with. H1's wizard fetches it via SSH during pairing.

---

## Peer config files

H1 stores one config file per H2:

```
~/.his-and-hers/peers/
  h2-home.json       ← RTX 3070 Ti, Windows
  h2-pi.json         ← Raspberry Pi 5
  h2-beast.json      ← RTX 4090
```

---

## `hh peers` — list all peers

```bash
hh peers
```

Output:

```
Peers (3)
──────────────────────────────────────────────────────────────
h2-home    RTX 3070 Ti  ✓ online   ollama:3 models  last seen: 8s ago
h2-pi      Pi 5         ✓ online   ollama:2 models  last seen: 12s ago
h2-beast   RTX 4090     ✗ offline  WOL: configured  last seen: 4h ago
──────────────────────────────────────────────────────────────
```

Add `--ping` to force live reachability checks instead of using cached heartbeat data:

```bash
hh peers --ping
```

---

## Targeting a specific peer

```bash
hh send "run 70B inference on this document" --peer h2-beast
hh send "generate SDXL image" --peer h2-home
hh send "embed this corpus" --peer h2-pi
```

The `--peer` flag bypasses capability routing and always targets that peer. If the peer is offline, H1 sends a WOL magic packet (unless `--no-wol`).

---

## Automatic routing (`--auto`)

Let H1 pick based on capability matching:

```bash
hh send "generate an image of a sunset" --auto
# → Checking peers...
# → h2-home: online, image-gen skill ✓
# → Routing to h2-home

hh send "summarize this document" --auto
# → h2-pi: online, embeddings ✓  (lightest peer — good fit)
# → Routing to h2-pi

hh send "run llama3:70b on this" --auto
# → h2-beast: offline (WOL configured)
# → Waking h2-beast...
# → Routing to h2-beast
```

`--auto` is not the default because without configured capabilities it falls back to the first peer. Set it when you know capability routing is configured correctly.

---

## Per-peer status

```bash
hh status --peer h2-home
hh status --peer h2-beast
```

Output:

```
H2 (h2-beast) — RTX 4090
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
hh logs --peer h2-beast --since 7d
hh logs --peer h2-home --status failed
```

---

## Per-peer budget

```bash
hh budget --peer h2-home --month
hh budget --peer h2-pi --all
```

---

## Removing a peer

```bash
hh pair remove h2-beast
# → Removes ~/.his-and-hers/peers/h2-beast.json
# → Removes cached peer-capabilities-h2-beast.json
```

Or just delete the peer config file manually.

---

## Context per peer

H1 maintains a separate conversation context for each H2 (last 10 task summaries). This means long-running work on `h2-home` doesn't pollute the context for `h2-beast`.

```
~/.his-and-hers/context/
  h2-home.json
  h2-beast.json
  h2-pi.json
```

Clear context for a peer:

```bash
echo "[]" > ~/.his-and-hers/context/h2-home.json
```

---

## Testing all peers

```bash
hh pair test
```

Output:

```
Testing all peers...
  h2-home   ✓ reachable (12ms)  ✓ gateway healthy  ✓ SSH OK
  h2-pi     ✓ reachable (8ms)   ✓ gateway healthy  ✓ SSH OK
  h2-beast  ✗ unreachable       WOL configured, not tested
```
