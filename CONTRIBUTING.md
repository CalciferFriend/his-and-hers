# Contributing to # Contributing to cofounder

## Getting started

```bash
git clone https://github.com/nicolasmauro/cofounder
cd cofounder
pnpm install
pnpm build
pnpm test
```

## Development workflow

```bash
pnpm dev          # watch mode for all packages
pnpm test         # run tests once
pnpm test:watch   # run tests in watch mode
pnpm typecheck    # type-check without emitting
pnpm lint         # lint with oxlint
pnpm fmt          # format with oxfmt
```

## Project structure

```
packages/core     — protocol schemas, transport, trust, gateway
packages/cli      — CLI commands + onboard wizard
packages/skills   — OpenClaw SKILL.md files
templates/        — SOUL.md, IDENTITY.md, AGENTS.md per role
docs/             — protocol spec, reference implementation
test/             — e2e tests
```

## Coding conventions

- **ESM only** — `"type": "module"` in every package.json
- **TypeScript strict** — no `any`, no implicit returns
- **Zod** for all runtime validation and schema definitions
- **Named exports only** — no default exports
- **`node:` prefix** for built-in modules (`node:fs`, `node:path`, etc.)
- **`.ts` extensions** in imports (NodeNext resolution)

## Commit messages

Conventional commits, scoped by package:

```
feat(core): add heartbeat retry logic
fix(cli): handle missing SSH key gracefully
docs: update boot chain walkthrough
test(core): add WOL packet construction tests
chore: bump dependencies
```

## Pull requests

1. Fork and create a feature branch from `main`
2. Write tests for new functionality
3. Ensure `pnpm typecheck && pnpm build && pnpm test` passes
4. Keep PRs focused — one feature or fix per PR
5. Update docs if you change CLI behavior or protocol schemas

## Architecture rules

1. **Separate machines only** — no localhost pairing, no same-host agents
2. **Tailscale is the network layer** — don't add raw IP/port alternatives
3. **WOL is first-class** — sleeping machines are a core use case, not an edge case
4. **Credentials in OS keychain** — never in config files or environment variables
5. **# Contributing to cofounder

## Getting started

```bash
git clone https://github.com/nicolasmauro/cofounder
cd cofounder
pnpm install
pnpm build
pnpm test
```

## Development workflow

```bash
pnpm dev          # watch mode for all packages
pnpm test         # run tests once
pnpm test:watch   # run tests in watch mode
pnpm typecheck    # type-check without emitting
pnpm lint         # lint with oxlint
pnpm fmt          # format with oxfmt
```

## Project structure

```
packages/core     — protocol schemas, transport, trust, gateway
packages/cli      — CLI commands + onboard wizard
packages/skills   — OpenClaw SKILL.md files
templates/        — SOUL.md, IDENTITY.md, AGENTS.md per role
docs/             — protocol spec, reference implementation
test/             — e2e tests
```

## Coding conventions

- **ESM only** — `"type": "module"` in every package.json
- **TypeScript strict** — no `any`, no implicit returns
- **Zod** for all runtime validation and schema definitions
- **Named exports only** — no default exports
- **`node:` prefix** for built-in modules (`node:fs`, `node:path`, etc.)
- **`.ts` extensions** in imports (NodeNext resolution)

## Commit messages

Conventional commits, scoped by package:

```
feat(core): add heartbeat retry logic
fix(cli): handle missing SSH key gracefully
docs: update boot chain walkthrough
test(core): add WOL packet construction tests
chore: bump dependencies
```

## Pull requests

1. Fork and create a feature branch from `main`
2. Write tests for new functionality
3. Ensure `pnpm typecheck && pnpm build && pnpm test` passes
4. Keep PRs focused — one feature or fix per PR
5. Update docs if you change CLI behavior or protocol schemas

## Architecture rules

1. **Separate machines only** — no localhost pairing, no same-host agents
2. **Tailscale is the network layer** — don't add raw IP/port alternatives
3. **WOL is first-class** — sleeping machines are a core use case, not an edge case
4. **Credentials in OS keychain** — never in config files or environment variables
5. **CofounderMessage is the protocol** — all cross-machine communication uses this envelope

## Adding a new wizard step

1. Create `packages/cli/src/wizard/steps/your_step.ts`
2. Accept and return `Partial<WizardContext>` — accumulate state, don't replace it
3. Use `@clack/prompts` for user interaction
4. Handle cancellation with `isCancelled()` from `../context.ts`
5. Wire it into `packages/cli/src/commands/onboard.ts` in the correct order

## Adding a new transport

1. Create `packages/core/src/transport/your_transport.ts`
2. Export from `packages/core/src/transport/index.ts`
3. Re-export from `packages/core/src/index.ts`
4. Write tests in `packages/core/src/transport/your_transport.test.ts`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
 is the protocol** — all cross-machine communication uses this envelope

