# `cofounder test` — Reference

Run an end-to-end connectivity check against a peer. Useful for verifying
your setup after onboarding, or diagnosing problems.

---

## Synopsis

```bash
cofounder test [--peer <name>] [--json]
```

---

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--peer <name>` | auto | Target a specific H2 by name |
| `--json` | false | Machine-readable JSON output |

---

## What it checks

`cofounder test` runs three sequential steps:

| Step | What it does | Pass condition |
|------|-------------|----------------|
| **1. Tailscale reachability** | Pings peer's Tailscale IP | RTT received within 5s |
| **2. Gateway health** | HTTP GET `/health` on peer's gateway | Returns `{"ok":true}` |
| **3. Round-trip message** | Sends a wake message, measures RTT | Response within 10s |

---

## Default output

```bash
$ cofounder test
```

```
◆  HH Connectivity Test → 🤖 h2-home (100.64.0.2)

  Step 1 — Tailscale ping        ✓  12ms
  Step 2 — Gateway health        ✓  8ms
  Step 3 — Round-trip wake       ✓  142ms
  ────────────────────────────────────────
  All checks passed.
```

### With a failing step

```bash
$ cofounder test
```

```
◆  HH Connectivity Test → 🤖 h2-home (100.64.0.2)

  Step 1 — Tailscale ping        ✓  14ms
  Step 2 — Gateway health        ✗  connect ECONNREFUSED 100.64.0.2:18790
  Step 3 — Round-trip wake       skipped (gateway unreachable)
  ────────────────────────────────────────
  1 check failed. H2 may be sleeping — try: cofounder wake h2-home
```

Exit code is `1` if any step fails.

---

## JSON output

```bash
$ cofounder test --json
```

```json
{
  "peer": "h2-home",
  "tailscale_ip": "100.64.0.2",
  "results": [
    { "step": "tailscale_ping",  "passed": true,  "rtt_ms": 12  },
    { "step": "gateway_health",  "passed": true,  "rtt_ms": 8   },
    { "step": "round_trip_wake", "passed": true,  "rtt_ms": 142 }
  ],
  "all_passed": true
}
```

Useful for health-check scripts and CI:

```bash
cofounder test --json | jq '.all_passed'
# true
```

---

## Targeting a specific peer

```bash
cofounder test --peer h2-pi
cofounder test --peer h2-home
```

---

## Common failures and fixes

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Step 1 fails | Tailscale not running on H2, or wrong IP | Check `tailscale status` on both machines |
| Step 2 fails | Gateway not running or port blocked | Run `cofounder wake <peer>` or check Windows Firewall |
| Step 3 fails, 1+2 pass | Gateway up but OpenClaw not responding | Restart OpenClaw on H2 |
| All fail | H2 is off | `cofounder wake <peer>` to send WOL packet |

---

## See also

- [cofounder status](/reference/status) — high-level status dashboard
- [cofounder wake](/reference/wake) — wake a sleeping H2 via WOL
- [cofounder logs](/reference/logs) — view task history for debugging
