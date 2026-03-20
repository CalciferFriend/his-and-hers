# `cofounder doctor`

Comprehensive health diagnostics for a cofounder node. Checks local and peer connectivity, configuration, and capability freshness — and gives actionable remediation hints when something is wrong.

## Usage

```bash
cofounder doctor
cofounder doctor --peer <name>
cofounder doctor --json
```

## Flags

| Flag | Description |
|------|-------------|
| `--peer <name>` | Run checks only for a specific peer by name |
| `--json` | Output results as machine-readable JSON |

## Checks performed

### Local
- Node.js version (≥22 required)
- OpenClaw installed and reachable
- Local gateway health (HTTP /health)

### Per peer
- Tailscale reachability (ping)
- SSH connectivity
- Peer gateway health
- Wake-on-LAN configuration
- Capability file freshness (`~/.cofounder/peer-capabilities.json`)

### Summary
- Pass / Warn / Fail counts
- Suggested next steps for any failed checks

## Examples

```bash
# Full diagnostic for all configured peers
cofounder doctor

# Focus on a single peer
cofounder doctor --peer glados

# Pipe results to jq
cofounder doctor --json | jq '.checks[] | select(.status == "fail")'
```

## Notes

- `cofounder doctor` is a read-only command — it doesn't modify any configuration.
- For a quicker connectivity check, see `cofounder test` (subset of doctor checks, CI-friendly exit codes).
- Capability staleness is flagged when the peer capabilities file is older than 24 hours.

## See also

- [`cofounder test`](/reference/test) — subset of checks with CI-friendly exit codes
- [`cofounder status`](/reference/status) — live node status at a glance
- [`cofounder peers`](/reference/peers) — list all peers with reachability info
