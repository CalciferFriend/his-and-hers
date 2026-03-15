# Roadmap — his-and-hers

> Goal: someone with two machines runs `npx hh onboard`, answers a few questions,
> and has two agents talking in under 10 minutes — with whatever models they want.

---

## Phase 1 — Foundation ✅ (2026-03-11)

- [x] Protocol design (HHMessage, HHHandoff, HHHeartbeat, HHPair)
- [x] Core transport (Tailscale, SSH, WOL)
- [x] Gateway wake implementation (reverse-engineered OpenClaw WS protocol)
- [x] Socat proxy pattern for H1 (loopback + tailscale)
- [x] Reference implementation: Calcifer (AWS/Linux) ↔ GLaDOS (Home PC/Windows)
- [x] First bidirectional agent-to-agent message confirmed
- [x] First inter-agent code review completed
- [x] Bug fixes from code review (tailscale ping flag, wake id tracking, systemd path)

---

## Phase 2 — Plug & Play 🚧 (current)

> Owned by: Calcifer (H1/Linux) + GLaDOS (H2/Windows) in parallel

### 2a. Onboard wizard — core flow (Calcifer) ✅ (2026-03-12)
- [x] Prerequisites check (Node ≥ 22, Tailscale running, OpenClaw installed)
- [x] Role selection (H1/H2) with clear explanation of each
- [x] Identity setup (name, emoji, model provider)
- [x] Peer connection (Tailscale hostname/IP, SSH user/key, live test)
- [x] Gateway config write (loopback for H1, tailscale for H2)
- [x] Round-trip validation before declaring success

### 2b. Onboard wizard — Windows/H2 steps (GLaDOS)
- [x] AutoLogin registry setup (with recovery prompt)
- [x] Startup bat generation (`start-hh.bat` — gateway + hh watch --serve-capabilities)
- [x] Scheduled Task installation (logon trigger, belt-and-suspenders)
- [x] Windows Firewall rule for gateway port (stepFirewall, wizard step 9)
- [x] WOL prerequisites check (BIOS guidance, NIC settings)
- [ ] Test boot chain end-to-end

### 2c. Model provider abstraction (Calcifer) ✅ (2026-03-12)
- [x] Provider enum: `anthropic | openai | ollama | lmstudio | custom`
- [x] API key setup per provider (OS keychain via keytar)
- [x] Ollama auto-detect (is it running locally? list models)
- [x] Provider-specific OpenClaw config generation
- [x] Cost-routing: lightweight tasks → cloud, heavy → local (H2/Ollama)

### 2d. `hh send` pipeline (both)
- [x] H1: ping peer → WOL if needed → build HHMessage → send via wakeAgent
- [x] Timeout + retry logic
- [x] `hh send --wait` polls for result via task state file
- [x] H2: `hh result <id> <output>` — receive + store result back (code complete + 17 tests; GLaDOS pending real-machine test)
- [x] Streaming results (partial updates while H2 works) ✅ (2026-03-13 GLaDOS) — stream-server.ts + stream-client.ts, wired in send.ts + watch.ts, 22 new tests
- [ ] `hh send "generate an image of X"` → wakes GLaDOS, runs diffusion, returns path — Phase 4+

### 2e. `hh status` — live checks (Calcifer) ✅ (2026-03-11)
- [x] Tailscale reachability ping
- [x] Gateway health check (HTTP /health)
- [x] Last heartbeat timestamp
- [x] Current model + cost tracking
- [x] WOL capability indicator

### 2f. Docker H1 template (Calcifer) ✅ (2026-03-11)
- [x] `Dockerfile` for H1 node (Alpine + Node + OpenClaw + his-and-hers)
- [x] `docker-compose.yml` with env-var config
- [x] One-liner: `docker run -e ANTHROPIC_API_KEY=... calcifierai/h1`
- [x] Auto-registers with Tailscale on first boot (entrypoint.sh)

### 2g. HHMessage discriminated union (both) ✅ (2026-03-11)
- [x] `HHTaskMessage`, `HHResultMessage`, `HHHeartbeatMessage` typed envelopes
- [x] Zod discriminated union on `type` field
- [x] Typed payload per message type (no more `JSON.parse(payload)`)

### 2h. Agent-to-agent messaging script (Calcifer) ✅ (2026-03-12)
- [x] `send-to-agent.js` — standalone script, no build required
- [x] Resolves peer URL + token from config or CLI flags
- [x] Used by crons, CI, and agent sync protocols

---

## Phase 3 — Intelligence Layer 🚧 (current)

### 3a. Capability registry (Calcifer) ✅ (2026-03-12)
- [x] `HHCapabilityReport` Zod schema: GPU info, Ollama models, skill tags
- [x] Auto-scanner: probes nvidia-smi / rocm-smi / Metal, Ollama /api/tags,
      SD/ComfyUI ports, LM Studio, whisper binary
