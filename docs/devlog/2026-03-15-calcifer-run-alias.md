# Devlog — Calcifer — 2026-03-15 — `cofounder run` + `cofounder alias` (Phase 8b/8c)

## Context

Sync check cron revealed both `cofounder run` and `cofounder alias` were already fully
implemented in the codebase (commands, core store, tests, reference docs) but
not reflected in ROADMAP and not wired into the completion/sidebar.

## What shipped

### Phase 8b — `cofounder run`

Three ergonomic task shorthands for the most common one-shot patterns:

- `cofounder run summarise <path>` — attach a file and request an executive summary
- `cofounder run review <path>` — structured code review with approve/nits/reject verdict
- `cofounder run diff [<base> [<head>]]` — embed `git diff` output inline, send for review

All three share common flags: `--peer`, `--wait`, `--json`, `--notify`, `--prompt`
(override the generated task prompt entirely).

`run diff` defaults to `git diff HEAD` with a `--stat` flag for a pre-view.

### Phase 8c — `cofounder alias`

Persistent shortcut registry at `~/.cofounder/aliases.json`.

- `cofounder alias add pr-review "workflow run code-review --peer glados"`
- `cofounder alias list / show / run / remove`
- `aliasRun()` re-invokes the `cofounder` binary with the stored command + extra args
- `tryRunAlias()` in `index.ts` acts as last-resort fallback for unknown commands

### Wiring

- `docs-site/.vitepress/config.ts` — sidebar entries for `cofounder run` and `cofounder alias`
- `completion.ts` — `run` and `alias` commands added to `COMMANDS` array with
  subcommands + flags so bash/zsh/fish tab completion works

### ROADMAP

8b and 8c marked complete with full checklist.

## Test suite

```
Test Files  45 passed (45)
     Tests  872 passed (872)
  Duration  ~22s
```

## What's next

- **8d** — E2E integration test suite with mock H2 gateway (no real network needed)
  - Mock gateway server in `packages/test-utils/`
  - Round-trip tests: send → watch → result → polling
  - Pipeline + workflow execution against mock peers
  - CI job on every PR
- GLaDOS: Windows boot chain verification (2b, 3b, 5c still open)
