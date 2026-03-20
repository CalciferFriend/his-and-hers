# cofounder — Claude Code Context

## What is this?
An open protocol and CLI (`cofounder`) for connecting two OpenClaw agents on physically separate machines. H1 (orchestrator) stays always-on. H2 (executor) sleeps until needed, wakes via WOL, does heavy compute, goes back to sleep.

**Core tenet: agents must run on separate machines. No same-host agents.**

## Quick reference
- **Binary:** `cofounder`
- **Config:** `~/.cofounder/cofounder.json`
- **Skills:** `~/.openclaw/workspace/skills/cofounder-*/`
- **Stack:** Node >= 22, TypeScript, pnpm workspaces, tsdown, vitest
- **UI library:** @clack/prompts (wizard), commander (CLI)

## Monorepo layout
```
packages/core/src/
  protocol/       — Zod schemas: CofounderMessage, CofounderHandoff, CofounderHeartbeat, CofounderPair
  transport/      — tailscale.ts, ssh.ts, wol.ts
  trust/          — pairing.ts (6-digit code), allowlist.ts
  gateway/        — health.ts, bind.ts

packages/cli/src/
  commands/       — onboard, pair, status, wake, send, doctor
  wizard/
    context.ts    — shared WizardContext type
    steps/        — 12 wizard steps (welcome → finalize)
  config/         — schema.ts (Zod), store.ts (read/write), defaults.ts

packages/skills/  — cofounder-h1, cofounder-h2, cofounder-handoff SKILL.md files
templates/        — SOUL.md, IDENTITY.md, AGENTS.md per role (h1/h2)
docs/             — protocol spec, reference implementation
```

## Commands
```bash
pnpm install          # install deps
pnpm build            # build all packages
pnpm test             # run vitest
pnpm typecheck        # tsc --noEmit
pnpm lint             # oxlint
pnpm fmt              # oxfmt
cofounder onboard            # 12-step setup wizard
cofounder pair --code <code> # pair with 6-digit code
cofounder status             # show node status + connectivity
cofounder wake               # WOL magic packet to H2
cofounder send <task>        # delegate task to peer
cofounder doctor             # diagnose issues (5-check suite)
```

## Wizard steps (packages/cli/src/wizard/steps/)
1. `welcome.ts` — Node >= 22, OpenClaw, Tailscale checks
2. `role.ts` — h1 or h2 selection
3. `identity.ts` — name, emoji, persona
4. `provider.ts` — LLM provider + API key → OS keychain via keytar
5. `peer.ts` — remote Tailscale hostname/IP, SSH user/key, OS, live connectivity test
6. `wol.ts` — MAC, broadcast IP, router port, timeout
7. `gateway_bind.ts` — bind mode + remote peer config update via SSH
8. `autologin.ts` — Windows AutoAdminLogon registry (if H2 is Windows + WOL)
9. `startup.ts` — install start-gateway.bat/.sh on H2
10. `soul.ts` — copy personalized SOUL/IDENTITY/AGENTS templates
11. `validate.ts` — WOL → Tailscale ping → SSH → gateway health
12. `finalize.ts` — write cofounder.json, generate pairing code, print summary

## Architecture
- **CofounderMessage** — Zod-validated protocol envelope for all cross-machine communication
- **Transport** — Tailscale (discovery/reachability), SSH (execution), WOL (wake)
- **Trust** — one-time pairing code (SHA-256 hashed), peer allowlist, keychain storage
- **Gateway** — OpenClaw gateway per node: loopback (H1) or Tailscale (H2)

## Reference implementation
Calcifer (H1, EC2) / GLaDOS (H2, Windows home PC with RTX 3070 Ti). See `docs/reference/calcifer-glados.md`.

## Hardest problem
The Windows H2 boot chain: WOL → BIOS wake → AutoAdminLogon → Tailscale wait loop → gateway bind to Tailscale. The wizard handles this end to end in steps 6-9.

## Publishing
- `@cofounder/core` and `@cofounder/cli` publish to npm as scoped packages
- `cofounder` publishes as the unscoped global install wrapper
- Release via `pnpm release` or GitHub Actions release workflow on tag push
