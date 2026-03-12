# `hh wake` — Reference

Send a Wake-on-LAN magic packet to a H2 node and optionally wait for its gateway to come online.

---

## Synopsis

```bash
hh wake [flags]
```

---

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--peer <name>` | default peer | Target a specific H2 by name |
| `--wait` | false | Poll until H2's gateway is healthy |
| `--timeout <s>` | 120 | Max seconds to wait when `--wait` is set |
| `--verbose` | false | Show magic packet details and poll progress |
| `--json` | false | JSON output |

---

## What it does

1. Looks up the target peer's WOL config (MAC address, broadcast IP, port)
2. Constructs a [Magic Packet](https://en.wikipedia.org/wiki/Wake-on-LAN#Magic_packet) (6× 0xFF + 16× MAC address)
3. Sends it as a UDP broadcast to `broadcast_ip:port` (default port: 9)
4. If `--wait`: polls `http://<h2-tailscale-ip>:<port>/health` every 2s until healthy or timeout

---

## Examples

```bash
# Send magic packet to default H2 (no wait)
hh wake

# Send and wait for gateway to come online
hh wake --wait

# Target a specific peer, wait, verbose
hh wake --peer h2-beast --wait --verbose

# With custom timeout
hh wake --peer h2-home --wait --timeout 60
```

---

## Verbose output

```bash
$ hh wake --peer h2-beast --wait --verbose
→ Peer: h2-beast
  MAC:       D8:5E:D3:AA:BB:CC
  Broadcast: 192.168.1.1:9
→ Sending magic packet...
  ✓ Sent (6 × 0xFF + 16 × D8:5E:D3:AA:BB:CC, 102 bytes)
→ Polling Tailscale reachability...
  Attempt  1/60: 100.a.b.c — no response
  Attempt  8/60: 100.a.b.c — no response
  Attempt 14/60: 100.a.b.c — ✓ reachable
→ Polling gateway health...
  Attempt 15/60: http://100.a.b.c:3737/health — no response
  Attempt 18/60: http://100.a.b.c:3737/health — ✓ healthy
→ H2 (h2-beast) is online. Boot time: 38s
```

---

## JSON output

```bash
$ hh wake --peer h2-beast --wait --json
```

```json
{
  "peer": "h2-beast",
  "mac": "D8:5E:D3:AA:BB:CC",
  "packet_sent": true,
  "came_online": true,
  "boot_time_seconds": 38,
  "gateway_healthy": true
}
```

If `--wait` is not passed:

```json
{
  "peer": "h2-home",
  "mac": "D8:5E:D3:04:18:B4",
  "packet_sent": true,
  "came_online": null
}
```

---

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Packet sent (or gateway healthy if `--wait`) |
| 1 | No WOL config for peer |
| 2 | Timeout: gateway didn't come online within `--timeout` |

---

## WOL not working?

See the full [Wake-on-LAN guide](/guide/wol) for BIOS, NIC, and router configuration steps.

Quick checklist:
- BIOS WOL enabled?
- NIC power management: "Allow magic packet to wake"?
- Router forwarding UDP port 9 to H2's static IP?
- Correct MAC address in peer config?

```bash
# Verify MAC address matches H2's NIC
# On H2 (Windows):
Get-NetAdapter | Select MacAddress

# On H2 (Linux/macOS):
ip link show eth0 | grep ether
```

---

## See also

- [Wake-on-LAN guide](/guide/wol) — full setup walkthrough
- [hh send](/reference/send) — WOL happens automatically on `hh send` if H2 is offline
- [hh status](/reference/status) — check WOL configuration status
