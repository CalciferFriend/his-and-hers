# `cofounder web`

Launch a local web dashboard for your H1 node. Provides a browser UI with a
live task feed, peer status cards, budget summary, and a send-task form.

```
cofounder web                 # start on default port 3847
cofounder web --port 8080     # custom port
cofounder web --no-open       # don't auto-open browser
```

---

## What's in the dashboard

| Panel | Description |
|-------|-------------|
| **Task feed** | Live list of all tasks — status badges, peer, cost, output. Updates via SSE (no polling). |
| **Peer cards** | One card per configured peer: gateway health, Tailscale reachability, capabilities badge. |
| **Budget bar** | This week's cloud spend and token usage at a glance. |
| **Send form** | Dispatch a new task to any peer without leaving the browser. |

---

## Server details

`cofounder web` runs a lightweight HTTP server using only Node built-ins (`http`, `fs`, `path`, `os`) —
no extra npm dependencies are installed.

The dashboard uses **Server-Sent Events (SSE)** for live updates. When a task
state file changes in `~/.cofounder/state/tasks/`, the new state is pushed to
all open browser tabs immediately.

Default port: **3847** (`cofounder` on a phone keypad).

---

## Flags

| Flag | Description |
|------|-------------|
| `--port <n>` | Port to listen on (default: 3847) |
| `--no-open` | Don't automatically open the browser after starting |

---

## Examples

**Start the dashboard:**

```sh
cofounder web
# ✔ Dashboard running at http://localhost:3847
```

**Run on a remote H1 node and forward the port:**

```sh
# On H1:
cofounder web --no-open --port 3847

# On your laptop:
ssh -L 3847:localhost:3847 h1-node
# Then open http://localhost:3847 in your browser
```

**Background the server while doing other work:**

```sh
cofounder web --no-open &
cofounder send "analyse this codebase" --wait
```

---

## API endpoints

The dashboard also exposes a JSON REST API for scripting:

| Endpoint | Description |
|----------|-------------|
| `GET /api/tasks` | All task states as JSON array |
| `GET /api/tasks/:id` | Single task state by ID |
| `GET /api/peers` | Peer list with health status |
| `GET /api/budget` | This week's `BudgetSummary` |
| `POST /api/send` | Dispatch a task (body: `{ task, peer? }`) |
| `GET /events` | SSE stream for live task + peer updates |

---

## See also

- [`cofounder logs`](./logs.md) — CLI task history viewer
- [`cofounder budget`](./budget.md) — CLI cost summary
- [`cofounder status`](./cli.md) — check peer reachability from the terminal
