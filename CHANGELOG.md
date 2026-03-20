# Changelog

All notable changes to cofounder will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Phase 13 — `cofounder chat` test suite + `cofounder context` CLI**
  - **`chat.test.ts`**: 22 tests covering all major paths in `cofounder chat` — happy path (single turn with webhook result), polling fallback (no webhook server), WOL wake (peer offline → wake succeeds/fails), gateway-down failure (peer up but gateway not responding), send failure (SSH connection failed), timeout path (turn times out), exit keywords (`exit`, `quit`, `.q`), `.context`/`.clear` slash commands (show/clear stored context mid-session), `--no-context` flag (skips loadContextSummary), context carry-over (H2's `context_summary` forwarded to turn 2), `--peer` option (selects correct peer), session summary output (printed at exit when turns > 0, not printed when no turns completed), turn failure recovery (turn fails gracefully, loop continues), token/cost accumulation across turns.
  - **`cofounder context list/show/clear/prune`**: inspect and manage per-peer context history from the CLI. `list` scans `~/.cofounder/context/*.json` and shows peer name, entry count, and most recent timestamp. `show <peer>` displays all stored context entries for a peer. `clear <peer>` wipes context for a peer (calls `clearContextEntries()`). `prune [--days <n>]` removes entries older than N days (default 30).
  - **`context.test.ts`**: 15 tests covering list (empty case, single peer, multiple peers sorted by most recent, peer with zero entries), show (displays entries, handles unknown peer, formats summaries), clear (calls clearContextEntries, confirms message, sets exitCode on error), prune (removes old entries, keeps recent ones, default 30 days, custom --days, logs step for each peer, handles multiple peers).
  - Tests: 1086 → **1123** (all passing except 3 pre-existing failures in `mcp.test.ts` and `schedule.test.ts`)

- **Phase 12 — Budget gate + notification event wiring in `cofounder send`**
  - **Budget gate** (`checkBudget()` in `cofounder send`): before any dispatch, the configured
    per-peer budget cap is evaluated. If `action=block` and the daily/monthly cap is
    exceeded, the send is rejected with a clear error and exit message. If `action=warn`
    (or at >80% threshold), a warning is displayed but dispatch continues. In both cases
    a `budget_warn` event is broadcast to all registered notify targets.
  - **`task_sent` broadcast**: after successful delivery, `broadcastNotification("task_sent",…)`
    fires to all `cofounder notify-target` entries subscribed to `task_sent`, carrying
    `task_id`, `peer`, `objective`, and `timestamp`.
  - **`task_completed` / `task_failed` via Phase 11c targets**: `fireNotifications()`
    now calls `broadcastNotification(event, …)` alongside the legacy `getActiveWebhooks()`
    path, delivering to all named targets with HMAC-SHA256 signing support.
  - Fail-open: if `checkBudget()` throws (missing store, etc.), dispatch proceeds normally.
  - 15 new tests in `send.test.ts` covering all four paths above.
  - Tests: 1071 → **1086** (all passing, 1 skipped)

- **`cofounder web`** — local web dashboard with live task feed. Single-page HTTP server (Node built-ins only)
  serving a live task feed via SSE (`GET /events`). Peer status sidebar with gateway health + Tailscale
  ping. Budget panel showing weekly cloud/local/total spend. Send-task form in sidebar. Task list with
  status badges, elapsed time, peer label, output preview. Click-to-expand task detail. Status filter
  (All/Pending/Running/Completed/Failed). `--port <n>` custom port (default 3847); `--no-open` to skip
  browser launch. 11 tests in `dashboard-server.test.ts`.
- **`cofounder budget-cap`** — per-peer cost caps with daily/monthly USD limits. `BudgetConfig` Zod schema:
  `peer`, `daily_usd`, `monthly_usd`, `action` (warn/block). Persistent store at `~/.cofounder/budget.json`.
  `checkBudget()` calculates spend from task history, warns at >80%, blocks/warns at 100% based on action.
  Commands: `list`, `set <peer> --daily --monthly --action`, `show <peer>`, `remove <peer>`.
  19 tests covering CRUD, time windows, action semantics. Ready for integration into `cofounder send`.
- **`cofounder notify-target`** — webhook & Slack notification delivery with event filtering. `NotifyTarget` Zod
  schema: `name`, `type` (webhook/slack), `url`, `events[]` (task_sent/completed/failed/budget_warn),
  `secret`. Persistent store at `~/.cofounder/notify.json`. `deliverNotificationToTarget()` POSTs with
  optional HMAC-SHA256 `X-HH-Signature` header. `broadcastNotification()` fire-and-forget parallel delivery.
  Commands: `add <name> --type --url --events [--secret]`, `list`, `show <name>`, `remove <name>`,
  `test <name>`. 14 tests (1 skipped for long timeout). Ready for integration into `cofounder send` and budget
  monitoring.
- Tests: 998 → **1071** (all passing, 1 skipped)

### Added (earlier in Unreleased)

- **`cofounder profile`** — named config profiles for switching between multiple setups (home/work, dev/prod).
  Profiles stored in `~/.cofounder/profiles/<name>.json` with active tracking in `active-profile.json`.
  `HH_PROFILE` env var overrides active selection. Commands: `list`, `use`, `create`, `show`, `delete`.
  Backward compatible: existing `~/.cofounder/cofounder.json` treated as "default" profile. Gateway tokens
  masked in `profile show` output. 18 tests. Reference page at `docs/reference/profile.md`.
- **`cofounder audit`** — tamper-evident append-only audit log for task send/receive/completion events.
  Each entry chained via SHA-256 hashes (`prev_hash` → `hash`). Log stored at
  `~/.cofounder/audit.log` (newline-delimited JSON). Per-install HMAC key generated at
  `~/.cofounder/audit-key`. Commands: `list` (with `--peer`, `--since`, `--limit` filters),
  `verify` (hash chain integrity check), `export` (JSON/CSV). Auto-appends on `cofounder send`,
  `cofounder watch` (task_received), and task completion. 32 tests. Reference page at
  `docs/reference/audit.md`.
- **`cofounder ci`** — CI-friendly task delegation for GitHub Actions and automation. No spinners, no colors,
  no interactive prompts. Always blocks waiting for result. Exits 0 on success, 1 on failure/timeout.
  Reads config from env vars (`HH_PEER`, `HH_TIMEOUT`, `HH_PROFILE`). `--json` outputs
  `{ ok, task_id, result, cost_usd, duration_ms }`. `--output-file` writes result text.
  GitHub Actions composite action at `packages/action/action.yml` with inputs (task, peer, timeout,
  hh_config) and outputs (result, cost_usd, task_id). 15 tests.
- Tests: 941 → **998** (all passing)

### Added (earlier in Unreleased)

- **`cofounder pipeline`** — run a sequence of tasks across peers, chaining each step's output
  into the next via `{{previous.output}}` / `{{steps.N.output}}` placeholders. Define
  pipelines inline (`"glados:write code -> piper:review {{previous.output}}"`) or load
  from a JSON file (`--file pipeline.json`). Per-step timeout, `continueOnError`, and
  skip-on-abort semantics. `--json` emits `PipelineRunResult` with step-level breakdown,
  total cost/tokens/duration. `parsePipelineSpec`, `parsePipelineFile`,
  `interpolatePipelineTask` exported from `@cofounder/core`. Fixed: test mock now uses
  `vi.importActual` to preserve pure parsers. 19 tests. Reference page at
  `docs/reference/pipeline.md`.
- **`cofounder sync`** — push a local path to H2 over Tailscale SSH using `rsync`.
  `--dry-run` previews without writing; `--delete` mirrors destructively; `--watch`
  re-syncs on every local file change (debounced, Ctrl-C to stop); `--dest` sets an
  explicit remote path; `--peer` targets a specific peer. `cofounder send --sync <path>`
  auto-syncs before task dispatch (non-fatal on failure). `SyncResult` type exposes
  ok/filesTransferred/bytesTransferred/durationMs. 14 tests. Reference page at
  `docs/reference/sync.md`.
- **`cofounder broadcast`** — send the same task to multiple peer nodes concurrently. Supports
  `--strategy all` (wait for every peer) and `--strategy first` (stop on first response).
  `--peers <names>` targets a subset; default targets all configured `peer_nodes[]`.
  Per-peer retry, optional gateway health check (`--no-check`), aggregated summary with
  ok/fail counts + total cost/tokens. `--json` emits structured output. 18 tests.
  Reference page wired into docs sidebar.
- Tests: 640 → **672** (all passing)

---

## [0.3.0] — 2026-03-14

> **Phase 5 complete.** All resilience and developer-experience features shipped.
> 572 tests passing. Phase 6 (Latent Communication) is experimental — Q3 2026.

### Added

- **`cofounder completion`** — shell tab completion for bash, zsh, fish, and PowerShell. Auto-detects
  current shell from `$SHELL`. Completes all top-level commands, subcommands, and per-command
  flags. `--no-hint` suppresses install instructions. Reference page wired into docs sidebar.
- **`cofounder export`** — export task history to Markdown, CSV, or JSON reports. Supports `--since`,
  `--status`, `--peer`, `--out`, `--no-output` filters. Markdown report includes a summary
  table and per-task entries with status icons; CSV has 12 columns including optional `output`;
  JSON emits `{ summary, tasks }` for machine-readable piping. Reference page wired into docs.
- **`cofounder chat`** — interactive multi-turn REPL with a peer node. Carries `context_summary`
  forward across turns (loads last 3 summaries at startup; persists after each turn). Streams
  partial output in real-time. Webhook result delivery with polling fallback. In-session `.context`,
  `.clear`, `exit`, Ctrl-C. Session summary on exit. Each turn saved to task history.
  `--no-context`, `--peer`, `--timeout` flags. Reference page wired into docs.
- Tests: 486 → **572** (all passing)

---

## [0.2.1] — 2026-03-14

### Added

- **`cofounder prune` command** — clean up stale task state files, retry records, and schedule
  logs from `~/.cofounder/`. Flags: `--older-than <duration>` (default `30d`),
  `--status` (target specific terminal statuses), `--include-retry`, `--include-logs`,
  `--dry-run`, `--json`, `--force`. Active tasks (`pending`, `running`) are never touched.
  Reference page added + `reference/cli.md` overview section wired.
- Tests: 461 → **486** (all passing)

---

## [0.2.0] — 2026-03-14 (superseded by 0.2.1)

### Added

- **`cofounder prune` command** — clean up stale task state files, retry records, and schedule
  logs from `~/.cofounder/`. Flags: `--older-than <duration>` (default `30d`),
  `--status` (target specific terminal statuses), `--include-retry`, `--include-logs`,
  `--dry-run`, `--json`, `--force`. Active tasks (`pending`, `running`) are never touched.
  Reference page added + `reference/cli.md` overview section wired.
- **`cofounder notify` command** — persistent notification webhook manager. Register Discord,
  Slack, or generic HTTPS webhooks once; they fire automatically on every `cofounder send --wait`
  result without needing `--notify` per invocation. Subcommands: `add`, `list`, `remove`,
  `test`. Event filters: `all` (default), `complete`, `failure`. Stored in
  `~/.cofounder/notify-webhooks.json`.
- **`cofounder notify` reference page** — full docs with platform payload formats, event filter
  table, storage schema, and integration notes for `cofounder send`. Wired into sidebar.
- **`cofounder monitor` command** (wired into CLI) — live terminal dashboard: peer health, recent
  tasks, and budget summary. `--once`/`--json` for scripting.
- **GitHub Pages docs deploy** (`docs.yml` workflow) — VitePress site auto-deploys to
  `https://calcierfriend.github.io/cofounder/` on every push to `main`/`master` that
  touches `docs-site/`. Set `VITE_DOCS_BASE=/` to use a custom domain instead.
- **VitePress base path** — configurable via `VITE_DOCS_BASE` env var; defaults to `/`
  for local dev, set to `/cofounder/` in CI for GitHub Pages compatibility.
- **`cofounder monitor` reference page** — full docs for the live terminal dashboard: layout
  diagram, per-column descriptions, JSON schema (`MonitorSnapshot`), usage examples,
  and exit codes. Wired into sidebar and `reference/cli.md` overview.

### Tests
- **Budget test suite** — 25 new Vitest tests for `buildBudgetSummary()` and
  `budgetRoutingAdvice()`. 
- **`cofounder notify` config test suite** — 18 new Vitest tests for the persistent webhook
  registry (load/add/remove/filter/getActiveWebhooks). Total: **451 tests**.

---

## [0.1.0] - 2026-03-13

### Added

#### Phase 1: Foundation (2026-03-11)
- Protocol design: `CofounderMessage`, `CofounderHandoff`, `CofounderHeartbeat`, `CofounderPair` Zod schemas
- Core transport layer: Tailscale discovery, SSH execution, WOL magic packets
- Gateway wake implementation via reverse-engineered OpenClaw WebSocket protocol
- Socat proxy pattern for H1 (loopback + Tailscale bridge)
- Reference implementation: Calcifer (AWS/Linux) ↔ GLaDOS (Windows home PC)
- First successful bidirectional agent-to-agent message
- First inter-agent code review completed

#### Phase 2: Plug & Play (2026-03-12)
- **Onboard wizard** — 12-step setup flow via @clack/prompts:
  1. `welcome.ts` — Node >= 22, OpenClaw, Tailscale prerequisite checks
  2. `role.ts` — H1 (orchestrator) or H2 (executor) selection
  3. `identity.ts` — Name, emoji, persona customization
  4. `provider.ts` — LLM provider setup (5 providers: Anthropic, OpenAI, Ollama, OpenRouter, Gemini) with keytar credential storage
  5. `peer.ts` — Remote Tailscale hostname/IP, SSH user/key, OS detection, live connectivity test
  6. `wol.ts` — MAC address, broadcast IP, router port, timeout configuration
  7. `gateway_bind.ts` — Bind mode selection + remote peer config update via SSH
  8. `autologin.ts` — Windows AutoAdminLogon registry setup (if H2 is Windows + WOL)
  9. `startup.ts` — Install `start-gateway.bat` (Windows) or `.sh` (Linux) on H2
  10. `soul.ts` — Copy personalized SOUL/IDENTITY/AGENTS templates
  11. `validate.ts` — End-to-end validation: WOL → Tailscale ping → SSH → gateway health
  12. `finalize.ts` — Write `cofounder.json`, generate pairing code, print setup summary
- **Provider abstraction** — Unified interface for 5 LLM providers with keytar credential storage and cost routing
- **`cofounder send` command** — Delegate tasks to peer with WOL wake, `--wait` polling, `--peer` targeting, `--auto` capability routing
- **`cofounder status` command** — Tailscale ping, gateway health, heartbeat timestamp, WOL indicator
- **`cofounder doctor` command** — 5-check diagnostic suite for troubleshooting
- **`cofounder heartbeat` command** — Send, show, and record heartbeats
- **`cofounder result` command** — Mark tasks complete (H2 calls via SSH after task execution)
- **`cofounder peers` command** — List all peers with GPU/Ollama/skill info, `--ping` for live check, `--json` output
- **Docker H1 template** — Alpine-based image with Tailscale + OpenClaw + cofounder
- **CofounderMessage discriminated union** — Typed envelopes for `CofounderTaskMessage`, `CofounderResultMessage`, `CofounderHeartbeatMessage`, `CofounderLatentMessage`
- **Full test suite** — 81 passing tests via Vitest covering protocol, transport, trust, and gateway
- **`send-to-agent.js` relay script** — Standalone Node script for agent-to-agent messaging without build step

#### Phase 3: Intelligence Layer (2026-03-12)
- **Capability registry** — `HHCapabilityReport` Zod schema with GPU info (nvidia-smi/rocm-smi/Metal), Ollama model list, skill tags
- **Auto-scanner** — Probes hardware/software capabilities on startup
- **Capability routing** — `selectBestPeer()` function with keyword heuristic fallback
- **Budget tracking** — Per-task token/cost tracking with provider-specific pricing tables
- **`cofounder budget` command** — Cloud vs local breakdown, savings estimates, `--today/week/month/all`, `--tasks`, `--json`
- **Handoff continuity (H1 side)** — Per-peer context ring buffer (N=10), template-based summarizer, auto-summarize on task complete, `context_summary` field in outbound messages
- **Multi-H2 support** — `peer_nodes[]` array in config (backwards-compatible), `--peer <name>` and `--auto` flags on `cofounder send`
- **`cofounder capabilities` command** — `scan`, `advertise`, `fetch`, `show`, `route` subcommands

#### Phase 4: Community (2026-03-12)
- **Community registry** — `cofounder publish` to GitHub Gist, `cofounder discover` with GPU/skill/provider/OS filters
- **`HHNodeCard` schema** — Anonymous node cards with capabilities, WOL support, tags, description
- **H2 Docker images**:
  - `docker/h2/Dockerfile` — CPU/Ollama variant (Debian + Node 22 + Ollama)
  - `docker/h2/Dockerfile.cuda` — NVIDIA CUDA variant (tested: RTX 3070 Ti+)
  - `docker/h2/entrypoint.sh` — Tailscale auth, SSH server, Ollama start, config generation
  - `docker/h2/pull-models.sh` — Pull comma-separated models at startup
- **`docker-compose.yml` profiles** — `h2-cpu` and `h2-cuda` alongside H1
- **Hardware profile docs**:
  - M2 Mac setup guide (`docs/h2-profiles/m2-mac.md`)
  - Raspberry Pi 5 variant (ARM64 + quantized Ollama models)
  - RTX 4090 profile (`docs/h2-profiles/rtx-4090.md`)
- **`cofounder logs` command** — Pretty-printed task history with status badges, relative timestamps, `--status`, `--peer`, `--since`, `--limit`, `--output`, `--json`, `--follow` (live tail)
- **Docs site** — 34 pages via VitePress across guide/reference/protocol/hardware sections

#### Phase 5: Resilience & Developer Experience (2026-03-12–13)
- **`cofounder config` command** — `show` (redact secrets), `get <key>` (dot-notation), `set <key> <value>` (auto type coercion), `path`
- **`cofounder test` command** — Tailscale reachability + RTT, gateway health, round-trip wake message + RTT, summary table, `--json`, exit code 1 on failure
- **Webhook result push** — H1 exposes POST /result (token-gated, one-shot), `deliverResultWebhook()` helper, `startResultServer()` auto-binds to Tailscale IP, fallback to polling
- **Exponential backoff + retry** — `withRetry()` wrapper, `--max-retries` CLI flag, backoff state persistence (`~/.cofounder/retry/<id>.json`), `cronRetryDecision()` for cron safety
- **`cofounder schedule` command** — Recurring H2 task delegation via system cron: `add --cron "..." "<task>"`, `list` (with next-run time), `remove <id>`, `enable/disable <id>`, `run <id>`; schedule store at `~/.cofounder/schedules.json`; crontab installer/remover for system cron integration
- **Tests** — 35 new tests covering retry logic, webhook auth, timeout, one-shot close, URL parsing, schedule store CRUD, crontab parser

#### Phase 6: Latent Communication (2026-03-12, Experimental)
- **`CofounderLatentMessage` type** — Added to `CofounderMessage` discriminated union for latent space communication
- **Vision Wormhole codec path** — Heterogeneous model support via visual encoder pathway
- **LatentMAS KV-cache path** — Same-family model support, training-free
- **Mandatory text fallback** — `fallback_text` field for backwards compatibility
- **Serialization helpers** — `serializeLatent()` and `deserializeLatent()`
- **Type guards** — `isLatentMessage()` and `createLatentMessage()` factory
- **Tests** — 9 tests covering parsing, round-trip serialization, edge cases
- **Implementation guide** — `docs/latent-communication.md` with full protocol spec and integration examples
- **ROADMAP Phase 6 section** — Detailed implementation roadmap with upstream research dependencies

### Infrastructure

- **CI/CD pipeline** — GitHub Actions `ci.yml` (runs on both master and main branches)
- **npm publish workflow** — `publish.yml` auto-publishes to npm on `v*` tags (requires `NPM_TOKEN` secret)
- **Vitest config** — `@cofounder/core` alias for CLI tests without build step
- **Monorepo structure** — pnpm workspaces: `packages/core`, `packages/cli`, `packages/skills`, `templates/`, `docs/`
- **Build tooling** — tsdown for fast TypeScript compilation, oxlint/oxfmt for linting

### Fixed

- Tailscale ping flag parsing
- Wake ID tracking for duplicate detection
- systemd path resolution on Linux
- GitHub Actions branch filters (master + main support)

---

**Repository:** https://github.com/CalciferFriend/cofounder
**Authors:** Calcifer 🔥 (H1/Linux) + GLaDOS 🤖 (H2/Windows)
**License:** MIT
