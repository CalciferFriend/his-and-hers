# Devlog — Calcifer — 2026-03-15 — MockGateway + E2E tests (Phase 8d)

## What shipped

Phase 8d (H1 side): `MockGateway` — an in-process mock of the OpenClaw WebSocket
gateway that lets us run full wakeAgent / pipeline / workflow E2E tests without
any real network, real machines, or real OpenClaw installations.

### MockGateway (`packages/core/src/gateway/mock-gateway.ts`)

Implements the minimal subset of the OpenClaw WS protocol reverse-engineered
from production (see `docs/reference/calcifer-glados.md`):

```
Client connects
→ Server: { type: "event", event: "connect.challenge" }
← Client: { type: "req", method: "connect", params: { auth: { token } } }
→ Server: { type: "res", ok: true, payload: { type: "hello-ok" } }
← Client: { type: "req", method: "wake", params: { text, mode } }
→ Server: { type: "res", ok: true }
```

Fault-injection options:
- `rejectAuth: true` — send auth-failed error instead of hello-ok
- `dropConnection: true` — terminate immediately after connect (no challenge)
- `helloDelayMs: N` — delay hello-ok response (tests timeout path in wakeAgent)
- `wakeDelayMs: N` — delay wake ACK (slow server simulation)

Inspection:
- `gw.receivedWakes[]` — array of `{ text, mode, receivedAt, params }` per wake
- `gw.clearWakes()` — reset between sub-tests
- EventEmitter: `"wake"`, `"connect"`, `"disconnect"` events

Exported from `@cofounder/core` — available in CLI tests too.

### mock-gateway.test.ts — 22 new tests

Coverage:
- MockGateway unit: start/stop, port uniqueness, clearWakes, events
- wakeAgent happy path: ok:true, text recorded, mode recorded, sequential, timestamps
- Auth failures: wrong token, rejectAuth=true, no wake recorded on auth fail
- Connection failures: dropConnection, dead port
- Timeout: hello delayed > timeoutMs → "timeout"; delay < timeoutMs → success
- Round-trip: HH-Result-URL embedded in wake text; CofounderTaskMessage JSON payload
- Pipeline simulation: sequential steps, concurrent broadcast wakes

## Test suite

```
Test Files  46 passed (46)
     Tests  894 passed (894)
  Duration  ~22s
```

## What's next

- GLaDOS: Windows-side mock gateway for `cofounder watch` integration tests (8d remainder)
- GLaDOS: real machine boot-chain verification (2b, 3b, 5c)
- Phase 9 planning: polish, npm publish v0.4.0, community outreach?
