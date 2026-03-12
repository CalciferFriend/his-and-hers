---
title: "hh pair"
description: Pair two his-and-hers nodes using a one-time 6-digit code.
---

# `hh pair` — Reference

Establish trust between two nodes using a one-time 6-digit pairing code.

---

## Synopsis

```bash
# On H1 — generate a code
hh pair

# On H2 — complete the pairing
hh pair --code <6-digit-code>
```

---

## How pairing works

Pairing is a one-time, two-step process that establishes mutual trust between
H1 and H2 without exchanging credentials over the network.

```
H1                              H2
────────────────────────────────────────────────────
hh pair
  → generates 6-digit code
  → SHA-256 hashes it
  → stores hash in hh.json
  → displays code on screen

                  [user reads code, types on H2]

                               hh pair --code 847291
                                 → verifies against H1's hash
                                 → exchanges Tailscale IPs
                                 → exchanges SSH key fingerprints
                                 → writes pair state to hh.json
────────────────────────────────────────────────────
Both nodes now trust each other.
```

The code is never sent over the network. H1 stores only its SHA-256 hash.

---

## Step 1 — Generate a code (H1)

```bash
$ hh pair

Pairing code: 847291

This code expires in 10 minutes.
Run on H2:  hh pair --code 847291

Waiting for H2 to connect...
```

H1 waits up to 10 minutes. The code is single-use.

---

## Step 2 — Complete pairing (H2)

```bash
$ hh pair --code 847291

Connecting to H1 (100.x.y.z)...
✓  Code verified
✓  Tailscale IPs exchanged
✓  SSH fingerprints exchanged
✓  Pair state written to ~/.his-and-hers/hh.json

Pairing complete. H1 can now reach this node.
```

---

## After pairing

Both nodes confirm the pairing succeeded:

```bash
# H1's output updates:
✓  H2 paired: h2-home (100.a.b.c)
Pair state written to ~/.his-and-hers/hh.json

# Verify with:
hh status
```

```bash
$ hh status

H2  (h2-home)
  ✓  Tailscale reachable  100.a.b.c
  ✓  gateway healthy      100.a.b.c:3737
  ✓  last heartbeat       3s ago
```

---

## Flags

| Flag | Description |
|------|-------------|
| `--code <code>` | 6-digit code received from H1 (H2 side) |
| `--peer <name>` | Name to assign this peer in H1's config |
| `--timeout <seconds>` | Code expiry timeout in seconds (default: 600) |
| `--json` | Output pair result as JSON |

---

## JSON output

```bash
$ hh pair --code 847291 --json
```

```json
{
  "status": "paired",
  "peer": {
    "name": "h2-home",
    "role": "jerry",
    "tailscale_ip": "100.a.b.c",
    "gateway_port": 3737,
    "ssh_key_fingerprint": "SHA256:abc123..."
  },
  "paired_at": "2026-03-12T10:00:00Z"
}
```

---

## Re-pairing

To replace an existing peer's credentials (e.g. after a Tailscale re-auth):

```bash
# On H1: generate a new code
hh pair

# On H2: re-pair with the new code
hh pair --code <new-code>
```

The old peer entry is overwritten. Existing tasks and history are preserved.

---

## Unpairing

```bash
hh unpair --peer h2-home
```

This removes the peer from H1's config and deletes the stored pair state.
H2's side is not affected — run `hh unpair` on H2 as well if needed.

---

## Security notes

- The pairing code is a one-time 6-digit PIN, SHA-256 hashed on H1
- The code is never stored in plaintext and never transmitted over the network
- All subsequent communication is encrypted via Tailscale (WireGuard)
- API tokens and gateway secrets are stored in the OS keychain (`keytar`)
- Config files are written with `0o600` permissions

---

## See also

- [Quickstart](/guide/quickstart) — pairing in the full onboarding flow
- [`hh status`](/reference/status) — verify pairing succeeded
- [Protocol: Pairing](/protocol/overview#pairing) — how the protocol handles trust