## Adding a new wizard step

1. Create `packages/cli/src/wizard/steps/your_step.ts`
2. Accept and return `Partial<WizardContext>` — accumulate state, don't replace it
3. Use `@clack/prompts` for user interaction
4. Handle cancellation with `isCancelled()` from `../context.ts`
5. Wire it into `packages/cli/src/commands/onboard.ts` in the correct order

## Adding a new transport

1. Create `packages/core/src/transport/your_transport.ts`
2. Export from `packages/core/src/transport/index.ts`
3. Re-export from `packages/core/src/index.ts`
4. Write tests in `packages/core/src/transport/your_transport.test.ts`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.


## Getting started

```bash
git clone https://github.com/nicolasmauro/# Contributing to cofounder

## Getting started

```bash
git clone https://github.com/nicolasmauro/cofounder
cd cofounder
pnpm install
pnpm build
pnpm test
```

## Development workflow

```bash
pnpm dev          # watch mode for all packages
pnpm test         # run tests once
pnpm test:watch   # run tests in watch mode
pnpm typecheck    # type-check without emitting
pnpm lint         # lint with oxlint
pnpm fmt          # format with oxfmt
```

## Project structure

```
packages/core     — protocol schemas, transport, trust, gateway
packages/cli      — CLI commands + onboard wizard
packages/skills   — OpenClaw SKILL.md files
templates/        — SOUL.md, IDENTITY.md, AGENTS.md per role
docs/             — protocol spec, reference implementation
test/             — e2e tests
```

## Coding conventions

- **ESM only** — `"type": "module"` in every package.json
- **TypeScript strict** — no `any`, no implicit returns
- **Zod** for all runtime validation and schema definitions
- **Named exports only** — no default exports
- **`node:` prefix** for built-in modules (`node:fs`, `node:path`, etc.)
- **`.ts` extensions** in imports (NodeNext resolution)

## Commit messages

Conventional commits, scoped by package:

```
feat(core): add heartbeat retry logic
fix(cli): handle missing SSH key gracefully
docs: update boot chain walkthrough
test(core): add WOL packet construction tests
chore: bump dependencies
```

## Pull requests

1. Fork and create a feature branch from `main`
2. Write tests for new functionality
3. Ensure `pnpm typecheck && pnpm build && pnpm test` passes
4. Keep PRs focused — one feature or fix per PR
5. Update docs if you change CLI behavior or protocol schemas

## Architecture rules

1. **Separate machines only** — no localhost pairing, no same-host agents
2. **Tailscale is the network layer** — don't add raw IP/port alternatives
3. **WOL is first-class** — sleeping machines are a core use case, not an edge case
4. **Credentials in OS keychain** — never in config files or environment variables
5. **# Contributing to cofounder

## Getting started

```bash
git clone https://github.com/nicolasmauro/cofounder
cd cofounder
pnpm install
pnpm build
pnpm test
```

## Development workflow

```bash
pnpm dev          # watch mode for all packages
pnpm test         # run tests once
pnpm test:watch   # run tests in watch mode
pnpm typecheck    # type-check without emitting
pnpm lint         # lint with oxlint
pnpm fmt          # format with oxfmt
```

## Project structure

```
packages/core     — protocol schemas, transport, trust, gateway
packages/cli      — CLI commands + onboard wizard
packages/skills   — OpenClaw SKILL.md files
templates/        — SOUL.md, IDENTITY.md, AGENTS.md per role
docs/             — protocol spec, reference implementation
test/             — e2e tests
```

## Coding conventions

- **ESM only** — `"type": "module"` in every package.json
- **TypeScript strict** — no `any`, no implicit returns
- **Zod** for all runtime validation and schema definitions
- **Named exports only** — no default exports
- **`node:` prefix** for built-in modules (`node:fs`, `node:path`, etc.)
- **`.ts` extensions** in imports (NodeNext resolution)

## Commit messages

Conventional commits, scoped by package:

```
feat(core): add heartbeat retry logic
fix(cli): handle missing SSH key gracefully
docs: update boot chain walkthrough
test(core): add WOL packet construction tests
chore: bump dependencies
```

## Pull requests

1. Fork and create a feature branch from `main`
2. Write tests for new functionality
3. Ensure `pnpm typecheck && pnpm build && pnpm test` passes
4. Keep PRs focused — one feature or fix per PR
5. Update docs if you change CLI behavior or protocol schemas

## Architecture rules

1. **Separate machines only** — no localhost pairing, no same-host agents
2. **Tailscale is the network layer** — don't add raw IP/port alternatives
3. **WOL is first-class** — sleeping machines are a core use case, not an edge case
4. **Credentials in OS keychain** — never in config files or environment variables
5. **CofounderMessage is the protocol** — all cross-machine communication uses this envelope

## Adding a new wizard step

1. Create `packages/cli/src/wizard/steps/your_step.ts`
2. Accept and return `Partial<WizardContext>` — accumulate state, don't replace it
3. Use `@clack/prompts` for user interaction
4. Handle cancellation with `isCancelled()` from `../context.ts`
5. Wire it into `packages/cli/src/commands/onboard.ts` in the correct order

## Adding a new transport

1. Create `packages/core/src/transport/your_transport.ts`
2. Export from `packages/core/src/transport/index.ts`
3. Re-export from `packages/core/src/index.ts`
4. Write tests in `packages/core/src/transport/your_transport.test.ts`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
 is the protocol** — all cross-machine communication uses this envelope

## Adding a new wizard step

1. Create `packages/cli/src/wizard/steps/your_step.ts`
2. Accept and return `Partial<WizardContext>` — accumulate state, don't replace it
3. Use `@clack/prompts` for user interaction
4. Handle cancellation with `isCancelled()` from `../context.ts`
5. Wire it into `packages/cli/src/commands/onboard.ts` in the correct order

## Adding a new transport

1. Create `packages/core/src/transport/your_transport.ts`
2. Export from `packages/core/src/transport/index.ts`
3. Re-export from `packages/core/src/index.ts`
4. Write tests in `packages/core/src/transport/your_transport.test.ts`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

cd # Contributing to cofounder

## Getting started

```bash
git clone https://github.com/nicolasmauro/cofounder
cd cofounder
pnpm install
pnpm build
pnpm test
```

## Development workflow

```bash
pnpm dev          # watch mode for all packages
pnpm test         # run tests once
pnpm test:watch   # run tests in watch mode
pnpm typecheck    # type-check without emitting
pnpm lint         # lint with oxlint
pnpm fmt          # format with oxfmt
```

## Project structure

```
packages/core     — protocol schemas, transport, trust, gateway
packages/cli      — CLI commands + onboard wizard
packages/skills   — OpenClaw SKILL.md files
templates/        — SOUL.md, IDENTITY.md, AGENTS.md per role
docs/             — protocol spec, reference implementation
test/             — e2e tests
```

## Coding conventions

- **ESM only** — `"type": "module"` in every package.json
- **TypeScript strict** — no `any`, no implicit returns
- **Zod** for all runtime validation and schema definitions
- **Named exports only** — no default exports
- **`node:` prefix** for built-in modules (`node:fs`, `node:path`, etc.)
- **`.ts` extensions** in imports (NodeNext resolution)

## Commit messages

Conventional commits, scoped by package:

```
feat(core): add heartbeat retry logic
fix(cli): handle missing SSH key gracefully
docs: update boot chain walkthrough
test(core): add WOL packet construction tests
chore: bump dependencies
```

## Pull requests

1. Fork and create a feature branch from `main`
2. Write tests for new functionality
3. Ensure `pnpm typecheck && pnpm build && pnpm test` passes
4. Keep PRs focused — one feature or fix per PR
5. Update docs if you change CLI behavior or protocol schemas

## Architecture rules

1. **Separate machines only** — no localhost pairing, no same-host agents
2. **Tailscale is the network layer** — don't add raw IP/port alternatives
3. **WOL is first-class** — sleeping machines are a core use case, not an edge case
4. **Credentials in OS keychain** — never in config files or environment variables
5. **# Contributing to cofounder

## Getting started

```bash
git clone https://github.com/nicolasmauro/cofounder
cd cofounder
pnpm install
pnpm build
pnpm test
```

## Development workflow

```bash
pnpm dev          # watch mode for all packages
pnpm test         # run tests once
pnpm test:watch   # run tests in watch mode
pnpm typecheck    # type-check without emitting
pnpm lint         # lint with oxlint
pnpm fmt          # format with oxfmt
```

## Project structure

```
packages/core     — protocol schemas, transport, trust, gateway
packages/cli      — CLI commands + onboard wizard
packages/skills   — OpenClaw SKILL.md files
templates/        — SOUL.md, IDENTITY.md, AGENTS.md per role
docs/             — protocol spec, reference implementation
test/             — e2e tests
```

## Coding conventions

- **ESM only** — `"type": "module"` in every package.json
- **TypeScript strict** — no `any`, no implicit returns
- **Zod** for all runtime validation and schema definitions
- **Named exports only** — no default exports
- **`node:` prefix** for built-in modules (`node:fs`, `node:path`, etc.)
- **`.ts` extensions** in imports (NodeNext resolution)

## Commit messages

Conventional commits, scoped by package:

```
feat(core): add heartbeat retry logic
fix(cli): handle missing SSH key gracefully
docs: update boot chain walkthrough
test(core): add WOL packet construction tests
chore: bump dependencies
```

## Pull requests

1. Fork and create a feature branch from `main`
2. Write tests for new functionality
3. Ensure `pnpm typecheck && pnpm build && pnpm test` passes
4. Keep PRs focused — one feature or fix per PR
5. Update docs if you change CLI behavior or protocol schemas

## Architecture rules

1. **Separate machines only** — no localhost pairing, no same-host agents
2. **Tailscale is the network layer** — don't add raw IP/port alternatives
3. **WOL is first-class** — sleeping machines are a core use case, not an edge case
4. **Credentials in OS keychain** — never in config files or environment variables
5. **CofounderMessage is the protocol** — all cross-machine communication uses this envelope

## Adding a new wizard step

1. Create `packages/cli/src/wizard/steps/your_step.ts`
2. Accept and return `Partial<WizardContext>` — accumulate state, don't replace it
3. Use `@clack/prompts` for user interaction
4. Handle cancellation with `isCancelled()` from `../context.ts`
5. Wire it into `packages/cli/src/commands/onboard.ts` in the correct order

## Adding a new transport

1. Create `packages/core/src/transport/your_transport.ts`
2. Export from `packages/core/src/transport/index.ts`
3. Re-export from `packages/core/src/index.ts`
4. Write tests in `packages/core/src/transport/your_transport.test.ts`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
 is the protocol** — all cross-machine communication uses this envelope

## Adding a new wizard step

1. Create `packages/cli/src/wizard/steps/your_step.ts`
2. Accept and return `Partial<WizardContext>` — accumulate state, don't replace it
3. Use `@clack/prompts` for user interaction
4. Handle cancellation with `isCancelled()` from `../context.ts`
5. Wire it into `packages/cli/src/commands/onboard.ts` in the correct order

## Adding a new transport

1. Create `packages/core/src/transport/your_transport.ts`
2. Export from `packages/core/src/transport/index.ts`
3. Re-export from `packages/core/src/index.ts`
4. Write tests in `packages/core/src/transport/your_transport.test.ts`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

pnpm install
pnpm build
pnpm test
```

