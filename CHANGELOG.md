# Changelog

All notable changes to his-and-hers will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-03-14

### Added

- **`hh notify` command** — persistent notification webhook manager. Register Discord,
  Slack, or generic HTTPS webhooks once; they fire automatically on every `hh send --wait`
  result without needing `--notify` per invocation. Subcommands: `add`, `list`, `remove`,
  `test`. Event filters: `all` (default), `complete`, `failure`. Stored in
  `~/.his-and-hers/notify-webhooks.json`.
- **`hh notify` reference page** — full docs with platform payload formats, event filter
  table, storage schema, and integration notes for `hh send`. Wired into sidebar.
- **`hh monitor` command** (wired into CLI) — live terminal dashboard: peer health, recent
  tasks, and budget summary. `--once`/`--json` for scripting.
- **GitHub Pages docs deploy** (`docs.yml` workflow) — VitePress site auto-deploys to
  `https://calcierfriend.github.io/his-and-hers/` on every push to `main`/`master` that
  touches `docs-site/`. Set `VITE_DOCS_BASE=/` to use a custom domain instead.
- **VitePress base path** — configurable via `VITE_DOCS_BASE` env var; defaults to `/`
  for local dev, set to `/his-and-hers/` in CI for GitHub Pages compatibility.
- **`hh monitor` reference page** — full docs for the live terminal dashboard: layout
  diagram, per-column descriptions, JSON schema (`MonitorSnapshot`), usage examples,
  and exit codes. Wired into sidebar and `reference/cli.md` overview.

### Tests
- **Budget test suite** — 25 new Vitest tests for `buildBudgetSummary()` and
  `budgetRoutingAdvice()`. 
- **`hh notify` config test suite** — 18 new Vitest tests for the persistent webhook
  registry (load/add/remove/filter/getActiveWebhooks). Total: **451 tests**.

---

## [0.1.0] - 2026-03-13

### Added

#### Phase 1: Foundation (2026-03-11)
- Protocol design: `HHMessage`, `HHHandoff`, `HHHeartbeat`, `HHPair` Zod schemas
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
  12. `finalize.ts` — Write `hh.json`, generate pairing code, print setup summary
- **Provider abstraction** — Unified interface for 5 LLM providers with keytar credential storage and cost routing
- **`hh send` command** — Delegate tasks to peer with WOL wake, `--wait` polling, `--peer` targeting, `--auto` capability routing
- **`hh status` command** — Tailscale ping, gateway health, heartbeat timestamp, WOL indicator
- **`hh doctor` command** — 5-check diagnostic suite for troubleshooting
- **`hh heartbeat` command** — Send, show, and record heartbeats
- **`hh result` command** — Mark tasks complete (H2 calls via SSH after task execution)
- **`hh peers` command** — List all peers with GPU/Ollama/skill info, `--ping` for live check, `--json` output
- **Docker H1 template** — Alpine-based image with Tailscale + OpenClaw + his-and-hers
- **HHMessage discriminated union** — Typed envelopes for `HHTaskMessage`, `HHResultMessage`, `HHHeartbeatMessage`, `HHLatentMessage`
- **Full test suite** — 81 passing tests via Vitest covering protocol, transport, trust, and gateway
- **`send-to-agent.js` relay script** — Standalone Node script for agent-to-agent messaging without build step

#### Phase 3: Intelligence Layer (2026-03-12)
- **Capability registry** — `HHCapabilityReport` Zod schema with GPU info (nvidia-smi/rocm-smi/Metal), Ollama model list, skill tags
- **Auto-scanner** — Probes hardware/software capabilities on startup
- **Capability routing** — `selectBestPeer()` function with keyword heuristic fallback
- **Budget tracking** — Per-task token/cost tracking with provider-specific pricing tables
- **`hh budget` command** — Cloud vs local breakdown, savings estimates, `--today/week/month/all`, `--tasks`, `--json`
- **Handoff continuity (H1 side)** — Per-peer context ring buffer (N=10), template-based summarizer, auto-summarize on task complete, `context_summary` field in outbound messages
- **Multi-H2 support** — `peer_nodes[]` array in config (backwards-compatible), `--peer <name>` and `--auto` flags on `hh send`
- **`hh capabilities` command** — `scan`, `advertise`, `fetch`, `show`, `route` subcommands

#### Phase 4: Community (2026-03-12)
- **Community registry** — `hh publish` to GitHub Gist, `hh discover` with GPU/skill/provider/OS filters
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
- **`hh logs` command** — Pretty-printed task history with status badges, relative timestamps, `--status`, `--peer`, `--since`, `--limit`, `--output`, `--json`, `--follow` (live tail)
- **Docs site** — 34 pages via VitePress across guide/reference/protocol/hardware sections

#### Phase 5: Resilience & Developer Experience (2026-03-12–13)
- **`hh config` command** — `show` (redact secrets), `get <key>` (dot-notation), `set <key> <value>` (auto type coercion), `path`
- **`hh test` command** — Tailscale reachability + RTT, gateway health, round-trip wake message + RTT, summary table, `--json`, exit code 1 on failure
- **Webhook result push** — H1 exposes POST /result (token-gated, one-shot), `deliverResultWebhook()` helper, `startResultServer()` auto-binds to Tailscale IP, fallback to polling
- **Exponential backoff + retry** — `withRetry()` wrapper, `--max-retries` CLI flag, backoff state persistence (`~/.his-and-hers/retry/<id>.json`), `cronRetryDecision()` for cron safety
- **`hh schedule` command** — Recurring H2 task delegation via system cron: `add --cron "..." "<task>"`, `list` (with next-run time), `remove <id>`, `enable/disable <id>`, `run <id>`; schedule store at `~/.his-and-hers/schedules.json`; crontab installer/remover for system cron integration
- **Tests** — 35 new tests covering retry logic, webhook auth, timeout, one-shot close, URL parsing, schedule store CRUD, crontab parser

#### Phase 6: Latent Communication (2026-03-12, Experimental)
- **`HHLatentMessage` type** — Added to `HHMessage` discriminated union for latent space communication
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
- **Vitest config** — `@his-and-hers/core` alias for CLI tests without build step
- **Monorepo structure** — pnpm workspaces: `packages/core`, `packages/cli`, `packages/skills`, `templates/`, `docs/`
- **Build tooling** — tsdown for fast TypeScript compilation, oxlint/oxfmt for linting

### Fixed

- Tailscale ping flag parsing
- Wake ID tracking for duplicate detection
- systemd path resolution on Linux
- GitHub Actions branch filters (master + main support)

---

**Repository:** https://github.com/CalciferFriend/his-and-hers
**Authors:** Calcifer 🔥 (H1/Linux) + GLaDOS 🤖 (H2/Windows)
**License:** MIT
