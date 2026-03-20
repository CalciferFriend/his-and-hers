# `cofounder cluster` — Named Peer Groups

Define named groups of peers for cluster-targeted dispatch.
Clusters let you target a set of H2 nodes with a single short name instead of
listing peers by hand every time.

**Phase 7c** — implemented 2026-03-15.

---

## Usage

```sh
cofounder clusters                                    # list all defined clusters
cofounder cluster list                               # same as above
cofounder cluster add <name> --peers <p1,p2,...>     # define or overwrite a cluster
cofounder cluster show <name>                        # inspect one cluster
cofounder cluster remove <name>                      # delete a cluster
cofounder cluster peers add <cluster> <peer>         # add a peer to an existing cluster
cofounder cluster peers remove <cluster> <peer>      # remove a peer from a cluster
```

---

## Quick start

```sh
# Define two clusters
cofounder cluster add gpu   --peers glados,piper
cofounder cluster add fast  --peers forge

# Send the same task to every peer in the gpu cluster
cofounder broadcast "run stable-diffusion benchmark" --cluster gpu --wait

# List only the peers in a cluster
cofounder peers --cluster gpu

# Check what's in a cluster
cofounder cluster show gpu

# Add a new node later
cofounder cluster peers add gpu ragnarok

# Remove a node
cofounder cluster peers remove gpu piper

# Delete the whole cluster
cofounder cluster remove gpu --force
```

---

## cofounder clusters / cofounder cluster list

List all defined clusters with their member peers.

```
cofounder clusters [--json]
```

Stale peers (removed from config but still referenced in a cluster) are
highlighted in red so you can clean them up.

**JSON output** (`--json`):

```json
{
  "clusters": [
    {
      "name": "gpu",
      "peers": ["glados", "piper"],
      "stale": []
    },
    {
      "name": "fast",
      "peers": ["forge", "ragnarok"],
      "stale": ["ragnarok"]
    }
  ]
}
```

---

## cofounder cluster add

Create a new cluster or overwrite an existing one.

```
cofounder cluster add <name> --peers <peer1,peer2,...> [--no-validate] [--json]
```

| Flag | Description |
|------|-------------|
| `--peers <names>` | Required. Comma-separated list of peer names to include. |
| `--no-validate` | Allow peer names that don't exist in the current config (useful for pre-staging clusters before pairing all peers). |
| `--json` | Output the created/updated cluster info as JSON. |

Cluster names must match `[a-zA-Z0-9_-]+`. Re-running `cofounder cluster add` on an
existing name overwrites its peer list.

---

## cofounder cluster show

Inspect a single cluster — shows each member with their Tailscale IP and flags
any stale entries.

```
cofounder cluster show <name> [--json]
```

---

## cofounder cluster remove

Delete a named cluster from config.

```
cofounder cluster remove <name> [--force] [--json]
```

Without `--force`, a confirmation prompt is shown. The cluster's peer config is
not affected — only the cluster definition is removed.

---

## cofounder cluster peers add / remove

Add or remove individual peers from an existing cluster without redefining it.

```sh
cofounder cluster peers add  <cluster> <peer> [--no-validate] [--json]
cofounder cluster peers remove <cluster> <peer> [--json]
```

Useful for incrementally growing or shrinking a cluster as you add new H2 nodes
to your setup.

---

## Integration with cofounder broadcast

Pass `--cluster` to `cofounder broadcast` to target all peers in a group:

```sh
cofounder broadcast "run nightly tests"        --cluster gpu --wait
cofounder broadcast "status report"            --cluster fast --strategy first
cofounder broadcast "sweep inference profiles" --cluster gpu --json
```

`--cluster` and `--peers` are mutually exclusive.

---

## Integration with cofounder peers

Pass `--cluster` to `cofounder peers` to filter the displayed peer list:

```sh
cofounder peers --cluster gpu --ping
```

---

## SDK usage

```ts
import { resolveClusterPeers } from "@cofounder/cli/commands/cluster";
import { loadConfig } from "@cofounder/cli/config/store";
import { getAllPeers, findPeerByName } from "@cofounder/cli/peers/select";

const config = await loadConfig();
const peerNames = await resolveClusterPeers("gpu");   // string[] | null

if (peerNames && config) {
  const peers = peerNames
    .map((n) => findPeerByName(config, n))
    .filter(Boolean);
  // dispatch to peers ...
}
```

---

## Config storage

Clusters are persisted in `~/.cofounder/cofounder.json` under the `clusters` key:

```json
{
  "clusters": {
    "gpu":  ["glados", "piper"],
    "fast": ["forge"]
  }
}
```

Peer names in clusters are validated against `peer_node` + `peer_nodes[]` at
write time (unless `--no-validate` is passed). Stale entries left over from
removed peers are surfaced as warnings — they're harmless and are silently
skipped at dispatch time.
