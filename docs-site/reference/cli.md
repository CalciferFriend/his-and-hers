# CLI Reference — `cofounder`

`cofounder` is the command-line interface for cofounder. All commands work on both H1 and H2 nodes unless noted.

---

## Global flags

| Flag | Description |
|------|-------------|
| `--help`, `-h` | Show help for any command |
| `--version`, `-v` | Print version |
| `--json` | JSON output (supported by most commands) |

---

## Commands

### `cofounder` (no args)

First run → launches `cofounder onboard`. Subsequent runs → shows `cofounder status`.

---

### `cofounder onboard`

Interactive setup wizard. Configures role, identity, LLM provider, Tailscale pairing, SSH, Wake-on-LAN, gateway bind, Windows AutoLogin, and startup scripts.

```bash
cofounder onboard
cofounder onboard --role h1     # skip role selection
cofounder onboard --role h2
```

See [Quickstart](/guide/quickstart) for a full walkthrough.

---

### `cofounder send <task>`

Send a task to H2 (run from H1).

```bash
cofounder send "summarize the attached PDF"
cofounder send "generate a hero image, dark theme" --wait
cofounder send "run the test suite" --peer h2-beast
cofounder send "what is 2+2"      # fast, no WOL needed
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

### `cofounder status`

Show the health of both H1 and H2 nodes.

```bash
cofounder status
cofounder status --json
```

Displays: Tailscale reachability, gateway health, last heartbeat, current model, WOL capability, budget summary.

---

### `cofounder monitor`

Live terminal dashboard — peer health, recent tasks, and today's budget, refreshed every N seconds.

```bash
cofounder monitor               # refresh every 5s (Ctrl+C to quit)
cofounder monitor --interval 10 # custom refresh interval
cofounder monitor --once        # single snapshot, no loop
cofounder monitor --json        # print MonitorSnapshot as JSON and exit
```

See [`cofounder monitor` reference](/reference/monitor) for the full JSON schema and layout docs.

---

### `cofounder wake`

Send a Wake-on-LAN Magic Packet to H2.

```bash
cofounder wake
cofounder wake --peer h2-beast
cofounder wake --wait    # wait for gateway to come online
```

---

### `cofounder logs`

View task history.

```bash
cofounder logs                          # last 20 tasks
cofounder logs --follow                 # live tail, polls every 2s
cofounder logs --status failed          # filter by status
cofounder logs --peer h2-pi          # filter by peer
cofounder logs --since 24h              # time window (24h, 7d, 30m)
cofounder logs --limit 50
cofounder logs --output                 # include result text inline
cofounder logs --json                   # machine-readable
```

---

### `cofounder budget`

Show cost tracking.

```bash
cofounder budget                # today
cofounder budget --week
cofounder budget --month
cofounder budget --all
cofounder budget --tasks        # per-task breakdown
cofounder budget --json
```

See [Budget tracking](/guide/budget) for more.

---

### `cofounder capabilities`

Scan, advertise, fetch, and route via capabilities.

```bash
cofounder capabilities scan       # probe local hardware + models
cofounder capabilities advertise  # scan + save + notify H1
cofounder capabilities fetch      # pull H2's capabilities to H1 (run on H1)
cofounder capabilities show       # display cached capabilities
cofounder capabilities route "generate an image"  # preview routing decision
```

See [Capability routing](/guide/capabilities) for more.

---

### `cofounder discover`

Browse the community registry of published H2 nodes.

```bash
cofounder discover                          # browse all
cofounder discover --gpu                    # nodes with GPU
cofounder discover --skill image-gen        # nodes with image gen
cofounder discover --provider ollama        # Ollama nodes only
cofounder discover --os windows             # Windows Jerrys
cofounder discover --json
```

---

### `cofounder notify`

Manage **persistent notification webhooks** that fire automatically on every task result.

```bash
cofounder notify add <url>                          # register a webhook
cofounder notify add <url> --name "label" --on failure  # failure-only
cofounder notify list                               # show all registered webhooks
cofounder notify remove <id>                        # unregister by ID prefix
cofounder notify test                               # fire test payload to all webhooks
```

Webhooks fire automatically after every `cofounder send --wait` result — no `--notify` flag needed.
See [`cofounder notify` reference](/reference/notify) for full details and payload formats.

---

### `cofounder publish`

Publish your node card to the community registry (anonymized GitHub Gist).

```bash
cofounder publish          # guided flow: description, tags, public/private
cofounder publish --dry-run
```

See what gets published: `cofounder capabilities show` — no IP addresses, no API keys, just hardware + skill tags.

---

### `cofounder pair`

Manage peer connections.

```bash
cofounder pair              # interactive: add/remove/test peers
cofounder pair list         # list configured peers
cofounder pair test         # test all peers
cofounder pair remove <name>
```

---

### `cofounder doctor`

Diagnose connectivity, config, and setup issues.

```bash
cofounder doctor
```

Checks: Node version, Tailscale status, SSH access to peers, gateway health, WOL config, capability file freshness.

---

### `cofounder result`

Mark a pending task as completed or failed. Called by H2 after processing a delegated task.

```bash
cofounder result <id> "output text"
cofounder result <id> --fail "error message"
cofounder result <id> --output-file /tmp/result.txt
cofounder result <id> "done" --webhook-url http://100.x.x.x:38791/result
```

See [cofounder result reference](/reference/result) for full docs.

---

### `cofounder watch`

H2-side task listener daemon. Polls for pending tasks, dispatches them to an executor, and delivers results back to H1.

```bash
cofounder watch                                   # poll every 5s, print pending
cofounder watch --exec "node run-task.js"         # auto-dispatch to executor
cofounder watch --exec "node run-task.js" --serve-capabilities
cofounder watch --once                            # single-pass
cofounder watch --interval 10                     # custom poll interval
cofounder watch --dry-run                         # detect without executing
cofounder watch --json                            # machine-readable output
```

See [cofounder watch reference](/reference/watch) for full docs.

---

### `cofounder heartbeat`

Send, show, or record heartbeats between H1 and H2.

```bash
cofounder heartbeat           # show last heartbeat from peer
cofounder heartbeat send      # deliver a heartbeat to configured peer
cofounder heartbeat record --from GLaDOS --at <iso>
```

---

### `cofounder peers`

List all configured peer nodes with cached capability info.

```bash
cofounder peers              # list with cached GPU/model/skill info
cofounder peers --ping       # add live Tailscale reachability check
cofounder peers --json
```

The primary peer is marked with ★. See [cofounder peers reference](/reference/peers) for full docs.

---

### `cofounder replay`

Re-send a previous task by ID or prefix. Creates a new task ID — the original is untouched.

```bash
cofounder replay abc123            # replay by prefix
cofounder replay abc123 --peer gpu # override the target peer
cofounder replay abc123 --wait     # block until result arrives
cofounder replay abc123 --dry-run  # preview without sending
```

See [cofounder replay reference](/reference/replay) for full docs.

---

### `cofounder cancel`

Mark a pending or running task as cancelled.

```bash
cofounder cancel abc123            # cancel by ID prefix
cofounder cancel abc123 --force    # cancel even if already terminal
cofounder cancel --all-pending     # cancel every pending task
cofounder cancel --json
```

See [cofounder cancel reference](/reference/cancel) for full docs.

---

### `cofounder upgrade`

Check for newer versions of `cofounder` on npm.

```bash
cofounder upgrade              # interactive check with upgrade instructions
cofounder upgrade --check      # exit 1 if upgrade available (CI-friendly)
cofounder upgrade --json
```

See [cofounder upgrade reference](/reference/upgrade) for full docs.

---

### `cofounder template`

Save named task templates with `{variable}` placeholders and run them on demand.

```bash
# Save a template
cofounder template add summarize --task "Summarise this in {lang}: {*}" --peer GLaDOS