- [x] Persistent store: `~/.his-and-hers/capabilities.json` (H2) +
      `peer-capabilities.json` (H1 caches peer's report)
- [x] `hh capabilities scan|advertise|fetch|show|route` CLI
- [x] `routeTask()` — capability-aware routing with keyword heuristic fallback
- [x] 10 new tests (34 total, all passing)

### 3b. Gateway /capabilities endpoint (GLaDOS)
- [x] H2's gateway serves GET /capabilities → returns capabilities.json (`hh watch --serve-capabilities`)
- [x] Auth: verify gateway token before serving (same token as /health)
- [ ] GLaDOS: verify endpoint on real Windows machine after boot

### 3c. Budget tracking (Calcifer) ✅ (2026-03-12)
- [x] Token/cost tracking per session in task state (`TaskResult.cost_usd`, auto-computed)
- [x] Per-token pricing tables: Anthropic (Opus/Sonnet/Haiku), OpenAI (gpt-4o/mini, o3-mini), local ($0)
- [x] `hh budget` command: --today/week/month/all/--tasks/--json
- [x] Cloud vs local token breakdown, local savings estimate
- [x] Budget routing advice when cloud spend is high

### 3d. Handoff continuity (both) ✅ (2026-03-12, H1 side)
- [x] Context summary auto-generated when task completes (template-based, LLM-upgradeable)
- [x] Summary passed in `HHTaskMessage.context_summary` on next task
- [x] H1 retains last N=10 summaries per peer (~/.his-and-hers/context/<peer>.json)
- [ ] H2 side: include `context_summary` in HHResultMessage on result delivery (GLaDOS)

### 3e. Multi-H2 support (Calcifer) ✅ (2026-03-12)
- [x] Config: `peer_nodes[]` array added alongside `peer_node` (backwards-compatible)
- [x] `hh send --peer <name>` to target a specific H2
- [x] `hh send --auto` — capability-aware auto-selection via cached capabilities
- [x] `hh peers` — list all peers with GPU/Ollama/skill info; --ping for live check

### 3f. H2 skill registry endpoint (GLaDOS)
- [x] `hh capabilities advertise` runs on H2 startup (wired into `start-hh.bat` via `hh capabilities scan --quiet`)
- [ ] Auto-refresh: re-scan when Ollama model list changes (Phase 4+)

---

## Phase 4 — Community 🚧

### 4a. Community registry (Calcifer) ✅ (2026-03-12)
- [x] `hh publish` — publish anonymised node card to GitHub Gist registry
- [x] `hh discover` — browse community nodes with GPU/skill/provider/OS filters
- [x] `HHNodeCard` schema with capabilities, WOL support, tags, description

### 4b. H2 Docker images (Calcifer) ✅ (2026-03-12)
- [x] `docker/h2/Dockerfile` — CPU/Ollaman H2 image (Debian + Node 22 + Ollama)
- [x] `docker/h2/Dockerfile.cuda` — NVIDIA CUDA variant (tested: RTX 3070 Ti+)
- [x] `docker/h2/entrypoint.sh` — Tailscale auth, SSH server, Ollama start, config gen
- [x] `docker/h2/pull-models.sh` — pull comma-separated models at startup
- [x] `docker-compose.yml` — profiles: `h2-cpu` and `h2-cuda` added alongside H1
- [x] `docker/.env.example` — unified env template for both nodes
- [x] Pre-built M2 Mac instructions (`docs/h2-profiles/m2-mac.md` — uses `hh onboard`, no Docker)
- [x] Raspberry Pi 5 variant (ARM64 base image + quantized Ollama models) ✅ (2026-03-12)
- [x] RTX 4090 profile docs (`docs/h2-profiles/rtx-4090.md`) ✅ (2026-03-12)

### 4c. `hh logs` — task history viewer (Calcifer) ✅ (2026-03-12)
- [x] Pretty-printed log view with status badges, relative timestamps, peer name
- [x] Filters: --status, --peer, --since (24h / 7d / 30m), --limit
- [x] --output flag to include result text inline
- [x] --json for machine-readable piping
- [x] --follow mode: live tail with 2s polling, highlights new/updated tasks

### 4e. Task lifecycle commands (Calcifer) ✅ (2026-03-13)
- [x] `hh replay <id>` — re-send previous task by ID prefix; new task ID, original untouched; --peer/--wait/--dry-run/--notify flags; 13 tests
- [x] `hh cancel <id>` — mark pending/running task cancelled; --force/--all-pending flags; 14 tests
- [x] `hh peers` — list all configured peers with cached GPU/Ollama/skill info; --ping for live check; --json
- [x] `hh doctor` — comprehensive health diagnostics (local + per-peer); actionable remediation hints; --peer/--json flags
- [x] `hh upgrade` — npm registry version check; --check (exit 1 if outdated, CI-friendly); --json; respects NO_UPDATE_NOTIFIER
- [x] Reference docs added for all five commands; sidebar updated

### 4f. Docs catch-up — result / watch / heartbeat + troubleshooting (Calcifer) ✅ (2026-03-13)
- [x] `hh result` reference page — flags, executor contract, webhook delivery, exit codes
- [x] `hh watch` reference page — daemon lifecycle, executor env vars, streaming, Windows startup
- [x] `hh heartbeat` reference page — subcommands, flow diagram, payload format, auto-scheduling
- [x] `guide/troubleshooting.md` — 40+ common issues across setup, send, gateway, streaming, capabilities, Windows
- [x] Sidebar: result/watch/heartbeat wired in; Troubleshooting section added to guide sidebar
- [x] `reference/cli.md` updated with stubs for result/watch/heartbeat

### 4d. Discord community + showcase
- [ ] Discord community for his-and-hers setups
- [ ] Showcase: what are people building with it?
- [x] Docs site (VitePress) ✅ (2026-03-12) — 37 pages across guide/reference/protocol/hardware
- [x] GitHub Pages deploy workflow ✅ (2026-03-14 Calcifer) — `docs.yml` + env-based `VITE_DOCS_BASE`

### 4g. `hh monitor` reference docs (Calcifer) ✅ (2026-03-14)
- [x] `reference/monitor.md` — layout diagram, per-column descriptions, JSON schema, usage examples, exit codes
- [x] Sidebar entry added (`hh status` → `hh monitor` → `hh wake`)
- [x] `reference/cli.md` overview updated with monitor section

---

## Phase 5 — Resilience & Developer Experience ✅ (v0.3.0, 2026-03-14)

> Owned by: Calcifer (H1/Linux) + GLaDOS (H2/Windows) in parallel

### 5a. `hh config` command (Calcifer) ✅ (2026-03-12)
- [x] `hh config show` — pretty-print config, redact secrets
- [x] `hh config get <key>` — read a single key (dot-notation)
- [x] `hh config set <key> <value>` — write a key with auto type coercion
- [x] `hh config path` — print config file path

### 5b. `hh test` command (Calcifer) ✅ (2026-03-12)
- [x] Tailscale reachability check with RTT
- [x] Gateway health check
- [x] Round-trip wake message test with RTT
- [x] Summary table output (+ --json flag)
- [x] Exit code 1 on any failure (useful for CI/health scripts)

### 5c. `hh watch` daemon — H2-side task listener (GLaDOS)
- [x] Persistent process that polls for pending tasks from H1
- [x] Auto-dispatches via `--exec <cmd>` executor; emits to stdout when no executor
- [x] Configurable poll interval (default: 5s, `--interval`)
- [x] Graceful shutdown on SIGINT/SIGTERM
- [x] Auto-starts via `start-hh.bat` / `start-hh.sh` (startup scripts wired in Phase 2b)
- [ ] GLaDOS: validate end-to-end on real Windows machine

### 5d. Webhook result push (Calcifer) ✅ (2026-03-12)
- [x] H1 exposes POST /result on its gateway (authenticated, token-gated, one-shot)
- [x] `deliverResultWebhook()` helper in core — H2 calls this to push result back
- [x] `parseWebhookUrl()` parses webhook URL embedded in wake message
- [x] `startResultServer()` binds to Tailscale IP, auto-selects port, auto-closes after delivery
- [x] Fallback to polling if webhook not received (older H2 / network block)
- [x] Tests: 9 tests covering auth, task_id guard, timeout, one-shot close, URL parsing

### 5e. Exponential backoff + retry (Calcifer) ✅ (2026-03-12)
- [x] `hh send` retries on transient failures (gateway down, WS timeout) via `withRetry()`
- [x] Configurable max retries + base delay (`--max-retries` CLI flag)
- [x] Backoff state persisted so cron retries don't duplicate (`~/.his-and-hers/retry/<id>.json`)
- [x] `cronRetryDecision()` — send/skip/retry/backoff logic for cron safety
- [x] Tests: 19 tests covering withRetry, RetryState persistence, cronRetryDecision, nextRetryAt

### 5f. `hh schedule` — recurring task delegation (Calcifer) ✅ (2026-03-13)
- [x] `hh schedule add --cron "..." "<task>"` — register recurring H2 task + install crontab entry
- [x] `hh schedule list` — show all schedules with next-run time
- [x] `hh schedule remove <id>` — unregister + remove crontab entry
- [x] `hh schedule enable/disable <id>` — toggle without removing
- [x] `hh schedule run <id>` — manual trigger (updates last_run)
- [x] Schedule store: ~/.his-and-hers/schedules.json
- [x] Crontab installer/remover (system cron integration)
- [x] Tests: store CRUD + crontab parser

### 5g. Webhook notifications + streaming ✅ (2026-03-13 GLaDOS)
- [x] `deliverNotification()` — Discord/Slack/generic webhook on task completion
- [x] Rich Discord embed (colour-coded, peer/duration/cost fields)
- [x] Slack Block Kit message
- [x] Generic JSON payload fallback
- [x] 20 tests covering all three flavours + truncation + error handling
- [x] `--notify <url>` flag for `hh send` and `hh schedule add`
- [x] `startStreamServer()` — H1-side SSE chunk receiver for live partial output
- [x] `createChunkStreamer()` / `postChunk()` — H2-side streaming client
- [x] Wired in `send.ts` (starts server, embeds URL in wake message, displays chunks)
- [x] Wired in `watch.ts` (reads HH_STREAM_URL/HH_STREAM_TOKEN env, streams stdout)
- [x] 22 tests for stream server/client; integration test in roundtrip.integration.test.ts
- [x] Docs: streaming guide + updated send reference (2026-03-13 Calcifer)

### 5h. Persistent notification webhooks — `hh notify` (Calcifer) ✅ (2026-03-14)
- [x] `HHNotifyWebhook` Zod schema + `HHNotifyEvent` enum (`all` / `complete` / `failure`)
- [x] `loadNotifyWebhooks()`, `saveNotifyWebhooks()` — `~/.his-and-hers/notify-webhooks.json`
- [x] `addNotifyWebhook()` — UUID generation, duplicate URL guard, event default
- [x] `removeNotifyWebhook()` — ID-prefix match + removal
- [x] `filterWebhooksByEvent()` / `getActiveWebhooks()` — filter by task success/failure
- [x] `hh notify add/list/remove/test` command — full subcommand CLI with @clack prompts
- [x] `hh send` auto-fires persistent webhooks via `getActiveWebhooks()` (no --notify needed)
- [x] 18 tests covering load/add/remove/filter/getActive edge cases
- [x] `reference/notify.md` docs page + sidebar wired + `reference/cli.md` overview section

### 5i. Notify integration tests + persistent webhook guide (Calcifer) ✅ (2026-03-14)
- [x] `notify.integration.test.ts` — 10 end-to-end tests against a real loopback HTTP server:
      generic payload shape, non-2xx handling, unreachable server, event filter routing,
      `getActiveWebhooks()` pipeline, parallel delivery resilience, empty registry
- [x] `guide/notifications.md` — dedicated guide for the persistent webhook registry:
      quick start, all subcommand examples, event filter table, platform payload formats
      (Discord embed / Slack Block Kit / generic JSON), storage schema, send+schedule integration,
      troubleshooting section
- [x] Sidebar updated: "Live streaming & notifications" → "Live streaming" + "Persistent notifications"
- [x] Total tests: **461** (all passing)

### 5j. `hh prune` — stale state cleanup (Calcifer) ✅ (2026-03-14)
- [x] `parseDuration()` helper — parse `s/m/h/d/w` duration strings to ms
- [x] `resolveTargetStatuses()` — map `--status` flag to a Set<TaskStatus>
- [x] `prune()` — scan `~/.his-and-hers/state/tasks/` for stale terminal-status JSON files
- [x] Age cutoff via `--older-than` (default `30d`); only targets `completed/failed/timeout/cancelled`
- [x] Optional companion cleanup: `--include-retry` (retry state files), `--include-logs` (schedule logs)
- [x] Interactive preview table with clack + confirmation prompt; `--force` / `--dry-run` / `--json` flags
- [x] Wired into CLI as `hh prune` with full option set
- [x] Tests: 25 tests covering parseDuration, resolveTargetStatuses, integration scenarios; total: **486** (all passing)
- [x] `reference/prune.md` docs page + sidebar wired + `reference/cli.md` overview section

### 5k. `hh completion` — shell tab completion (Calcifer) ✅ (2026-03-14)
- [x] Bash, Zsh, Fish, PowerShell completion scripts generated from embedded command registry
- [x] Completes all top-level commands, subcommands (capabilities/schedule/notify/peers/config), and per-command flags
- [x] Auto-detects current shell from `$SHELL` when no arg given; `--no-hint` suppresses install hint
- [x] `COMMANDS` registry kept in sync with `index.ts`; easy to maintain when new commands land
- [x] 70 tests covering all four shell outputs, auto-detect, and error path
- [x] `reference/completion.md` docs page + sidebar wired

### 5l. `hh export` — task history export (Calcifer) ✅ (2026-03-14)
- [x] Markdown (default), CSV, and JSON output formats
- [x] `parseDuration()` + `applyFilters()` — `--since`, `--status`, `--peer` filters
- [x] `buildSummary()` — total tasks, by-status breakdown, total cost/tokens/compute time
- [x] `renderMarkdown()` — summary table + per-task sections with status icons; output truncated at 500 chars
- [x] `renderCsv()` — proper CSV escaping, 12 columns including optional `output`
- [x] `renderJson()` — `{ summary, tasks }` object for machine-readable piping
- [x] `--out <path>` to write to file; stdout by default; `--no-output` flag to strip result text
- [x] 48 tests covering all three formats, filtering, summary stats, edge cases
- [x] `reference/export.md` docs page + sidebar wired + `reference/cli.md` overview section

### 5m. `hh chat` — interactive multi-turn REPL (Calcifer) ✅ (2026-03-14)
- [x] Persistent readline loop; carries `context_summary` forward across turns
- [x] Loads last 3 context summaries for the peer at startup (persists to `~/.his-and-hers/context/<peer>.json`)
- [x] Streams partial output via `startStreamServer` if H2 supports it
- [x] Webhook result delivery (→ polling fallback) per turn; same pipeline as `hh send --wait`
- [x] Per-turn task state written to `~/.his-and-hers/state/tasks/` (visible in `hh logs`)
- [x] In-session commands: `.context`, `.clear`, `exit`/`quit`/`.q`/`:q`, Ctrl-C/Ctrl-D
- [x] WOL + gateway health check before first message; graceful error per-turn
- [x] Session summary on exit: turns, tokens, cost, duration
- [x] `--no-context`, `--peer`, `--timeout` flags; `--timeout` defaults to 300s
- [x] `reference/chat.md` docs page + sidebar wired + `reference/cli.md` overview section

### 5n. `hh template` — named task templates (Calcifer) ✅ (2026-03-14)
- [x] `HHTemplate` Zod schema: id, name, task, peer, timeout, notify_webhook, description, created_at
- [x] `loadTemplates()` / `saveTemplates()` — `~/.his-and-hers/templates.json`
- [x] `addTemplate()` — UUID generation, duplicate name guard (case-insensitive), placeholder detection
- [x] `removeTemplate()` / `findTemplate()` — lookup by exact name, full UUID, or id prefix
- [x] `extractPlaceholders()` — parses `{varname}`, `{1}` / `{2}` positional, `{*}` splat from task string
- [x] `substituteVars()` — fills named + positional + splat; throws with hint for missing named vars
- [x] `hh template add/list/show/run/remove` subcommand CLI with @clack prompts
- [x] `hh template run` delegates to `hh send` pipeline; supports `--var`, `--peer`, `--wait`, `--notify`, `--timeout`, `--latent`, `--auto-latent`
- [x] Wired into completion registry (add/list/show/run/remove + flag completions)
- [x] Tests: 33 tests (store.test.ts) covering all CRUD + substitution + edge cases; bug fix: malformed JSON test mkdir
- [x] `reference/template.md` docs page + sidebar wired + `reference/cli.md` overview section

### 5p. `hh web` — local dashboard (Calcifer) ✅ (2026-03-15)
- [x] Single-page HTTP dashboard (Node built-ins only, no extra deps)
- [x] Live task feed via SSE (`GET /events`) — updates without page refresh
- [x] Peer status sidebar: gateway health + Tailscale ping per peer
- [x] Budget panel: weekly cloud/local/total spend + savings estimate
- [x] Send-task form in sidebar: select peer, type task, submit via `POST /send`
- [x] Task list with status badges, elapsed time, peer label, output preview
- [x] Click-to-expand task detail (full output + cost + timestamps)
- [x] Status filter: All / Pending / Running / Completed / Failed
- [x] `hh web --port <n>` custom port (default 3847); `--no-open` to skip browser launch
- [x] `reference/web.md` docs page + sidebar wired + `reference/cli.md` overview section

### 5o. `@his-and-hers/sdk` — programmatic API (Calcifer) ✅ (2026-03-14)
- [x] `HH` class with `send()`, `status()`, `ping()`, `peers()`, `tasks()`, `getTask()`, `waitFor()`, `config()`
- [x] `createHH()` factory alias
- [x] `SDKConfig`, `SDKPeerConfig`, `SDKNodeConfig` types (minimal subset — no CLI dep)
- [x] Config reader: `loadConfig()` reads `~/.his-and-hers/hh.json`, returns `SDKConfig | null`
- [x] State reader/writer: `createTaskState`, `loadTaskState`, `listTaskStates`, `updateTaskState`, `pollTaskCompletion`
- [x] Full type definitions in `types.ts` (SendOptions, SendResult, StatusResult, PeerInfo, PingOptions, PingResult, TaskSummary, TasksOptions, HHOptions)
- [x] `routingHint` propagated in wake text (`routing_hint=<hint>` line — test-verified)
- [x] `config.ts` mock added to test suite (was unmocked, `vi.mocked(loadConfig)` failed)
- [x] 37 tests (all passing); total suite: **640** tests (34 files, all passing)
- [x] `reference/sdk.md` docs page + VitePress sidebar "SDK" section + `reference/cli.md` "Programmatic API" section

---

## Phase 6 — Latent Communication (Experimental) 🔬

> Target: Q3 2026 · Status: protocol design complete, implementation research

**Vision:** Enable agents to communicate via compressed hidden states instead of text tokens, reducing information loss and improving bandwidth efficiency. Based on Vision Wormhole (arXiv:2602.15382), Interlat (arXiv:2511.09149), and LatentMAS (arXiv:2511.20639).

### 6a. HHLatentMessage protocol type ✅ (2026-03-12)
- [x] HHLatentMessage Zod schema added to discriminated union
- [x] Support for Vision Wormhole codec path (heterogeneous models via visual encoder)
- [x] Support for LatentMAS KV-cache path (same-family models, training-free)
- [x] Mandatory text fallback for backwards compatibility
- [x] Serialization helpers: serializeLatent() and deserializeLatent()
- [x] Fixed: serializeLatent buffer overflow (float32 4B/element, not float16 2B/element)
- [x] Fixed: codec_output_dim/codec_tokens nonnegative (0 valid on KV-cache path)
- [x] Type guards: isLatentMessage()
- [x] Factory helper: createLatentMessage()
- [x] Tests: 9 new tests covering parsing, round-trip serialization, edge cases (all passing)

### 6b. HLCA sender integration (Calcifer) ✅ (2026-03-12)
- [ ] Hook into OpenClaw gateway to extract hidden states mid-inference (awaits upstream codec)
- [ ] Implement Vision Wormhole codec adapter (compress 2048d → 512d via visual encoder)
- [x] Add `--latent` flag to `hh send` command (hard-require latent; error if peer lacks it)
- [x] Add `--auto-latent` flag — prefer latent, fall back to text if peer doesn't support it
- [x] Auto-detect if peer supports latent via cached capability negotiation
- [x] Fallback: if peer doesn't advertise latent support, send text instead

### 6c. HLCA receiver integration (GLaDOS)
- [ ] OpenClaw gateway endpoint to accept HHLatentMessage
- [ ] Inject compressed latent via visual encoder pathway (Vision Wormhole approach)
- [ ] Parse and validate sender_model and codec_version match
- [ ] KV cache injection for LatentMAS path (same-family models)
- [ ] Graceful degradation: use fallback_text if latent parsing fails

### 6d. Capability advertisement (both)
- [x] Add `latent_codecs: ["vw-qwen3vl2b-v1"]` to HHCapabilityReport
- [x] Add `kv_compatible_models: ["llama-3.1-70b"]` for LatentMAS
- [ ] Gateway /capabilities endpoint serves latent support info
- [x] H1 caches peer latent capabilities in peer-capabilities.json

### 6e. Automatic routing and fallback (Calcifer)
- [x] `routeTask()` checks if peer supports latent before choosing message type
- [x] If latent supported: extract hidden state, compress, send HHLatentMessage
- [x] If not supported: fall back to text (existing HHTaskMessage)
- [x] Log compression ratio and bandwidth savings to task state

### 6f. Benchmarks and validation (both)
- [ ] Latency: latent vs text round-trip time on same hardware
- [ ] Accuracy: structured task completion rate (JSON generation, code, math)
- [ ] Bandwidth: bytes transmitted per task (compressed latent vs tokenized text)
- [ ] Test across H2 profiles: RTX 3070 Ti, RTX 4090, M2 Mac, Pi 5
- [ ] Document results in `docs/benchmarks/latent-vs-text.md`

### Research dependencies
- Vision Wormhole codec implementation (not yet open-sourced by authors)
- LatentMAS KV serialization format (reference implementation in PyTorch)
- OpenClaw middleware hooks for mid-inference hidden state extraction

**Note:** Phase 6 is marked experimental because the upstream codec implementations
are not production-ready. The protocol design is complete and ready to use once
the research implementations mature. See `docs/future.md` for detailed research
context and `docs/latent-communication.md` for implementation guide. ✅ (2026-03-14 Calcifer)

---

## Phase 7 — Fleet Orchestration 🚧 (current)

> Owned by: Calcifer (H1) + GLaDOS (H2) in parallel

### 7a. `hh broadcast` — concurrent multi-peer dispatch (Calcifer) ✅ (2026-03-15)
- [x] `broadcast()` — concurrent `sendToPeer()` per peer using `Promise.allSettled` / `Promise.race`
- [x] `BroadcastStrategy`: `all` (wait for every peer) and `first` (stop on first response)
- [x] Peer resolution: `--peers <names>` subset or all configured `peer_nodes[]`
- [x] Per-peer retry via `withRetry()` (same 3-attempt logic as `hh send`)
- [x] Optional gateway health check per peer; `--no-check` for faster dispatch
- [x] `BroadcastResult` type: peer, task_id, status, output, tokens, cost, timing
- [x] Aggregated summary: total/ok/failed counts, total cost/tokens, first-response peer
- [x] Human-readable output: dispatch table + per-peer result sections with status badges
- [x] `--json` output: `{ broadcast_id, task, peers, strategy, results[], summary }` schema
- [x] 18 tests covering peer resolution, strategy semantics, JSON shape, error paths
- [x] `reference/broadcast.md` docs page + sidebar wired + `reference/cli.md` overview section
- [x] Wired into completion registry (`--peers`, `--wait`, `--wait-timeout`, `--strategy`, `--no-check`, `--json`)

### 7b. `hh sync` — push workspace files to H2 (Calcifer) ✅ (2026-03-15)
- [x] `hh sync <path> [--peer <name>]` — rsync a local path to H2 over Tailscale SSH
- [x] `--dry-run` flag; `--delete` flag for destructive sync
- [x] Progress bar via clack spinner
- [x] `--watch` mode: re-sync on local file change (for live collaboration)
- [x] Wired into `hh send` as `--sync <path>` to auto-push before task dispatch
- [x] `buildRsyncArgs` / `parseRsyncStats` utilities exported for testing and SDK use
- [x] `SyncResult` type: ok, localPath, remotePath, peer, dryRun, filesTransferred, bytesTransferred, durationMs
- [x] `--dest <path>` for explicit remote destination (default: `~/basename`)
- [x] `--watch-interval <ms>` debounce control
- [x] 14 tests covering arg building, stat parsing, watch handle, result shape
- [x] `docs/reference/sync.md` reference page + SDK usage example

### 7c. `hh cluster` — named peer groups (Calcifer) ✅ (2026-03-15)
- [x] `clusters` field in `HHConfig` schema — `Record<string, string[]>`, persisted to hh.json
- [x] `hh clusters` / `hh cluster list` — list all groups with stale-peer annotation
- [x] `hh cluster add <name> --peers <csv>` — create or overwrite a named group
- [x] `hh cluster show <name>` — inspect group with IP + stale warnings
- [x] `hh cluster remove <name>` — delete a group (confirm prompt, `--force` to skip)
- [x] `hh cluster peers add <cluster> <peer>` — add single peer to existing cluster
- [x] `hh cluster peers remove <cluster> <peer>` — remove single peer from cluster
- [x] `--no-validate` flag on add/peers-add for pre-staging before all peers are paired
- [x] `hh broadcast "task" --cluster <name>` — resolve peers from cluster, mutually exclusive with `--peers`
- [x] `hh peers --cluster <name>` — filter peer list to named group
- [x] `resolveClusterPeers()` export for SDK / programmatic use
- [x] 33 tests covering all operations, JSON shapes, error paths, stale detection
- [x] `docs/reference/cluster.md` reference page + sidebar wired

### 7d. `hh attach` — file/context attachment for tasks (Calcifer) ✅ (2026-03-15)
- [x] `hh send "review this" --attach ./report.pdf` — file(s) attached to task message
- [x] Supported: PDF, images (PNG/JPEG/WebP/GIF), text, code, markdown, JSON, CSV, YAML, TOML, HTML, CSS, SQL, and 10+ code languages
- [x] `AttachmentPayload` schema in `HHTaskPayload` (base64 + mime + filename + size_bytes)
- [x] `loadAttachment()` / `loadAttachments()` utilities in `@his-and-hers/core`
- [x] `detectMimeType()` — extension-based MIME detection with 30+ type map
- [x] `isMultimodalType()` — PDF + images go to multimodal API; text/code as fenced blocks
- [x] `formatAttachmentSummary()` — wake text injection with per-file type hints for H2
- [x] `decodeAttachment()` — H2-side Buffer decode utility
- [x] 10 MB soft cap (warning), 50 MB hard cap (error), graceful per-file error collection
- [x] `--attach <paths...>` flag on `hh send` (multi-file via CLI variadic)
- [x] H2 integration guide documented (GLaDOS: decode + inject via multimodal API)
- [x] `ATTACH_SIZE_LIMIT_BYTES` / `ATTACH_HARD_LIMIT_BYTES` exported constants
- [x] 33 tests covering MIME detection, encoding, limits, schema validation, round-trips
- [x] `docs/reference/attach.md` reference page + SDK usage + H2 integration guide

### 7e. `hh pipeline` — chained multi-step task workflows (Calcifer) ✅ (2026-03-15)
- [x] Inline spec parser: `"peer1:task one -> peer2:review {{previous.output}}"`
- [x] JSON pipeline file support: `--file pipeline.json`
- [x] `PipelineDefinition` / `PipelineStep` / `PipelineStepResult` / `PipelineRunResult` types
- [x] `{{previous.output}}` / `{{steps.N.output}}` / `{{previous.error}}` placeholder interpolation
- [x] Sequential step execution with per-step timeout (default 120s)
- [x] `continueOnError` per step (default: abort pipeline on failure)
- [x] Skipped step tracking when pipeline is aborted mid-run
- [x] Aggregated `PipelineRunResult`: total cost, tokens, duration, step-level breakdown
- [x] Human-readable progress output (clack) + `--json` machine-readable output
- [x] `--timeout <s>` global override for all steps
- [x] `parsePipelineSpec` / `parsePipelineFile` / `interpolatePipelineTask` exported from `@his-and-hers/core`
- [x] Fixed: test suite mock — `vi.importActual` preserves pure parsers; 19 tests passing
- [x] Wired into CLI `index.ts` with `[spec]` positional + `--file`, `--timeout`, `--json` flags
- [x] `docs/reference/pipeline.md` reference page + sidebar wired

---

## Phase 8 — Automation & Polish 🚧 (current)

> Owned by: Calcifer (H1) + GLaDOS (H2) in parallel

### 8a. `hh workflow` — named pipeline workflows (Calcifer) ✅ (2026-03-15)
- [x] `HHWorkflow` / `HHWorkflowStep` types + Zod schema in `@his-and-hers/core`
- [x] Persistent registry: `~/.his-and-hers/workflows.json` via `loadWorkflows` / `addWorkflow` / `removeWorkflow` / `findWorkflow`
- [x] `recordWorkflowRun()` — increments `run_count`, updates `last_run_at` after each run
- [x] `workflowToPipelineDefinition()` — converts `HHWorkflow` to `PipelineDefinition` for execution
- [x] `hh workflow add <name> "<spec>"` — save from inline spec (validates with `parsePipelineSpec`)
- [x] `hh workflow add <name> --file pipeline.json` — save from JSON file
- [x] `--desc` / `--timeout` flags on `workflow add`
- [x] `hh workflow list [--json]` — list all workflows with step count + run history
- [x] `hh workflow show <name> [--json]` — inspect steps, timeout, run stats
- [x] `hh workflow run <name> [--timeout <s>] [--json]` — execute via temp-file → `pipeline()` reuse (no logic duplication)
- [x] `hh workflow remove <name> [--force]` — delete with confirm prompt
- [x] Name validation: `[a-zA-Z0-9_-]+` enforced
- [x] Fixed: `parsePipelineSpec` returns `PipelineStep[]` directly (not `{ steps }`) — corrected type annotation and destructuring in `workflow.ts`
- [x] 23 tests covering all operations, error paths, JSON output, run tracking
- [x] Wired into `packages/cli/src/index.ts`
- [x] `docs/reference/workflow.md` reference page + sidebar wired

### 8b. `hh run` — shorthand for common task patterns (Calcifer) ✅ (2026-03-15)
- [x] `hh run summarise <path>` — send file to default peer with summarise prompt
- [x] `hh run review <path>` — code review shorthand
- [x] `hh run diff [<base> [<head>]]` — diff-aware review (git diff piped inline)
- [x] `--peer <name>` override; falls back to `routeTask()` auto-selection
- [x] `--prompt` override to customise the task sent to H2
- [x] `docs/reference/run.md` reference page + sidebar wired

### 8c. `hh alias` — user-defined CLI shortcuts (Calcifer) ✅ (2026-03-15)
- [x] `hh alias add <name> "<command>"` — map a short name to any `hh` subcommand string
- [x] `hh alias list [--json]` — list all aliases
- [x] `hh alias show <name> [--json]` — inspect a specific alias
- [x] `hh alias run <name> [args...]` — expand + execute (re-invokes CLI)
- [x] `hh alias remove <name> [--force]`
- [x] Aliases persisted to `~/.his-and-hers/aliases.json`
- [x] Tab completion for `run` and `alias` subcommands via `hh completion`
- [x] `docs/reference/alias.md` reference page + sidebar wired

### 8d. E2E integration test suite (both) — Calcifer side ✅ (2026-03-15)
- [x] `MockGateway` class in `packages/core/src/gateway/mock-gateway.ts`
      — implements OpenClaw WS protocol (challenge → connect → hello-ok → wake → ACK)
      — `rejectAuth`, `dropConnection`, `helloDelayMs`, `wakeDelayMs` fault-injection opts
      — `receivedWakes[]` + `clearWakes()` for assertion
      — EventEmitter: "wake", "connect", "disconnect" events
      — exported from `@his-and-hers/core`
- [x] `mock-gateway.test.ts` — 22 tests across happy path, auth failures, timeouts, pipeline simulation, concurrent wakes
- [x] wakeAgent E2E: correct token → ok:true; wrong token → ok:false + auth error; timeout → ok:false + "timeout"
- [x] Pipeline simulation: sequential wakes, concurrent broadcast wakes
- [ ] GLaDOS: contribute Windows-side mock gateway for `hh watch` integration tests

---

## Phase 9 — Analytics, Release Tooling & Observability ✅ (2026-03-15)

> Owned by: Calcifer (H1) + GLaDOS (H2)

### 9a. `hh stats` — deep task analytics (Calcifer) ✅ (2026-03-15)
- [x] Tasks-per-day ASCII bar chart (configurable window, default 14 days)
- [x] 24-hour heatmap showing task density by hour
- [x] Per-peer breakdown: task count, success rate, avg duration, avg cost
- [x] Top task types inferred from objective text (top 5 first-word patterns)
- [x] `--days <n>`, `--peer <name>`, `--json` flags
- [x] Tests: 24 covering bucketing, heatmap, peer aggregation, top-types

### 9b. `hh release` — release workflow automation (Calcifer) ✅ (2026-03-15)
- [x] Semver bump (--patch/--minor/--major) across all packages/*/package.json
- [x] Auto-prepend CHANGELOG.md entry with git log since last tag
- [x] git commit + tag (vX.Y.Z)
- [x] `--push` flag to push commits + tags
- [x] `--dry-run` preview mode (no writes)
- [x] `--yes` skip confirmation prompts
- [x] Tests: 12 covering version bump logic, CHANGELOG format, dry-run

### 9c. GLaDOS: Windows-side `hh watch` integration tests (GLaDOS)
- [ ] Mirror mock-gateway pattern for Windows-side wakeAgent E2E
- [ ] Validate `hh watch` polling loop under fault injection (drop, delay, auth fail)

---

## Phase 10 — Named Profiles, Audit Log, CI Mode ✅ (2026-03-15)

> Owned by: Calcifer (H1)

### 10a. `hh profile` — named config profiles (Calcifer) ✅ (2026-03-15)
- [x] Multiple config support via `~/.his-and-hers/profiles/<name>.json`
- [x] Active profile tracking in `~/.his-and-hers/active-profile.json`
- [x] `HH_PROFILE` env var override for per-command profile switching
- [x] `hh profile list [--json]` — list all profiles, mark active with ★
- [x] `hh profile use <name>` — switch active profile
- [x] `hh profile create <name> [--from <existing>]` — create new profile (blank or copy)
- [x] `hh profile show [<name>] [--json]` — print profile config (mask gateway tokens)
- [x] `hh profile delete <name> [--force]` — delete profile (refuse if active)
- [x] Backward compat: `~/.his-and-hers/hh.json` treated as "default" profile
- [x] `loadConfig()` / `saveConfig()` respect active profile automatically
- [x] 18 tests covering list, use, create, show, delete, env var override
- [x] `docs/reference/profile.md` reference page

### 10b. `hh audit` — tamper-evident audit log (Calcifer) ✅ (2026-03-15)
- [x] Append-only log at `~/.his-and-hers/audit.log` (newline-delimited JSON)
- [x] Per-install HMAC key at `~/.his-and-hers/audit-key` (32-byte hex)
- [x] Each entry has: ts, seq, event, peer, task_id, objective, status, cost_usd, prev_hash, hash
- [x] Hash chain: first entry has `prev_hash: "genesis"`, subsequent entries link via SHA-256
- [x] `appendAuditEntry()` — create new entry with hash chain verification
- [x] `readAuditLog(filter)` — read entries with optional peer/since/limit filters
- [x] `verifyAuditChain()` — verify hash chain integrity, return { ok, brokenAt? }
- [x] `getOrCreateAuditKey()` — generate per-install key on first use
- [x] `hh audit list [--peer <name>] [--since 7d] [--limit 50] [--json]` — display log
- [x] `hh audit verify` — verify hash chain, print OK or which entry broke
- [x] `hh audit export [--json] [--csv] [--output file]` — export full log
- [x] Auto-append on `hh send` (task_sent), `hh watch` (task_received, task_completed)
- [x] 20 tests in `audit.test.ts` + 12 tests in `audit.test.ts` (CLI)
- [x] `docs/reference/audit.md` reference page

### 10c. `hh ci` — CI-friendly run mode (Calcifer) ✅ (2026-03-15)
- [x] No spinners, no colors, no interactive prompts
- [x] Always blocks waiting for result (like `--wait` mode)
- [x] Exits 0 on success, 1 on failure/timeout
- [x] `hh ci "<task>" [--json] [--output-file <path>]` command
- [x] Reads config from env vars: `HH_PEER`, `HH_TIMEOUT`, `HH_PROFILE`
- [x] `--json` flag: outputs `{ ok, task_id, result, cost_usd, duration_ms }` to stdout
- [x] `--output-file <path>`: writes result text to a file
- [x] GitHub Actions composite action at `packages/action/action.yml`
      — inputs: task, peer, timeout, hh_config (base64-encoded)
      — outputs: result, cost_usd, task_id
      — installs `npm install -g his-and-hers`, writes config, runs `hh ci --json`, extracts outputs
- [x] 15 tests covering env var reading, JSON output, exit codes, output file
- [x] Example GitHub Actions workflow in docs

**Phase 10 complete: 998 tests passing (up from 941). Named profiles, audit log, and CI mode shipped.**

---

## Who Owns What

| Area | Owner |
|------|-------|
| Wizard core + Linux steps | Calcifer 🔥 |
| Wizard Windows steps | GLaDOS 🤖 |
| Model provider abstraction | Calcifer 🔥 |
| `hh send` H1 side | Calcifer 🔥 |
| `hh send` H2 side | GLaDOS 🤖 |
| `hh status` | Calcifer 🔥 |
| Docker H1 template | Calcifer 🔥 |
| Ollama/local model integration | GLaDOS 🤖 |
| HHMessage discriminated union | Calcifer 🔥 |
| Windows boot chain testing | GLaDOS 🤖 |
| npm publish + CI | Calcifer 🔥 |

---

## Sync Protocol

Calcifer and GLaDOS coordinate via wake messages. When either agent completes a
chunk of work and pushes to the repo, they send a wake to the other with a summary
and next ask. Nic can check `git log` or ask either agent for a status update at
any time.

Repo: https://github.com/CalciferFriend/his-and-hers