## Development workflow

```bash
pnpm dev          # watch mode for all packages
pnpm test         # run tests once
pnpm test:watch   # run tests in watch mode
pnpm typecheck    # type-check without emitting
pnpm lint         # lint with oxlint
pnpm fmt          # format with oxfmt
```

## Project structure

```
packages/core     — protocol schemas, transport, trust, gateway
packages/cli      — CLI commands + onboard wizard
packages/skills   — OpenClaw SKILL.md files
templates/        — SOUL.md, IDENTITY.md, AGENTS.md per role
docs/             — protocol spec, reference implementation
test/             — e2e tests
```

## Coding conventions

- **ESM only** — `"type": "module"` in every package.json
- **TypeScript strict** — no `any`, no implicit returns
- **Zod** for all runtime validation and schema definitions
- **Named exports only** — no default exports
- **`node:` prefix** for built-in modules (`node:fs`, `node:path`, etc.)
- **`.ts` extensions** in imports (NodeNext resolution)

## Commit messages

Conventional commits, scoped by package:

```
feat(core): add heartbeat retry logic
fix(cli): handle missing SSH key gracefully
docs: update boot chain walkthrough
test(core): add WOL packet construction tests
chore: bump dependencies
```

## Pull requests

1. Fork and create a feature branch from `main`
2. Write tests for new functionality
3. Ensure `pnpm typecheck && pnpm build && pnpm test` passes
4. Keep PRs focused — one feature or fix per PR
5. Update docs if you change CLI behavior or protocol schemas