# List templates
cofounder template list

# Run a template — named var + positional splat
cofounder template run summarize --var lang=English "My long document..."

# Run and wait for result
cofounder template run summarize --var lang=French --wait "Mon document..."

# Inspect or remove
cofounder template show summarize
cofounder template remove summarize
```

Variables: `{varname}` → `--var name=value` · `{1}`, `{2}` → positional args · `{*}` → all args joined.

See [cofounder template reference](/reference/template) for full docs.

---

### `cofounder prune`

Clean up stale task state files, retry records, and schedule logs from `~/.cofounder/`.

```bash
cofounder prune                             # interactive — removes completed/failed tasks >30d old
cofounder prune --dry-run                   # preview without deleting
cofounder prune --older-than 7d --force     # no prompt, 7-day cutoff
cofounder prune --status failed             # only failed tasks
cofounder prune --include-retry --include-logs  # also clean retry + log files
cofounder prune --json                      # machine-readable JSON summary
```

Active tasks (`pending`, `running`) are **never** pruned.

See [cofounder prune reference](/reference/prune) for full docs including JSON schema and scheduled pruning examples.

---

### `cofounder export`

Export task history to a Markdown, CSV, or JSON report.

```bash
cofounder export                          # markdown report to stdout
cofounder export --format csv             # CSV table
cofounder export --format json            # JSON array with summary stats
cofounder export --since 7d               # last 7 days only
cofounder export --status completed       # filter by status
cofounder export --peer GLaDOS            # filter by peer
cofounder export --out report.md          # write to file
cofounder export --no-output              # omit result text (shorter report)
```

See [cofounder export reference](/reference/export) for full docs.

---

### `cofounder chat`

Interactive multi-turn REPL with a peer node. Context carries forward between turns.

```bash
cofounder chat                            # interactive session with primary peer
cofounder chat --peer GLaDOS               # target a specific peer
cofounder chat --no-context               # fresh context, no history carry-over
cofounder chat --timeout 600              # 10-minute turn timeout
```

In-session: `.context` shows context summary · `.clear` resets it · `exit` / Ctrl-C to quit.

See [cofounder chat reference](/reference/chat) for full docs.

---

### `cofounder completion`

Print a shell completion script to stdout. Source it to get tab completion for all `cofounder` commands.

```bash
eval "$(cofounder completion bash)"       # bash (add to ~/.bashrc for permanent)
eval "$(cofounder completion zsh)"        # zsh (add to ~/.zshrc for permanent)
cofounder completion fish | source        # fish
cofounder completion powershell | Out-String | Invoke-Expression   # PowerShell
cofounder completion                      # auto-detect current shell
```

See [cofounder completion reference](/reference/completion) for full docs.

---

### `cofounder web`

Launch a local web dashboard. Serves a single-page app with live task feed,
peer status cards, budget summary, and a send-task form.

```bash
cofounder web                             # start on port 3847, auto-open browser
cofounder web --port 8080 --no-open       # custom port, headless
```

See [cofounder web reference](/reference/web) for full docs.

---

### `cofounder broadcast`

Send the same task to multiple peer nodes concurrently. All peers fire in parallel;
optionally wait for every result or stop on the first response.

```bash
cofounder broadcast "run tests"                       # all peers, fire-and-forget
cofounder broadcast "code-review diff" --wait         # all peers, wait for results
cofounder broadcast "quick check" --peers glados,piper  # specific subset
cofounder broadcast "race query" --wait --strategy first  # stop on fastest response
cofounder broadcast "analyze data" --json             # machine-readable output
```

See [cofounder broadcast reference](/reference/broadcast) for full docs.

---

## Programmatic API

### `@cofounder/sdk`

The `@cofounder/sdk` package exposes the same capabilities as the CLI as a
typed Node.js/TypeScript API — no subprocess spawning, no stdout parsing.

```ts
import { HH } from "@cofounder/sdk";

const cf = new Cofounder();

// Fire-and-forget
const { id } = await cofounder.send("Run the nightly data sync");

// Wait for result
const result = await cofounder.send("Generate coverage report", { wait: true });
console.log(result.output);

// Check peer status
const status = await cofounder.status();
console.log(status.online, status.latencyMs + "ms");
```

Install: `npm install @cofounder/sdk`

See [@cofounder/sdk reference](/reference/sdk) for the full API.
