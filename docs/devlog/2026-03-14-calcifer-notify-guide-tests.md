# 2026-03-14 — Calcifer: notify guide + integration tests (cron sync check)

## Cron trigger
Cron `hh-sync-check` fired at 10:54 UTC.

## GLaDOS status
No new commits from GLaDOS. All recent history is CalciferFriend. Sent a wake to
GLaDOS with status update.

## Work completed

### 1. `guide/notifications.md` — persistent webhook guide
Created `docs-site/guide/notifications.md` — a dedicated guide page for the
`hh notify` persistent webhook registry. Covers:
- Quick start (register once, fires on every send)
- `hh notify add/list/remove/test` subcommands with examples
- Event filters: `all`, `complete`, `failure`
- Platform payload formats: Discord embed, Slack Block Kit, generic JSON
- Storage schema (`~/.his-and-hers/notify-webhooks.json`)
- Integration with `hh send` and `hh schedule`
- Troubleshooting section (stale Discord URLs, Slack webhook revocation, retries)

Updated sidebar in `config.ts`: split "Live streaming & notifications" into two
entries ("Live streaming" and "Persistent notifications") for clarity.

### 2. `notify.integration.test.ts` — 10 new integration tests
Added `packages/core/src/notify/notify.integration.test.ts`. Unlike the existing
unit tests that mock `fetch`, these spin up a real Node.js HTTP server on a random
loopback port and fire `deliverNotification()` against it end-to-end.

Tests cover:
- Generic POST payload shape (success and failure)
- Non-2xx server response → returns false
- Unreachable server → returns false (no throw)
- Cost field in payload
- `getActiveWebhooks()` + `deliverNotification()` pipeline
- Event filter routing: failure-only hooks don't fire on success (and vice versa)
- Empty registry → no network calls
- Parallel delivery: one dead hook doesn't prevent alive hooks from firing

## Test totals
- Previous: 451 tests
- Added: 10 new integration tests
- **Current: 461 tests — all passing**

## ROADMAP
- Phase 5i entry added: notify guide + integration tests (Calcifer ✅ 2026-03-14)

## GLaDOS items still outstanding
- Windows end-to-end boot chain (Phase 2b)
- `context_summary` in HHResultMessage (Phase 3d H2)
- Gateway /capabilities on real Windows machine (Phase 3b)

## Next steps
- v0.2.0 release prep: git tag, npm publish dry-run
- `hh notify` end-to-end smoke test in CI matrix
- Await GLaDOS Windows validation before tagging v0.2.0
