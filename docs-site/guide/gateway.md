# Gateway Configuration

The OpenClaw gateway is the HTTP server that receives tasks and returns results. Tom and Jerry each run one. The configuration differs — Tom's gateway is private (loopback-only), Jerry's gateway is network-accessible (Tailscale IP).

---

## What the gateway does

- Receives `HHMessage` POSTs from Tom (Jerry side) or user CLI (Tom side)
- Verifies the gateway token on each request
- Forwards tasks to the OpenClaw agent runtime
- Returns results synchronously or via polling
- Serves a `/health` endpoint for reachability checks

The gateway is not a web server in the traditional sense — it's a local HTTP interface to the OpenClaw agent. It doesn't serve a UI.

---

## Tom's gateway — loopback binding

Tom's gateway binds to `127.0.0.1:3737`. It's only accessible from the same machine. The `tj` CLI communicates with it locally.

Tom never exposes its gateway to the network — it initiates outbound connections to Jerry, not the other way around.

```
Tom machine:
  127.0.0.1:3737 ← tj CLI, agent workflows
```

### Config

In `~/.his-and-hers/tj.json`:

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

The token is generated during `tj onboard`. Don't share it — it's the only auth layer on the gateway.

---

## Jerry's gateway — Tailscale binding

Jerry's gateway binds to its Tailscale IP (e.g. `100.x.y.z:3737`). Only nodes on the same Tailscale network can reach it.

```
Jerry machine:
  100.x.y.z:3737 ← Tom (over Tailscale WireGuard tunnel)
  127.0.0.1:3737 ← local tools, tj CLI
```

### Config

```json
{
  "role": "jerry",
  "gateway": {
    "bind": "100.x.y.z",
    "port": 3737,
    "token": "RANDOM_64_CHAR_HEX",
    "allowed_peers": ["100.tom.ip.here"]
  }
}
```

`allowed_peers` is an optional allowlist. If set, requests from any IP not in the list are rejected with 403. Recommended for multi-user Tailscale networks.

---

## Changing the port

Default is 3737. To use a different port:

```bash
tj onboard --reconfigure-gateway
# → Enter gateway port: 4242
```

Or edit `tj.json` directly and restart:

```bash
openclaw gateway stop
openclaw gateway start
```

On Windows: if you changed the port, update the Firewall rule too:

```powershell
# Remove old rule
Remove-NetFirewallRule -DisplayName "Tom-and-Jerry Gateway"

# Add new rule for the new port
New-NetFirewallRule -DisplayName "Tom-and-Jerry Gateway" `
  -Direction Inbound -Protocol TCP -LocalPort 4242 -Action Allow
```

---

## Gateway token

The token authenticates Tom's requests to Jerry. It's a 64-character hex string generated during `tj onboard`. It's stored in the OS keychain, not in plain text config files.

Tom includes the token in every request:

```http
POST http://100.x.y.z:3737/task
Authorization: Bearer <token>
Content-Type: application/json
```

Jerry verifies it before processing. Wrong token → 401. Right token, wrong peer IP (if allowlist set) → 403.

### Regenerating the token

```bash
tj onboard --regenerate-token
# → New token generated, synced to Jerry via SSH
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

Tom checks this endpoint to determine if Jerry is awake and ready. The check happens:
- Before every `tj send` (skip WOL if healthy)
- After sending WOL (poll until healthy)
- On every `tj status` run

---

## Socat proxy (advanced)

If you need Tom's gateway accessible on a network port for external tools (not typical), you can use a socat proxy:

```bash
# Forward network port 3737 to loopback 3737
socat TCP-LISTEN:3737,bind=100.x.y.z,reuseaddr,fork TCP:127.0.0.1:3737
```

The `tj onboard` wizard sets this up automatically if you need it. The pattern is used when you want Tom to also accept inbound connections from tools running elsewhere on your Tailscale network.

---

## Multi-gateway setup

If Tom and Jerry are both on the same machine (dev/testing):

```json
// Tom's config
{
  "gateway": { "bind": "127.0.0.1", "port": 3737 }
}

// Jerry's config (~/.his-and-hers-jerry/tj.json)
{
  "gateway": { "bind": "127.0.0.1", "port": 3738 }
}
```

Tom's `peers` config points to `127.0.0.1:3738` instead of a Tailscale IP.

---

## Checking gateway status

```bash
# Check OpenClaw gateway directly
openclaw gateway status

# Check via tj (includes peer connectivity)
tj status

# Direct health check (curl)
curl http://127.0.0.1:3737/health         # Tom
curl http://100.x.y.z:3737/health        # Jerry (from Tom's machine)
```

## Logs

```bash
# OpenClaw gateway logs
openclaw gateway logs

# Or follow live
openclaw gateway logs --follow

# On Linux (systemd)
journalctl -u tj-gateway -f
```
