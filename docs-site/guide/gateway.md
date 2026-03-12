# Gateway Configuration

The OpenClaw gateway is the HTTP server that receives tasks and returns results. H1 and H2 each run one. The configuration differs — H1's gateway is private (loopback-only), H2's gateway is network-accessible (Tailscale IP).

---

## What the gateway does

- Receives `HHMessage` POSTs from H1 (H2 side) or user CLI (H1 side)
- Verifies the gateway token on each request
- Forwards tasks to the OpenClaw agent runtime
- Returns results synchronously or via polling
- Serves a `/health` endpoint for reachability checks

The gateway is not a web server in the traditional sense — it's a local HTTP interface to the OpenClaw agent. It doesn't serve a UI.

---

## H1's gateway — loopback binding

H1's gateway binds to `127.0.0.1:3737`. It's only accessible from the same machine. The `hh` CLI communicates with it locally.

H1 never exposes its gateway to the network — it initiates outbound connections to H2, not the other way around.

```
H1 machine:
  127.0.0.1:3737 ← hh CLI, agent workflows
```

### Config

In `~/.his-and-hers/hh.json`:

```json
{
  "role": "tom",
  "gateway": {
    "bind": "127.0.0.1",
    "port": 3737,
    "token": "RANDOM_64_CHAR_HEX"
  }
}
```

The token is generated during `hh onboard`. Don't share it — it's the only auth layer on the gateway.

---

## H2's gateway — Tailscale binding

H2's gateway binds to its Tailscale IP (e.g. `100.x.y.z:3737`). Only nodes on the same Tailscale network can reach it.

```
H2 machine:
  100.x.y.z:3737 ← H1 (over Tailscale WireGuard tunnel)
  127.0.0.1:3737 ← local tools, hh CLI
```

### Config

```json
{
  "role": "jerry",
  "gateway": {
    "bind": "100.x.y.z",
    "port": 3737,
    "token": "RANDOM_64_CHAR_HEX",
    "allowed_peers": ["100.h1.ip.here"]
  }
}
```

`allowed_peers` is an optional allowlist. If set, requests from any IP not in the list are rejected with 403. Recommended for multi-user Tailscale networks.

---

## Changing the port

Default is 3737. To use a different port:

```bash
hh onboard --reconfigure-gateway
# → Enter gateway port: 4242
```

Or edit `hh.json` directly and restart:

```bash
openclaw gateway stop
openclaw gateway start
```

On Windows: if you changed the port, update the Firewall rule too:

```powershell
# Remove old rule
Remove-NetFirewallRule -DisplayName "His-and-Hers Gateway"

# Add new rule for the new port
New-NetFirewallRule -DisplayName "His-and-Hers Gateway" `
  -Direction Inbound -Protocol TCP -LocalPort 4242 -Action Allow
```

---

## Gateway token

The token authenticates H1's requests to H2. It's a 64-character hex string generated during `hh onboard`. It's stored in the OS keychain, not in plain text config files.

H1 includes the token in every request:

```http
POST http://100.x.y.z:3737/task
Authorization: Bearer <token>
Content-Type: application/json
```

H2 verifies it before processing. Wrong token → 401. Right token, wrong peer IP (if allowlist set) → 403.

### Regenerating the token

```bash
hh onboard --regenerate-token
# → New token generated, synced to H2 via SSH
```

---

## Gateway health endpoint

Both gateways expose:

```
GET /health
```

Response:

```json
{
  "status": "healthy",
  "role": "jerry",
  "node": "GLaDOS",
  "uptime_seconds": 3724,
  "version": "0.5.2"
}
```

H1 checks this endpoint to determine if H2 is awake and ready. The check happens:
- Before every `hh send` (skip WOL if healthy)
- After sending WOL (poll until healthy)
- On every `hh status` run

---

## Socat proxy (advanced)

If you need H1's gateway accessible on a network port for external tools (not typical), you can use a socat proxy:

```bash
# Forward network port 3737 to loopback 3737
socat TCP-LISTEN:3737,bind=100.x.y.z,reuseaddr,fork TCP:127.0.0.1:3737
```

The `hh onboard` wizard sets this up automatically if you need it. The pattern is used when you want H1 to also accept inbound connections from tools running elsewhere on your Tailscale network.

---

## Multi-gateway setup

If H1 and H2 are both on the same machine (dev/testing):

```json
// H1's config
{
  "gateway": { "bind": "127.0.0.1", "port": 3737 }
}

// H2's config (~/.his-and-hers-h2/hh.json)
{
  "gateway": { "bind": "127.0.0.1", "port": 3738 }
}
```

H1's `peers` config points to `127.0.0.1:3738` instead of a Tailscale IP.

---

## Checking gateway status

```bash
# Check OpenClaw gateway directly
openclaw gateway status

# Check via hh (includes peer connectivity)
hh status

# Direct health check (curl)
curl http://127.0.0.1:3737/health         # H1
curl http://100.x.y.z:3737/health        # H2 (from H1's machine)
```

## Logs

```bash
# OpenClaw gateway logs
openclaw gateway logs

# Or follow live
openclaw gateway logs --follow

# On Linux (systemd)
journalctl -u hh-gateway -f
```