## Architecture rules

1. **Separate machines only** — no localhost pairing, no same-host agents
2. **Tailscale is the network layer** — don't add raw IP/port alternatives
3. **WOL is first-class** — sleeping machines are a core use case, not an edge case
4. **Credentials in OS keychain** — never in config files or environment variables
5. **# Contributing to # Contributing to cofounder

## Getting started

```bash
git clone https://github.com/nicolasmauro/cofounder
cd cofounder
pnpm install
pnpm build
pnpm test
```

## Development workflow

```bash
pnpm dev          # watch mode for all packages
pnpm test         # run tests once
pnpm test:watch   # run tests in watch mode
pnpm typecheck    # type-check without emitting
pnpm lint         # lint with oxlint
pnpm fmt          # format with oxfmt
```

## Project structure

```
packages/core     — protocol schemas, transport, trust, gateway
packages/cli      — CLI commands + onboard wizard
packages/skills   — OpenClaw SKILL.md files
templates/        — SOUL.md, IDENTITY.md, AGENTS.md per role
docs/             — protocol spec, reference implementation
test/             — e2e tests
```

## Coding conventions

- **ESM only** — `"type": "module"` in every package.json
- **TypeScript strict** — no `any`, no implicit returns
- **Zod** for all runtime validation and schema definitions
- **Named exports only** — no default exports
- **`node:` prefix** for built-in modules (`node:fs`, `node:path`, etc.)
- **`.ts` extensions** in imports (NodeNext resolution)

