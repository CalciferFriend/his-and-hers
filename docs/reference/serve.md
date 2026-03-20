# `cofounder serve` — REST API Server

Start a lightweight HTTP API server exposing cofounder over a standard REST interface.

```bash
cofounder serve                     # default port 3848
cofounder serve --port 9000         # custom port
cofounder serve --token mytoken     # fixed token
cofounder serve --no-auth           # disable auth (local dev only)
cofounder serve --readonly          # disable mutating endpoints
```

---

## Overview

`cofounder serve` complements the other cofounder interfaces:

| Interface | Best for |
|-----------|----------|
| `cofounder send` / CLI | Interactive use from the terminal |
| `cofounder mcp` | LLM clients (Claude Desktop, Cursor, Zed) |
| `cofounder web` | Browser-based monitoring dashboard |
| **`cofounder serve`** | **Automation, CI, custom apps, language-agnostic integrations** |

---

## Authentication

All endpoints except `/`, `/health`, and `/openapi.json` require an API token.

**Pass the token as a header:**
```
X-HH-Token: <token>
```

**Or as a query param:**
```
GET http://localhost:3848/peers?token=<token>
```

**Token management:**
- Auto-generated on first `cofounder serve` run and stored at `~/.cofounder/serve-token` (mode 0600).
- Override with `--token <value>` or `HH_SERVE_TOKEN` environment variable.
- Disable entirely with `--no-auth` (local development only — never expose an auth-disabled server publicly).

---

## Endpoints

### `GET /health`
Liveness check. No auth required.

```json
{ "ok": true, "service": "cofounder", "version": "1.0" }
```

### `GET /openapi.json`
Full OpenAPI 3.1 specification. No auth required. Import into Postman, Insomnia, or any OpenAPI-compatible tool.

### `GET /`
API root listing available endpoints. No auth required.

---

### `GET /peers`
List all configured peers.

```json
[
  {
    "name": "glados",
    "tailscale_hostname": "glados.tail",
    "gateway_port": 18789,
    "ssh_user": "user",
    "wol_enabled": true
  }
]
```

### `GET /peers/:name`
Get a specific peer by name (case-insensitive).

### `POST /peers/:name/ping`
Live Tailscale ping to check reachability.

```json
{ "reachable": true, "ip": "100.119.44.38" }
```

### `POST /peers/:name/wake`
Wake a peer via its configured gateway. Sends a heartbeat ping to the peer's OpenClaw gateway.

---

### `GET /status`
All peers: gateway health + Tailscale reachability in one call.

```json
[
  {
    "name": "glados",
    "gateway_healthy": true,
    "ping_reachable": true,
    "ping_rtt_ms": null
  }
]
```

---

### `GET /tasks`
List tasks with optional filters.

**Query params:**
- `status` — filter by status (`pending`, `running`, `completed`, `failed`, `timeout`, `cancelled`)
- `peer` — filter by target peer name
- `since` — relative time window: `1h`, `24h`, `7d`, `1w`
- `limit` — max results (default: 50)

```bash
curl -H "X-HH-Token: $TOKEN" "http://localhost:3848/tasks?status=completed&peer=glados&limit=10"
```

### `GET /tasks/:id`
Get a specific task by ID (supports prefix matching).

### `POST /tasks`
Send a task to a peer.

**Request body:**
```json
{
  "task": "generate a hero image for the landing page",
  "peer": "glados",
  "wait": false,
  "timeout": 120
}
```

**Fields:**
- `task` (required) — the objective to send
- `peer` — target peer name (default: first configured peer)
- `wait` — block until task completes (default: `false`)
- `timeout` — seconds to wait when `wait=true` (default: 120)

**Response (fire-and-forget, `wait=false`):**
```json
{
  "ok": true,
  "task_id": "abc123...",
  "peer": "glados",
  "result": null,
  "duration_ms": 87
}
```

**Response (with `wait=true`):**
```json
{
  "ok": true,
  "task_id": "abc123...",
  "peer": "glados",
  "result": {
    "output": "Image generated at ~/images/hero-v3.png",
    "success": true,
    "artifacts": ["~/images/hero-v3.png"],
    "tokens_used": 1240,
    "duration_ms": 8430,
    "cost_usd": 0.0031
  },
  "duration_ms": 8520
}
```

### `DELETE /tasks/:id`
Cancel a pending or running task.

---

### `POST /broadcast`
Send a task to multiple peers simultaneously.

**Request body:**
```json
{
  "task": "run system diagnostics",
  "peers": ["glados", "forge"],
  "strategy": "all",
  "wait": false,
  "timeout": 120
}
```

**`strategy`:**
- `"all"` (default) — send to all specified peers, return all results
- `"first"` — race; return as soon as the first peer responds

**Response (`strategy="all"`):**
```json
{
  "broadcast_id": "4a7c2b...",
  "strategy": "all",
  "task": "run system diagnostics",
  "results": [
    { "peer": "glados", "task_id": "...", "ok": true, "result": null },
    { "peer": "forge", "task_id": "...", "ok": true, "result": null }
  ],
  "summary": { "total": 2, "ok": 2, "failed": 0, "duration_ms": 142 }
}
```

---

### `GET /budget`
Weekly cost summary — total spend, cloud vs local, by peer.

### `GET /capabilities`
Cached peer capability report (last populated by `cofounder capabilities fetch`).

---

### `GET /events`
Server-sent events stream for real-time task updates.

**Events emitted:**
- `connected` — stream established
- `task_sent` — task dispatched to a peer
- `task_completed` — task completed (when `wait=true`)
- `task_failed` — task failed
- `task_cancelled` — task cancelled

```bash
curl -H "X-HH-Token: $TOKEN" http://localhost:3848/events
```

---

## Examples

### Send a task and get the ID back

```bash
TOKEN=$(cat ~/.cofounder/serve-token)

curl -s -X POST http://localhost:3848/tasks \
  -H "X-HH-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"task": "generate release notes for v1.2.0"}' | jq .task_id
```

### Wait for result

```bash
curl -s -X POST http://localhost:3848/tasks \
  -H "X-HH-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"task": "summarise the weekly metrics", "wait": true, "timeout": 60}' | jq .result.output
```

### Poll task status

```bash
TASK_ID="abc123..."
curl -s -H "X-HH-Token: $TOKEN" http://localhost:3848/tasks/$TASK_ID | jq '{status, result}'
```

### Check all peers

```bash
curl -s -H "X-HH-Token: $TOKEN" http://localhost:3848/status | jq .
```

### Subscribe to events

```python
import sseclient, requests

token = open("~/.cofounder/serve-token").read().strip()
url = "http://localhost:3848/events"
resp = requests.get(url, headers={"X-HH-Token": token}, stream=True)
client = sseclient.SSEClient(resp)
for event in client.events():
    print(f"{event.event}: {event.data}")
```

---

## Read-only mode

Pass `--readonly` to disable all `POST` and `DELETE` endpoints. Useful when exposing the server for monitoring without allowing task dispatch.

```bash
cofounder serve --readonly
```

---

## Environment variables

| Variable | Description |
|----------|-------------|
| `HH_SERVE_PORT` | Override default port (3848) |
| `HH_SERVE_TOKEN` | Override API token |

---

## OpenAPI / Swagger

The spec is always available at `/openapi.json`. Import it:

- **Postman:** Import → Link → `http://localhost:3848/openapi.json`
- **Insomnia:** Import → URL → `http://localhost:3848/openapi.json`
- **Swagger UI:** Use `swagger-ui-express` or the Swagger online editor
