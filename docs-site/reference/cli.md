# CLI Reference — `hh`

`hh` is the command-line interface for his-and-hers. All commands work on both H1 and H2 nodes unless noted.

---

## Global flags

| Flag | Description |
|------|-------------|
| `--help`, `-h` | Show help for any command |
| `--version`, `-v` | Print version |
| `--json` | JSON output (supported by most commands) |

---

## Commands

### `hh` (no args)

First run → launches `hh onboard`. Subsequent runs → shows `hh status`.

---

### `hh onboard`

Interactive setup wizard. Configures role, identity, LLM provider, Tailscale pairing, SSH, Wake-on-LAN, gateway bind, Windows AutoLogin, and startup scripts.

```bash
hh onboard
hh onboard --role h1     # skip role selection
hh onboard --role h2
```

See [Quickstart](/guide/quickstart) for a full walkthrough.

---

### `hh send <task>`

Send a task to H2 (run from H1).

```bash
hh send "summarize the attached PDF"
hh send "generate a hero image, dark theme" --wait
hh send "run the test suite" --peer h2-beast
hh send "what is 2+2"      # fast, no WOL needed
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--wait` | Block until result is received (polls task state) |
| `--peer <name>` | Target a specific H2 by name |
| `--timeout <s>` | Max seconds to wait for result (default: 300) |
| `--attach <path>` | Attach a file to the task |
| `--json` | Output task ID + status as JSON |

See [Sending tasks](/guide/sending-tasks) for more.

---

### `hh status`

Show the health of both H1 and H2 nodes.

```bash
hh status
hh status --json
```

Displays: Tailscale reachability, gateway health, last heartbeat, current model, WOL capability, budget summary.

---

### `hh monitor`

Live terminal dashboard — peer health, recent tasks, and today's budget, refreshed every N seconds.

```bash
hh monitor               # refresh every 5s (Ctrl+C to quit)
hh monitor --interval 10 # custom refresh interval
hh monitor --once        # single snapshot, no loop
hh monitor --json        # print MonitorSnapshot as JSON and exit
```

See [`hh monitor` reference](/reference/monitor) for the full JSON schema and layout docs.

---

### `hh wake`

Send a Wake-on-LAN Magic Packet to H2.

```bash
hh wake
hh wake --peer h2-beast
hh wake --wait    # wait for gateway to come online
```

---

### `hh logs`

View task history.

```bash
hh logs                          # last 20 tasks
hh logs --follow                 # live tail, polls every 2s
hh logs --status failed          # filter by status
hh logs --peer h2-pi          # filter by peer
hh logs --since 24h              # time window (24h, 7d, 30m)
hh logs --limit 50
hh logs --output                 # include result text inline
hh logs --json                   # machine-readable
```

---

### `hh budget`

Show cost tracking.

```bash
hh budget                # today
hh budget --week
hh budget --month
hh budget --all
hh budget --tasks        # per-task breakdown
hh budget --json
```

See [Budget tracking](/guide/budget) for more.

---

### `hh capabilities`

Scan, advertise, fetch, and route via capabilities.

```bash
hh capabilities scan       # probe local hardware + models
hh capabilities advertise  # scan + save + notify H1
hh capabilities fetch      # pull H2's capabilities to H1 (run on H1)
hh capabilities show       # display cached capabilities
hh capabilities route "generate an image"  # preview routing decision
```

See [Capability routing](/guide/capabilities) for more.

---

### `hh discover`

Browse the community registry of published H2 nodes.

```bash
hh discover                          # browse all
hh discover --gpu                    # nodes with GPU
hh discover --skill image-gen        # nodes with image gen
hh discover --provider ollama        # Ollama nodes only
hh discover --os windows             # Windows Jerrys
hh discover --json
```

---

### `hh publish`

Publish your node card to the community registry (anonymized GitHub Gist).

```bash
hh publish          # guided flow: description, tags, public/private
hh publish --dry-run
```

See what gets published: `hh capabilities show` — no IP addresses, no API keys, just hardware + skill tags.

---

### `hh pair`

Manage peer connections.

```bash
hh pair              # interactive: add/remove/test peers
hh pair list         # list configured peers
hh pair test         # test all peers
hh pair remove <name>
```

---

### `hh doctor`

Diagnose connectivity, config, and setup issues.

```bash
hh doctor
```

Checks: Node version, Tailscale status, SSH access to peers, gateway health, WOL config, capability file freshness.

---

### `hh result`

Mark a pending task as completed or failed. Called by H2 after processing a delegated task.

```bash
hh result <id> "output text"
hh result <id> --fail "error message"
hh result <id> --output-file /tmp/result.txt
hh result <id> "done" --webhook-url http://100.x.x.x:38791/result
```

See [hh result reference](/reference/result) for full docs.

---

### `hh watch`

H2-side task listener daemon. Polls for pending tasks, dispatches them to an executor, and delivers results back to H1.

```bash
hh watch                                   # poll every 5s, print pending
hh watch --exec "node run-task.js"         # auto-dispatch to executor
hh watch --exec "node run-task.js" --serve-capabilities
hh watch --once                            # single-pass
hh watch --interval 10                     # custom poll interval
hh watch --dry-run                         # detect without executing
hh watch --json                            # machine-readable output
```

See [hh watch reference](/reference/watch) for full docs.

---

### `hh heartbeat`

Send, show, or record heartbeats between H1 and H2.

```bash
hh heartbeat           # show last heartbeat from peer
hh heartbeat send      # deliver a heartbeat to configured peer
hh heartbeat record --from GLaDOS --at <iso>
```

---

### `hh peers`

List all configured peer nodes with cached capability info.

```bash
hh peers              # list with cached GPU/model/skill info
hh peers --ping       # add live Tailscale reachability check
hh peers --json
```

The primary peer is marked with ★. See [hh peers reference](/reference/peers) for full docs.

---

### `hh replay`

Re-send a previous task by ID or prefix. Creates a new task ID — the original is untouched.

```bash
hh replay abc123            # replay by prefix
hh replay abc123 --peer gpu # override the target peer
hh replay abc123 --wait     # block until result arrives
hh replay abc123 --dry-run  # preview without sending
```

See [hh replay reference](/reference/replay) for full docs.

---

### `hh cancel`

Mark a pending or running task as cancelled.

```bash
hh cancel abc123            # cancel by ID prefix
hh cancel abc123 --force    # cancel even if already terminal
hh cancel --all-pending     # cancel every pending task
hh cancel --json
```

See [hh cancel reference](/reference/cancel) for full docs.

---

### `hh upgrade`

Check for newer versions of `his-and-hers` on npm.

```bash
hh upgrade              # interactive check with upgrade instructions
hh upgrade --check      # exit 1 if upgrade available (CI-friendly)
hh upgrade --json
```

See [hh upgrade reference](/reference/upgrade) for full docs.