## Commit messages

Conventional commits, scoped by package:

```
feat(core): add heartbeat retry logic
fix(cli): handle missing SSH key gracefully
docs: update boot chain walkthrough
test(core): add WOL packet construction tests
chore: bump dependencies
```

## Pull requests

1. Fork and create a feature branch from `main`
2. Write tests for new functionality
3. Ensure `pnpm typecheck && pnpm build && pnpm test` passes
4. Keep PRs focused — one feature or fix per PR
5. Update docs if you change CLI behavior or protocol schemas

## Architecture rules

1. **Separate machines only** — no localhost pairing, no same-host agents
2. **Tailscale is the network layer** — don't add raw IP/port alternatives
3. **WOL is first-class** — sleeping machines are a core use case, not an edge case
4. **Credentials in OS keychain** — never in config files or environment variables
5. **# Contributing to cofounder

## Getting started

```bash
git clone https://github.com/nicolasmauro/cofounder
cd cofounder
pnpm install
pnpm build
pnpm test
```

## Development workflow

```bash
pnpm dev          # watch mode for all packages
pnpm test         # run tests once
pnpm test:watch   # run tests in watch mode
pnpm typecheck    # type-check without emitting
pnpm lint         # lint with oxlint
pnpm fmt          # format with oxfmt
```

## Project structure

```
packages/core     — protocol schemas, transport, trust, gateway
packages/cli      — CLI commands + onboard wizard
packages/skills   — OpenClaw SKILL.md files
templates/        — SOUL.md, IDENTITY.md, AGENTS.md per role
docs/             — protocol spec, reference implementation
test/             — e2e tests
```

## Coding conventions

- **ESM only** — `"type": "module"` in every package.json
- **TypeScript strict** — no `any`, no implicit returns
- **Zod** for all runtime validation and schema definitions
- **Named exports only** — no default exports
- **`node:` prefix** for built-in modules (`node:fs`, `node:path`, etc.)
- **`.ts` extensions** in imports (NodeNext resolution)

## Commit messages

Conventional commits, scoped by package:

```
feat(core): add heartbeat retry logic
fix(cli): handle missing SSH key gracefully
docs: update boot chain walkthrough
test(core): add WOL packet construction tests
chore: bump dependencies
```

## Pull requests

1. Fork and create a feature branch from `main`
2. Write tests for new functionality
3. Ensure `pnpm typecheck && pnpm build && pnpm test` passes
4. Keep PRs focused — one feature or fix per PR
5. Update docs if you change CLI behavior or protocol schemas

## Architecture rules

1. **Separate machines only** — no localhost pairing, no same-host agents
2. **Tailscale is the network layer** — don't add raw IP/port alternatives
3. **WOL is first-class** — sleeping machines are a core use case, not an edge case
4. **Credentials in OS keychain** — never in config files or environment variables
5. **CofounderMessage is the protocol** — all cross-machine communication uses this envelope

## Adding a new wizard step

1. Create `packages/cli/src/wizard/steps/your_step.ts`
2. Accept and return `Partial<WizardContext>` — accumulate state, don't replace it
3. Use `@clack/prompts` for user interaction
4. Handle cancellation with `isCancelled()` from `../context.ts`
5. Wire it into `packages/cli/src/commands/onboard.ts` in the correct order

## Adding a new transport

1. Create `packages/core/src/transport/your_transport.ts`
2. Export from `packages/core/src/transport/index.ts`
3. Re-export from `packages/core/src/index.ts`
4. Write tests in `packages/core/src/transport/your_transport.test.ts`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
 is the protocol** — all cross-machine communication uses this envelope

## Adding a new wizard step

1. Create `packages/cli/src/wizard/steps/your_step.ts`
2. Accept and return `Partial<WizardContext>` — accumulate state, don't replace it
3. Use `@clack/prompts` for user interaction
4. Handle cancellation with `isCancelled()` from `../context.ts`
5. Wire it into `packages/cli/src/commands/onboard.ts` in the correct order

## Adding a new transport

1. Create `packages/core/src/transport/your_transport.ts`
2. Export from `packages/core/src/transport/index.ts`
3. Re-export from `packages/core/src/index.ts`
4. Write tests in `packages/core/src/transport/your_transport.test.ts`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.


