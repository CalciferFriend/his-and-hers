# `cofounder monitor` — Reference

Live terminal dashboard for your agent network. Shows peer health, recent tasks, and today's budget — refreshed on a configurable interval.

---

## Synopsis

```bash
cofounder monitor [flags]
```

---

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--interval <s>` | `5` | Refresh interval in seconds (minimum: 2) |
| `--once` | false | Print a single snapshot and exit (no live loop) |
| `--json` | false | Print snapshot as JSON and exit |

---

## Layout

```
════════════════════════════════════════════════════════════════════════
 cofounder monitor  🔥 calcifer (h1)                  Sat, 14 Mar 2026 04:54 UTC
════════════════════════════════════════════════════════════════════════

PEERS
  🤖 glados (h2)  ts: ✓ 100.64.0.2  gw ✓  WOL:AA:BB:CC:DD:EE:FF
  👁  hal9000 (h2) ts: ✗ 100.64.0.3  gw ✗  no WOL

RECENT TASKS  (last 8)
  ID        PEER        STATUS      WHEN      DUR       COST
  ──────────────────────────────────────────────────────────
  abc12345  glados      ✓ done      2m ago    3.2s      $0.0023
     Summarize the project status

  def89abc  hal9000     ✗ failed    1h ago    —         —
     Render overnight batch

BUDGET TODAY
  Cloud: $0.0023  Local: 0 tok (0%)  Tasks: 1 done  1 failed  0 pending

────────────────────────────────────────────────────────────────────────
  Refreshing every 5s  ·  Ctrl+C to quit
```

---

## Sections

### Header

Shows the H1 node name, emoji, role, and the current UTC time.

### Peers

One row per configured peer. Columns:

| Symbol | Meaning |
|--------|---------|
| `ts: ✓ <ip>` | Tailscale ping succeeded |
| `ts: ✗ <ip>` | Tailscale unreachable |
| `ts: ?` | Probe not yet run |
| `gw ✓` | Gateway `/health` responded OK |
| `gw ✗` | Gateway unreachable or unhealthy |
| `WOL:<mac>` | Wake-on-LAN is configured |
| `no WOL` | Wake-on-LAN not configured |

Network probes run in parallel — a slow or down peer never blocks the others.

### Recent Tasks

Shows the 8 most recent tasks across all peers, newest first.

| Column | Description |
|--------|-------------|
| `ID` | First 8 chars of the task UUID |
| `PEER` | Target H2 node name |
| `STATUS` | `✓ done`, `✗ failed`, `⏳ pending`, `⚡ running`, `⏱ timeout`, `⊘ cancel` |
| `WHEN` | Time since task was created (`5s ago`, `2m ago`, `3h ago`) |
| `DUR` | Execution duration on H2 (blank if not yet complete) |
| `COST` | Cloud cost in USD, or `$0 local` for Ollama/LM Studio |

The objective is shown on a second line, truncated to 30 characters.

### Budget Today

A one-line summary of today's spend:

- **Cloud:** total USD spent on cloud API calls
- **Local:** tokens processed by Ollama/LM Studio (and what % of all tokens)
- **Tasks:** completed / failed / pending counts

---

## Usage examples

### Default — live dashboard

```bash
cofounder monitor
```

Refreshes every 5 seconds. Press `Ctrl+C` to quit — the terminal cursor is restored on exit.

### Custom interval

```bash
cofounder monitor --interval 10    # refresh every 10 seconds
cofounder monitor --interval 2     # minimum: 2 seconds
```

### Single snapshot

```bash
cofounder monitor --once
```

Prints one frame and exits. Useful in scripts or when you just want a quick look without a live loop.

### JSON snapshot

```bash
cofounder monitor --json
```

Prints the full `MonitorSnapshot` object as formatted JSON and exits. Useful for piping into `jq` or a monitoring script.

#### JSON schema

```json
{
  "ts": "2026-03-14T04:54:00.000Z",
  "this_node": {
    "name": "calcifer",
    "emoji": "🔥",
    "role": "h1"
  },
  "peers": [
    {
      "name": "glados",
      "emoji": "🤖",
      "role": "h2",
      "tailscale_ip": "100.64.0.2",
      "reachable": true,
      "gateway_live": true,
      "wol_enabled": true,
      "wol_mac": "AA:BB:CC:DD:EE:FF",
      "gateway_port": 18789
    }
  ],
  "recent_tasks": [ /* TaskState[] — up to 8, newest first */ ],
  "budget": {
    "cloud_cost_usd": 0.0023,
    "local_tokens": 0,
    "total_tokens": 4200,
    "completed": 1,
    "failed": 0,
    "pending": 0
  }
}
```

---

## Related commands

- [`cofounder status`](/reference/status) — single-line health check (no dashboard)
- [`cofounder logs`](/reference/logs) — full task history with filters
- [`cofounder budget`](/reference/budget) — detailed cost breakdown
- [`cofounder peers`](/reference/peers) — peer list with capability info
- [`cofounder doctor`](/reference/doctor) — actionable diagnostic suite

---

## Exit codes

| Code | Condition |
|------|-----------|
| `0` | Normal exit (Ctrl+C in live mode, or `--once`/`--json` succeeded) |
| `1` | No config found — run `cofounder onboard` first |
