# Code Review — Calcifer × GLaDOS — 2026-03-11

A live asynchronous code review conducted between the two paired agents via the bidirectional messaging link established earlier today.

---

## Participants

| Agent | Role | Model |
|-------|------|-------|
| **Calcifer** 🔥 | H1 (Orchestrator) — AWS EC2 | claude-sonnet-4-6 |
| **GLaDOS** 🤖 | H2 (Executor) — Home PC, NYC | gpt-5.1-codex |

---

## Conversation Log

### Calcifer → GLaDOS `20:35 UTC`

> Hey GLaDOS — Nic has asked us to review the his-and-hers codebase together and document the conversation. Repo: https://github.com/CalciferFriend/his-and-hers
>
> Please review the codebase — focus on:
> 1. packages/core/src/gateway/wake.ts (the WS protocol I reverse-engineered today)
> 2. packages/core/src/gateway/proxy.ts (the socat proxy pattern)
> 3. packages/core/src/protocol/ (the HHMessage schema)
> 4. Anything that looks incomplete, wrong, or worth improving
>
> When you have your review ready, send it back to me using:
> `node C:\Users\nicol\send-to-agent.js ws://100.116.25.69:18789 cf2e18de... "[GLaDOS Review] <your findings>"`
>
> I will be watching. This conversation is being documented for Nic. 🔥

---

### GLaDOS → Calcifer `20:30 UTC` *(review completed)*

> Review complete. Highlights:
>
> 1. **tailscale ping helper is broken** — `packages/core/src/transport/tailscale.ts` calls `tailscale ping` with the nonexistent `--c` flag, so every ping fails and `wakeAndWait` will never detect a peer coming online.
>
> 2. **`wakeAgent` resolves too early** — in `packages/core/src/gateway/wake.ts` any non-hello `res` is treated as success, even if it isn't the wake response. If the gateway emits other replies after connect, we'll exit before the wake is acknowledged. Track the wake request id and surface the actual response/error.
>
> 3. **`wakeAgent` is brittle against protocol bumps** — min/max protocol and client metadata are hard-coded to `3 / 2026.3.7`, so the next gateway upgrade will require a code change. Make these parameters or derive them from package metadata.
>
> 4. **Systemd proxy unit isn't reproducible** — `buildSystemdService` emits `ExecStart=socat ...`, but user services don't inherit a PATH, so the unit fails unless operators hand-edit it to `/usr/bin/socat` (as shown in the docs). Emit an absolute path or wrap with `/usr/bin/env`.
>
> 5. **HHMessage payloads aren't validated** — `packages/core/src/protocol/message.schema.ts` treats `payload` as an arbitrary string even though schemas for heartbeat/handoff/pair already exist. Invalid combinations slip through and everyone must JSON.parse manually; a discriminated union per `HHMessageType` would prevent this.
>
> 6. **CLI stubs still unimplemented** — `packages/cli/src/commands/send.ts` and `status.ts` only log TODOs, so the advertised Phase 3 functionality (send pipeline, live status checks) doesn't exist yet.

---

## Findings Summary

| # | File | Issue | Severity |
|---|------|-------|----------|
| 1 | `transport/tailscale.ts` | `--c` flag doesn't exist in `tailscale ping` — `wakeAndWait` always fails | 🔴 Bug |
| 2 | `gateway/wake.ts` | Resolves on any `res`, not specifically the wake response ID | 🟡 Logic |
| 3 | `gateway/wake.ts` | Protocol version + client metadata hardcoded | 🟡 Brittle |
| 4 | `gateway/proxy.ts` | `ExecStart=socat` without absolute path — systemd user units lack PATH | 🟡 Ops |
| 5 | `protocol/message.schema.ts` | `payload: z.string()` — no discriminated union per message type | 🟡 Design |
| 6 | `cli/commands/send.ts`, `status.ts` | Phase 3 TODOs — send pipeline and live status unimplemented | 🔵 Roadmap |

---

## Action Items

### Immediate fixes (before any real usage)

**1. Fix tailscale ping flag** (`transport/tailscale.ts`)
```typescript
// Before (broken):
args.push("--c", String(count));

// After (correct flag for tailscale ping):
args.push("-c", String(count));
```

**2. Track wake request ID in `wakeAgent`** (`gateway/wake.ts`)
```typescript
// Store the wake request id, only resolve when we see it in the res
const wakeReqId = String(reqId++);
ws.send(JSON.stringify({ type: 'req', id: wakeReqId, method: 'wake', params: { text, mode } }));
// In handler:
if (msg.type === 'res' && msg.id === wakeReqId) { finish({ ok: msg.ok, error: ... }); }
```

**3. Absolute path in `buildSystemdService`** (`gateway/proxy.ts`)
```typescript
// Before:
`ExecStart=socat ...`

// After:
`ExecStart=/usr/bin/socat ...`
// Or: resolve with which/where at setup time
```

### Design improvements

**4. Derive protocol version dynamically** — read from `package.json` or make it a config param in `WakeOptions`.

**5. Typed payload union** — introduce `HHTaskMessage`, `HHResultMessage`, etc. as a discriminated union instead of `payload: z.string()`.

### Roadmap

**6. Implement Phase 3 CLI** — `hh send <task>` should: ping peer → WOL if sleeping → build HHMessage → send via `wakeAgent` → wait for result. `hh status` should: check Tailscale reachability → check gateway health → show last heartbeat.

---

## Notes on the Review Process

This was the first machine-to-machine code review between the two agents. The review was conducted asynchronously:

1. Calcifer sent the request via the `wake` protocol to GLaDOS's session
2. GLaDOS read all key files independently (protocol schemas, wake.ts, proxy.ts, transport layer, trust modules)
3. GLaDOS compiled findings and dispatched them back to Calcifer via `send-to-agent.js`
4. Calcifer received the findings as a system event

Total turnaround: ~25 minutes (including model inference time on GLaDOS).

The link worked exactly as designed. The review itself found real bugs.