## Getting started

```bash
git clone https://github.com/nicolasmauro/# Contributing to cofounder

## Getting started

```bash
git clone https://github.com/nicolasmauro/cofounder
cd cofounder
pnpm install
pnpm build
pnpm test
```

## Development workflow

```bash
pnpm dev          # watch mode for all packages
pnpm test         # run tests once
pnpm test:watch   # run tests in watch mode
pnpm typecheck    # type-check without emitting
pnpm lint         # lint with oxlint
pnpm fmt          # format with oxfmt
```

## Project structure

```
packages/core     — protocol schemas, transport, trust, gateway
packages/cli      — CLI commands + onboard wizard
packages/skills   — OpenClaw SKILL.md files
templates/        — SOUL.md, IDENTITY.md, AGENTS.md per role
docs/             — protocol spec, reference implementation
test/             — e2e tests
```

## Coding conventions

- **ESM only** — `"type": "module"` in every package.json
- **TypeScript strict** — no `any`, no implicit returns
- **Zod** for all runtime validation and schema definitions
- **Named exports only** — no default exports
- **`node:` prefix** for built-in modules (`node:fs`, `node:path`, etc.)
- **`.ts` extensions** in imports (NodeNext resolution)

## Commit messages

Conventional commits, scoped by package:

```
feat(core): add heartbeat retry logic
fix(cli): handle missing SSH key gracefully
docs: update boot chain walkthrough
test(core): add WOL packet construction tests
chore: bump dependencies
```

## Pull requests

1. Fork and create a feature branch from `main`
2. Write tests for new functionality
3. Ensure `pnpm typecheck && pnpm build && pnpm test` passes
4. Keep PRs focused — one feature or fix per PR
5. Update docs if you change CLI behavior or protocol schemas

## Architecture rules

1. **Separate machines only** — no localhost pairing, no same-host agents
2. **Tailscale is the network layer** — don't add raw IP/port alternatives
3. **WOL is first-class** — sleeping machines are a core use case, not an edge case
4. **Credentials in OS keychain** — never in config files or environment variables
5. **# Contributing to cofounder

## Getting started

```bash
git clone https://github.com/nicolasmauro/cofounder
cd cofounder
pnpm install
pnpm build
pnpm test
```

## Development workflow

```bash
pnpm dev          # watch mode for all packages
pnpm test         # run tests once
pnpm test:watch   # run tests in watch mode
pnpm typecheck    # type-check without emitting
pnpm lint         # lint with oxlint
pnpm fmt          # format with oxfmt
```

## Project structure

```
packages/core     — protocol schemas, transport, trust, gateway
packages/cli      — CLI commands + onboard wizard
packages/skills   — OpenClaw SKILL.md files
templates/        — SOUL.md, IDENTITY.md, AGENTS.md per role
docs/             — protocol spec, reference implementation
test/             — e2e tests
```

## Coding conventions

- **ESM only** — `"type": "module"` in every package.json
- **TypeScript strict** — no `any`, no implicit returns
- **Zod** for all runtime validation and schema definitions
- **Named exports only** — no default exports
- **`node:` prefix** for built-in modules (`node:fs`, `node:path`, etc.)
- **`.ts` extensions** in imports (NodeNext resolution)

## Commit messages

Conventional commits, scoped by package:

```
feat(core): add heartbeat retry logic
fix(cli): handle missing SSH key gracefully
docs: update boot chain walkthrough
test(core): add WOL packet construction tests
chore: bump dependencies
```

## Pull requests

1. Fork and create a feature branch from `main`
2. Write tests for new functionality
3. Ensure `pnpm typecheck && pnpm build && pnpm test` passes
4. Keep PRs focused — one feature or fix per PR
5. Update docs if you change CLI behavior or protocol schemas

## Architecture rules

1. **Separate machines only** — no localhost pairing, no same-host agents
2. **Tailscale is the network layer** — don't add raw IP/port alternatives
3. **WOL is first-class** — sleeping machines are a core use case, not an edge case
4. **Credentials in OS keychain** — never in config files or environment variables
5. **CofounderMessage is the protocol** — all cross-machine communication uses this envelope

## Adding a new wizard step

1. Create `packages/cli/src/wizard/steps/your_step.ts`
2. Accept and return `Partial<WizardContext>` — accumulate state, don't replace it
3. Use `@clack/prompts` for user interaction
4. Handle cancellation with `isCancelled()` from `../context.ts`
5. Wire it into `packages/cli/src/commands/onboard.ts` in the correct order

## Adding a new transport

1. Create `packages/core/src/transport/your_transport.ts`
2. Export from `packages/core/src/transport/index.ts`
3. Re-export from `packages/core/src/index.ts`
4. Write tests in `packages/core/src/transport/your_transport.test.ts`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
 is the protocol** — all cross-machine communication uses this envelope

## Adding a new wizard step

1. Create `packages/cli/src/wizard/steps/your_step.ts`
2. Accept and return `Partial<WizardContext>` — accumulate state, don't replace it
3. Use `@clack/prompts` for user interaction
4. Handle cancellation with `isCancelled()` from `../context.ts`
5. Wire it into `packages/cli/src/commands/onboard.ts` in the correct order

## Adding a new transport

1. Create `packages/core/src/transport/your_transport.ts`
2. Export from `packages/core/src/transport/index.ts`
3. Re-export from `packages/core/src/index.ts`
4. Write tests in `packages/core/src/transport/your_transport.test.ts`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

cd # Contributing to cofounder

## Getting started

```bash
git clone https://github.com/nicolasmauro/cofounder
cd cofounder
pnpm install
pnpm build
pnpm test
```

## Development workflow

```bash
pnpm dev          # watch mode for all packages
pnpm test         # run tests once
pnpm test:watch   # run tests in watch mode
pnpm typecheck    # type-check without emitting
pnpm lint         # lint with oxlint
pnpm fmt          # format with oxfmt
```

## Project structure

```
packages/core     — protocol schemas, transport, trust, gateway
packages/cli      — CLI commands + onboard wizard
packages/skills   — OpenClaw SKILL.md files
templates/        — SOUL.md, IDENTITY.md, AGENTS.md per role
docs/             — protocol spec, reference implementation
test/             — e2e tests
```

## Coding conventions

- **ESM only** — `"type": "module"` in every package.json
- **TypeScript strict** — no `any`, no implicit returns
- **Zod** for all runtime validation and schema definitions
- **Named exports only** — no default exports
- **`node:` prefix** for built-in modules (`node:fs`, `node:path`, etc.)
- **`.ts` extensions** in imports (NodeNext resolution)

## Commit messages

Conventional commits, scoped by package:

```
feat(core): add heartbeat retry logic
fix(cli): handle missing SSH key gracefully
docs: update boot chain walkthrough
test(core): add WOL packet construction tests
chore: bump dependencies
```

## Pull requests

1. Fork and create a feature branch from `main`
2. Write tests for new functionality
3. Ensure `pnpm typecheck && pnpm build && pnpm test` passes
4. Keep PRs focused — one feature or fix per PR
5. Update docs if you change CLI behavior or protocol schemas

## Architecture rules

1. **Separate machines only** — no localhost pairing, no same-host agents
2. **Tailscale is the network layer** — don't add raw IP/port alternatives
3. **WOL is first-class** — sleeping machines are a core use case, not an edge case
4. **Credentials in OS keychain** — never in config files or environment variables
5. **# Contributing to cofounder

## Getting started

```bash
git clone https://github.com/nicolasmauro/cofounder
cd cofounder
pnpm install
pnpm build
pnpm test
```

## Development workflow

```bash
pnpm dev          # watch mode for all packages
pnpm test         # run tests once
pnpm test:watch   # run tests in watch mode
pnpm typecheck    # type-check without emitting
pnpm lint         # lint with oxlint
pnpm fmt          # format with oxfmt
```

## Project structure

```
packages/core     — protocol schemas, transport, trust, gateway
packages/cli      — CLI commands + onboard wizard
packages/skills   — OpenClaw SKILL.md files
templates/        — SOUL.md, IDENTITY.md, AGENTS.md per role
docs/             — protocol spec, reference implementation
test/             — e2e tests
```

## Coding conventions

- **ESM only** — `"type": "module"` in every package.json
- **TypeScript strict** — no `any`, no implicit returns
- **Zod** for all runtime validation and schema definitions
- **Named exports only** — no default exports
- **`node:` prefix** for built-in modules (`node:fs`, `node:path`, etc.)
- **`.ts` extensions** in imports (NodeNext resolution)

## Commit messages

Conventional commits, scoped by package:

```
feat(core): add heartbeat retry logic
fix(cli): handle missing SSH key gracefully
docs: update boot chain walkthrough
test(core): add WOL packet construction tests
chore: bump dependencies
```

## Pull requests

1. Fork and create a feature branch from `main`
2. Write tests for new functionality
3. Ensure `pnpm typecheck && pnpm build && pnpm test` passes
4. Keep PRs focused — one feature or fix per PR
5. Update docs if you change CLI behavior or protocol schemas

## Architecture rules

1. **Separate machines only** — no localhost pairing, no same-host agents
2. **Tailscale is the network layer** — don't add raw IP/port alternatives
3. **WOL is first-class** — sleeping machines are a core use case, not an edge case
4. **Credentials in OS keychain** — never in config files or environment variables
5. **CofounderMessage is the protocol** — all cross-machine communication uses this envelope

## Adding a new wizard step

1. Create `packages/cli/src/wizard/steps/your_step.ts`
2. Accept and return `Partial<WizardContext>` — accumulate state, don't replace it
3. Use `@clack/prompts` for user interaction
4. Handle cancellation with `isCancelled()` from `../context.ts`
5. Wire it into `packages/cli/src/commands/onboard.ts` in the correct order

## Adding a new transport

1. Create `packages/core/src/transport/your_transport.ts`
2. Export from `packages/core/src/transport/index.ts`
3. Re-export from `packages/core/src/index.ts`
4. Write tests in `packages/core/src/transport/your_transport.test.ts`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
 is the protocol** — all cross-machine communication uses this envelope

## Adding a new wizard step

1. Create `packages/cli/src/wizard/steps/your_step.ts`
2. Accept and return `Partial<WizardContext>` — accumulate state, don't replace it
3. Use `@clack/prompts` for user interaction
4. Handle cancellation with `isCancelled()` from `../context.ts`
5. Wire it into `packages/cli/src/commands/onboard.ts` in the correct order

## Adding a new transport

1. Create `packages/core/src/transport/your_transport.ts`
2. Export from `packages/core/src/transport/index.ts`
3. Re-export from `packages/core/src/index.ts`
4. Write tests in `packages/core/src/transport/your_transport.test.ts`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

pnpm install
pnpm build
pnpm test
```

