# his-and-hers — Agent Guidelines

## Project structure
```
packages/core/src/
  protocol/       — HHMessage, HHHandoff, HHHeartbeat, TJPair (Zod schemas)
  transport/      — tailscale.ts, ssh.ts, wol.ts
  trust/          — pairing.ts, allowlist.ts
  gateway/        — health.ts, bind.ts

packages/cli/src/
  commands/       — onboard.ts, pair.ts, status.ts, wake.ts, send.ts, doctor.ts
  wizard/context.ts — WizardContext shared state type
  wizard/steps/   — 12 steps: welcome, role, identity, provider, peer, wol,
                    gateway_bind, autologin, startup, soul, validate, finalize
  config/         — schema.ts (Zod config schema), store.ts, defaults.ts

packages/skills/  — SKILL.md files: hh-h1, hh-h2, hh-handoff
templates/        — SOUL.md, IDENTITY.md, AGENTS.md per role
docs/             — protocol spec + calcifer/glados reference
```

## Coding conventions
- ESM only (`"type": "module"` everywhere)
- TypeScript strict mode, no `any`
- Zod for all runtime validation and schema definitions
- Import with `.ts` extensions (NodeNext module resolution)
- Named exports only — no default exports
- `node:` prefix for built-in modules
- @clack/prompts for interactive wizard UI
- picocolors for terminal colors
- commander for CLI argument parsing

## Build & test
- `pnpm build` — builds all packages via tsdown
- `pnpm test` — runs vitest (16 tests across 4 suites)
- `pnpm typecheck` — tsc --noEmit
- `pnpm lint` — oxlint
- `pnpm fmt` — oxfmt

## Key design decisions
1. **Separate machines only** — no localhost pairs. Physical separation is the product.
2. **Tailscale is the network** — no raw IP/port exposure. Both nodes on same tailnet.
3. **WOL is first-class** — sleeping machines are a core use case, not edge case.
4. **Credentials in OS keychain** — via keytar. Never in plaintext config files.
5. **HHMessage is the protocol** — typed Zod envelope for all cross-machine communication.
6. **12-step wizard** — mirrors `openclaw onboard`, handles the hard Windows boot chain.
7. **Pairing code** — 6-digit code, SHA-256 hashed, verified on both sides.

## Adding wizard steps
1. Create `packages/cli/src/wizard/steps/your_step.ts`
2. Accept `Partial<WizardContext>`, return `Partial<WizardContext>`
3. Use `isCancelled()` from `../context.ts` for Ctrl+C handling
4. Wire into `packages/cli/src/commands/onboard.ts`

## Commit style
- Conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`
- Scope by package: `feat(core):`, `fix(cli):`, `docs(skills):`
