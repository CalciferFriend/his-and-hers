# CLI Reference — `tj`

`tj` is the command-line interface for his-and-hers. All commands work on both Tom and Jerry nodes unless noted.

---

## Global flags

| Flag | Description |
|------|-------------|
| `--help`, `-h` | Show help for any command |
| `--version`, `-v` | Print version |
| `--json` | JSON output (supported by most commands) |

---

## Commands

### `tj` (no args)

First run → launches `tj onboard`. Subsequent runs → shows `tj status`.

---

### `tj onboard`

Interactive setup wizard. Configures role, identity, LLM provider, Tailscale pairing, SSH, Wake-on-LAN, gateway bind, Windows AutoLogin, and startup scripts.

```bash
tj onboard
tj onboard --role tom     # skip role selection
tj onboard --role jerry
```

See [Quickstart](/guide/quickstart) for a full walkthrough.

---

### `tj send <task>`

Send a task to Jerry (run from Tom).

```bash
tj send "summarize the attached PDF"
tj send "generate a hero image, dark theme" --wait
tj send "run the test suite" --peer jerry-beast
tj send "what is 2+2"      # fast, no WOL needed
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--wait` | Block until result is received (polls task state) |
| `--peer <name>` | Target a specific Jerry by name |
| `--timeout <s>` | Max seconds to wait for result (default: 300) |
| `--attach <path>` | Attach a file to the task |
| `--json` | Output task ID + status as JSON |

See [Sending tasks](/guide/sending-tasks) for more.

---

### `tj status`

Show the health of both Tom and Jerry nodes.

```bash
tj status
tj status --json
```

Displays: Tailscale reachability, gateway health, last heartbeat, current model, WOL capability, budget summary.

---

### `tj wake`

Send a Wake-on-LAN Magic Packet to Jerry.

```bash
tj wake
tj wake --peer jerry-beast
tj wake --wait    # wait for gateway to come online
```

---

### `tj logs`

View task history.

```bash
tj logs                          # last 20 tasks
tj logs --follow                 # live tail, polls every 2s
tj logs --status failed          # filter by status
tj logs --peer jerry-pi          # filter by peer
tj logs --since 24h              # time window (24h, 7d, 30m)
tj logs --limit 50
tj logs --output                 # include result text inline
tj logs --json                   # machine-readable
```

---

### `tj budget`

Show cost tracking.

```bash
tj budget                # today
tj budget --week
tj budget --month
tj budget --all
tj budget --tasks        # per-task breakdown
tj budget --json
```

See [Budget tracking](/guide/budget) for more.

---

### `tj capabilities`

Scan, advertise, fetch, and route via capabilities.

```bash
tj capabilities scan       # probe local hardware + models
tj capabilities advertise  # scan + save + notify Tom
tj capabilities fetch      # pull Jerry's capabilities to Tom (run on Tom)
tj capabilities show       # display cached capabilities
tj capabilities route "generate an image"  # preview routing decision
```

See [Capability routing](/guide/capabilities) for more.

---

### `tj discover`

Browse the community registry of published Jerry nodes.

```bash
tj discover                          # browse all
tj discover --gpu                    # nodes with GPU
tj discover --skill image-gen        # nodes with image gen
tj discover --provider ollama        # Ollama nodes only
tj discover --os windows             # Windows Jerrys
tj discover --json
```

---

### `tj publish`

Publish your node card to the community registry (anonymized GitHub Gist).

```bash
tj publish          # guided flow: description, tags, public/private
tj publish --dry-run
```

See what gets published: `tj capabilities show` — no IP addresses, no API keys, just hardware + skill tags.

---

### `tj pair`

Manage peer connections.

```bash
tj pair              # interactive: add/remove/test peers
tj pair list         # list configured peers
tj pair test         # test all peers
tj pair remove <name>
```

---

### `tj doctor`

Diagnose connectivity, config, and setup issues.

```bash
tj doctor
```

Checks: Node version, Tailscale status, SSH access to peers, gateway health, WOL config, capability file freshness.

---

### `tj heartbeat`

Manually send a heartbeat to Tom (typically run automatically by Jerry's gateway).

```bash
tj heartbeat
tj heartbeat --peer tom-name
```
