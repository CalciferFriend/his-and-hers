---
title: "tj pair"
description: Pair two his-and-hers nodes using a one-time 6-digit code.
---

# `tj pair` — Reference

Establish trust between two nodes using a one-time 6-digit pairing code.

---

## Synopsis

```bash
# On Tom — generate a code
tj pair

# On Jerry — complete the pairing
tj pair --code <6-digit-code>
```

---

## How pairing works

Pairing is a one-time, two-step process that establishes mutual trust between
Tom and Jerry without exchanging credentials over the network.

```
Tom                              Jerry
────────────────────────────────────────────────────
tj pair
  → generates 6-digit code
  → SHA-256 hashes it
  → stores hash in tj.json
  → displays code on screen

                  [user reads code, types on Jerry]

                               tj pair --code 847291
                                 → verifies against Tom's hash
                                 → exchanges Tailscale IPs
                                 → exchanges SSH key fingerprints
                                 → writes pair state to tj.json
────────────────────────────────────────────────────
Both nodes now trust each other.
```

The code is never sent over the network. Tom stores only its SHA-256 hash.

---

## Step 1 — Generate a code (Tom)

```bash
$ tj pair

Pairing code: 847291

This code expires in 10 minutes.
Run on Jerry:  tj pair --code 847291

Waiting for Jerry to connect...
```

Tom waits up to 10 minutes. The code is single-use.

---

## Step 2 — Complete pairing (Jerry)

```bash
$ tj pair --code 847291

Connecting to Tom (100.x.y.z)...
✓  Code verified
✓  Tailscale IPs exchanged
✓  SSH fingerprints exchanged
✓  Pair state written to ~/.his-and-hers/tj.json

Pairing complete. Tom can now reach this node.
```

---

## After pairing

Both nodes confirm the pairing succeeded:

```bash
# Tom's output updates:
✓  Jerry paired: jerry-home (100.a.b.c)
Pair state written to ~/.his-and-hers/tj.json

# Verify with:
tj status
```

```bash
$ tj status

Jerry  (jerry-home)
  ✓  Tailscale reachable  100.a.b.c
  ✓  gateway healthy      100.a.b.c:3737
  ✓  last heartbeat       3s ago
```

---

## Flags

| Flag | Description |
|------|-------------|
| `--code <code>` | 6-digit code received from Tom (Jerry side) |
| `--peer <name>` | Name to assign this peer in Tom's config |
| `--timeout <seconds>` | Code expiry timeout in seconds (default: 600) |
| `--json` | Output pair result as JSON |

---

## JSON output

```bash
$ tj pair --code 847291 --json
```

```json
{
  "status": "paired",
  "peer": {
    "name": "jerry-home",
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
# On Tom: generate a new code
tj pair

# On Jerry: re-pair with the new code
tj pair --code <new-code>
```

The old peer entry is overwritten. Existing tasks and history are preserved.

---

## Unpairing

```bash
tj unpair --peer jerry-home
```

This removes the peer from Tom's config and deletes the stored pair state.
Jerry's side is not affected — run `tj unpair` on Jerry as well if needed.

---

## Security notes

- The pairing code is a one-time 6-digit PIN, SHA-256 hashed on Tom
- The code is never stored in plaintext and never transmitted over the network
- All subsequent communication is encrypted via Tailscale (WireGuard)
- API tokens and gateway secrets are stored in the OS keychain (`keytar`)
- Config files are written with `0o600` permissions

---

## See also

- [Quickstart](/guide/quickstart) — pairing in the full onboarding flow
- [`tj status`](/reference/status) — verify pairing succeeded
- [Protocol: Pairing](/protocol/overview#pairing) — how the protocol handles trust
