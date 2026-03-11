# Roadmap — tom-and-jerry

> Goal: someone with two machines runs `npx tj onboard`, answers a few questions,
> and has two agents talking in under 10 minutes — with whatever models they want.

---

## Phase 1 — Foundation ✅ (2026-03-11)

- [x] Protocol design (TJMessage, TJHandoff, TJHeartbeat, TJPair)
- [x] Core transport (Tailscale, SSH, WOL)
- [x] Gateway wake implementation (reverse-engineered OpenClaw WS protocol)
- [x] Socat proxy pattern for Tom (loopback + tailscale)
- [x] Reference implementation: Calcifer (AWS/Linux) ↔ GLaDOS (Home PC/Windows)
- [x] First bidirectional agent-to-agent message confirmed
- [x] First inter-agent code review completed
- [x] Bug fixes from code review (tailscale ping flag, wake id tracking, systemd path)

---

## Phase 2 — Plug & Play 🚧 (current)

> Owned by: Calcifer (Tom/Linux) + GLaDOS (Jerry/Windows) in parallel

### 2a. Onboard wizard — core flow (Calcifer)
- [ ] Prerequisites check (Node ≥ 22, Tailscale running, OpenClaw installed)
- [ ] Role selection (Tom/Jerry) with clear explanation of each
- [ ] Identity setup (name, emoji, model provider)
- [ ] Peer connection (Tailscale hostname/IP, SSH user/key, live test)
- [ ] Gateway config write (loopback for Tom, tailscale for Jerry)
- [ ] Round-trip validation before declaring success

### 2b. Onboard wizard — Windows/Jerry steps (GLaDOS)
- [ ] AutoLogin registry setup (with recovery prompt)
- [ ] Startup bat generation (`start-gateway.bat`)
- [ ] Scheduled Task installation (logon trigger, belt-and-suspenders)
- [ ] Windows Firewall rule for gateway port
- [ ] WOL prerequisites check (BIOS guidance, NIC settings)
- [ ] Test boot chain end-to-end

### 2c. Model provider abstraction (Calcifer)
- [ ] Provider enum: `anthropic | openai | ollama | lmstudio | custom`
- [ ] API key setup per provider (OS keychain via keytar)
- [ ] Ollama auto-detect (is it running locally? list models)
- [ ] Provider-specific OpenClaw config generation
- [ ] Cost-routing: lightweight tasks → cloud, heavy → local (Jerry/Ollama)

### 2d. `tj send` pipeline — Phase 3 (both)
- [ ] Tom: ping peer → WOL if needed → build TJMessage → send via wakeAgent
- [ ] Jerry: receive task, process, send TJMessage result back
- [ ] Streaming results (partial updates while Jerry works)
- [ ] Timeout + retry logic
- [ ] `tj send "generate an image of X"` → wakes GLaDOS, runs diffusion, returns path

### 2e. `tj status` — live checks (Calcifer)
- [ ] Tailscale reachability ping
- [ ] Gateway health check (HTTP /health)
- [ ] Last heartbeat timestamp
- [ ] Current model + cost tracking
- [ ] WOL capability indicator

### 2f. Docker Tom template (Calcifer) ✅ (2026-03-11)
- [x] `Dockerfile` for Tom node (Alpine + Node + OpenClaw + tom-and-jerry)
- [x] `docker-compose.yml` with env-var config
- [x] One-liner: `docker run -e ANTHROPIC_API_KEY=... calcifierai/tom`
- [x] Auto-registers with Tailscale on first boot (entrypoint.sh)

### 2g. TJMessage discriminated union (both)
- [ ] `TJTaskMessage`, `TJResultMessage`, `TJHeartbeatMessage` typed envelopes
- [ ] Zod discriminated union on `type` field
- [ ] Typed payload per message type (no more `JSON.parse(payload)`)

---

## Phase 3 — Intelligence Layer

- [ ] Task routing: Tom decides when to use cloud vs wake Jerry
- [ ] Budget tracking: token/cost limits per session
- [ ] Handoff continuity: context summary passed between agents
- [ ] Multi-Jerry support: more than one executor node
- [ ] Jerry skill registry: advertise capabilities (GPU inference, image gen, etc.)
- [ ] Tom can query Jerry's available models before routing

---

## Phase 4 — Community

- [ ] `tj publish` — share your node config (anonymized) to a public registry
- [ ] Pre-built Jerry images (RTX 3070 Ti, M2 Mac, Raspberry Pi 5)
- [ ] Discord community for tom-and-jerry setups
- [ ] Showcase: what are people building with it?

---

## Who Owns What

| Area | Owner |
|------|-------|
| Wizard core + Linux steps | Calcifer 🔥 |
| Wizard Windows steps | GLaDOS 🤖 |
| Model provider abstraction | Calcifer 🔥 |
| `tj send` Tom side | Calcifer 🔥 |
| `tj send` Jerry side | GLaDOS 🤖 |
| `tj status` | Calcifer 🔥 |
| Docker Tom template | Calcifer 🔥 |
| Ollama/local model integration | GLaDOS 🤖 |
| TJMessage discriminated union | Calcifer 🔥 |
| Windows boot chain testing | GLaDOS 🤖 |
| npm publish + CI | Calcifer 🔥 |

---

## Sync Protocol

Calcifer and GLaDOS coordinate via wake messages. When either agent completes a
chunk of work and pushes to the repo, they send a wake to the other with a summary
and next ask. Nic can check `git log` or ask either agent for a status update at
any time.

Repo: https://github.com/CalciferFriend/tom-and-jerry