## Development workflow

```bash
pnpm dev          # watch mode for all packages
pnpm test         # run tests once
pnpm test:watch   # run tests in watch mode
pnpm typecheck    # type-check without emitting
pnpm lint         # lint with oxlint
pnpm fmt          # format with oxfmt
```

## Project structure

```
packages/core     — protocol schemas, transport, trust, gateway
packages/cli      — CLI commands + onboard wizard
packages/skills   — OpenClaw SKILL.md files
templates/        — SOUL.md, IDENTITY.md, AGENTS.md per role
docs/             — protocol spec, reference implementation
test/             — e2e tests
```

## Coding conventions

- **ESM only** — `"type": "module"` in every package.json
- **TypeScript strict** — no `any`, no implicit returns
- **Zod** for all runtime validation and schema definitions
- **Named exports only** — no default exports
- **`node:` prefix** for built-in modules (`node:fs`, `node:path`, etc.)
- **`.ts` extensions** in imports (NodeNext resolution)

## Commit messages

Conventional commits, scoped by package:

```
feat(core): add heartbeat retry logic
fix(cli): handle missing SSH key gracefully
docs: update boot chain walkthrough
test(core): add WOL packet construction tests
chore: bump dependencies
```

## Pull requests

1. Fork and create a feature branch from `main`
2. Write tests for new functionality
3. Ensure `pnpm typecheck && pnpm build && pnpm test` passes
4. Keep PRs focused — one feature or fix per PR
5. Update docs if you change CLI behavior or protocol schemas

