# cofounder web

Launch a local web dashboard for the H1 node.

`cofounder web` starts a lightweight HTTP server (default port **3847**) and serves a
single-page dashboard — no build step, no external services, just Node built-ins.

---

## Synopsis

```bash
cofounder web [options]
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--port <port>` | Port to listen on | `3847` |
| `--no-open` | Don't open the browser automatically | (opens by default) |

---

## Dashboard panels

### Peers (sidebar)

One card per configured peer showing:

- **Gateway status** — live green/red dot (checked at startup, refreshed every 30s)
- Last heartbeat timestamp
- Tailscale hostname
- Active model

### Budget — this week (sidebar)

Real-time cost and token breakdown for the current week:

- Total tasks completed / failed / pending
- Cloud spend (USD)
- Cloud vs local token split
- Estimated local savings

### Send task (sidebar form)

Send a task to any configured peer directly from the dashboard.
Selecting a peer from the dropdown overrides the default. The task is persisted
to `~/.cofounder/state/tasks/` and dispatched via the same pipeline as `cofounder send`.

### Task feed (main panel)

Live-updated list of all task states, newest first.

**Filter bar** — click to filter by status:
`all` · `running` · `pending` · `done` · `failed`

**Click any task** to expand it and see:
- Full objective + constraints
- Result output (first 2000 chars)
- Error message (if failed)
- Task ID (for use with `cofounder replay`, `cofounder task-status`, etc.)

---

## Live updates

`cofounder web` uses **Server-Sent Events (SSE)** — the task list updates instantly
whenever a `.json` file changes in the task state directory, with no polling
on the client side. Peer status and budget refresh every 30 seconds.

---

## Examples

```bash
# Default — opens http://localhost:3847
cofounder web

# Custom port, no auto-open (good for remote/ssh)
cofounder web --port 8080 --no-open

# Open from another machine (forward the port first)
ssh -L 3847:localhost:3847 my-h1 cofounder web --no-open
# then visit http://localhost:3847 locally
```

---

## Notes

- The dashboard is **read/write** — the Send form dispatches real tasks.
- Only binds to `127.0.0.1` (loopback) — not exposed on the network.
- No authentication — keep it local or behind an SSH tunnel.
- Requires H1 config (`~/.cofounder/config.json`). Run `cofounder onboard` first.

---

## Exit

Press `Ctrl-C` to stop the server.
