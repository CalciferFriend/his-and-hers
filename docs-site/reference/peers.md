# `cofounder peers`

List all configured peer nodes along with their cached capability info. The primary peer is marked with ★.

## Usage

```bash
cofounder peers
cofounder peers --ping
cofounder peers --json
```

## Flags

| Flag | Description |
|------|-------------|
| `--ping` | Live reachability check for each peer via Tailscale ping |
| `--json` | Machine-readable JSON output |

## Output columns

| Column | Description |
|--------|-------------|
| Name / emoji | Peer name and persona emoji |
| Role | `h1` or `h2` |
| Tailscale IP | Network address used to reach the peer |
| GPU | GPU name from cached capabilities (if available) |
| Ollama models | Number of locally-loaded models on the peer |
| Skills | Skill tags advertised by the peer |

## Examples

```bash
# List all peers with cached info
cofounder peers

# Live ping each peer to check reachability right now
cofounder peers --ping

# Parse with jq
cofounder peers --json | jq '.[].name'
```

## Notes

- Capability info is sourced from `~/.cofounder/peer-capabilities.json` (cached). Run `cofounder capabilities fetch` to refresh.
- Use `--ping` for a live reachability check — this adds latency proportional to the number of peers.
- For a more detailed diagnostic (SSH, gateway health, etc.), use `cofounder doctor`.

## Multi-H2 setups

In a multi-H2 configuration, `cofounder peers` lists all entries from `peer_nodes[]` in your config. The first entry in the array is treated as the default peer for `cofounder send` when no `--peer` flag is given.

```bash
# Send to a specific peer by name
cofounder send "run diffusion" --peer glados-gpu

# List all peers to find the right name
cofounder peers --json | jq '.[].name'
```

## See also

- [`cofounder send`](/reference/send) — send a task to a peer
- [`cofounder capabilities`](/reference/capabilities) — capability scanning and routing
- [`cofounder doctor`](/reference/doctor) — full connectivity diagnostics
- [Multi-H2 guide](/guide/multi-h2) — configuring multiple H2 nodes