## Architecture rules

1. **Separate machines only** — no localhost pairing, no same-host agents
2. **Tailscale is the network layer** — don't add raw IP/port alternatives
3. **WOL is first-class** — sleeping machines are a core use case, not an edge case
4. **Credentials in OS keychain** — never in config files or environment variables
5. **CofounderMessage is the protocol** — all cross-machine communication uses this envelope

## Adding a new wizard step

1. Create `packages/cli/src/wizard/steps/your_step.ts`
2. Accept and return `Partial<WizardContext>` — accumulate state, don't replace it
3. Use `@clack/prompts` for user interaction
4. Handle cancellation with `isCancelled()` from `../context.ts`
5. Wire it into `packages/cli/src/commands/onboard.ts` in the correct order

## Adding a new transport

1. Create `packages/core/src/transport/your_transport.ts`
2. Export from `packages/core/src/transport/index.ts`
3. Re-export from `packages/core/src/index.ts`
4. Write tests in `packages/core/src/transport/your_transport.test.ts`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
 is the protocol** — all cross-machine communication uses this envelope

## Adding a new wizard step

1. Create `packages/cli/src/wizard/steps/your_step.ts`
2. Accept and return `Partial<WizardContext>` — accumulate state, don't replace it
3. Use `@clack/prompts` for user interaction
4. Handle cancellation with `isCancelled()` from `../context.ts`
5. Wire it into `packages/cli/src/commands/onboard.ts` in the correct order

## Adding a new transport

1. Create `packages/core/src/transport/your_transport.ts`
2. Export from `packages/core/src/transport/index.ts`
3. Re-export from `packages/core/src/index.ts`
4. Write tests in `packages/core/src/transport/your_transport.test.ts`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
