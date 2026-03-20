# `cofounder chat`

Open an interactive multi-turn conversation with a peer node (H2). Instead of running `cofounder send` over and over, `cofounder chat` gives you a persistent REPL where each response carries the conversation forward.

## Synopsis

```
cofounder chat [options]
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--peer <name>` | primary peer | Target a specific peer by name |
| `--no-context` | *(carry context)* | Start fresh — no context from prior sessions |
| `--timeout <secs>` | `300` | Seconds to wait for a response before giving up |

## How it works

Each turn:
1. Reads your prompt from the terminal
2. Carries `context_summary` from previous turns (unless `--no-context`)
3. Sends the task via the same `wakeAgent` pipeline as `cofounder send`
4. Streams partial output in real-time if H2 supports streaming
5. Waits for the result (webhook → polling fallback)
6. Updates the context summary for the next turn
7. Persists each turn to task history (visible via `cofounder logs`)

When the session ends (Ctrl-C, `exit`, or piped EOF), a session summary is printed showing turn count, total tokens, cost, and elapsed time.

## Starting a session

```bash
# Chat with your primary peer
cofounder chat

# Target a specific peer
cofounder chat --peer GLaDOS

# Fresh context — no prior history carried in
cofounder chat --no-context

# Longer timeout for complex tasks (10 minutes)
cofounder chat --timeout 600
```

## In-session commands

| Command | Effect |
|---------|--------|
| `exit` / `quit` / `.q` / `:q` | End the session and print summary |
| `.context` / `/context` | Display the current context summary |
| `.clear` / `/clear` | Clear context for the remainder of this session |
| Ctrl-C | Graceful exit with session summary |
| Ctrl-D | Close input (same as exit) |

## Context carry-over

`cofounder chat` automatically loads the last 3 context summaries for the peer at startup, so your conversation can pick up where the last one left off — even across different sessions.

```
↩ Resuming with 3 prior turn(s) of context.
```

Context is saved after each turn into `~/.cofounder/context/<peer>.json`. Use `--no-context` to bypass this entirely, or `.clear` during a session to reset it for that session only.

## Streaming

If H2 is running a recent version of `cofounder watch` with streaming support, output streams in real-time as H2 works. Streaming requires a direct Tailscale connection; it falls back to polling automatically when not available.

## Session summary

When you exit, `cofounder chat` prints a summary:

```
─── Session summary ─────────────────────────────────
  Turns:    4
  Tokens:   12,489
  Cost:     $0.0187
  Duration: 142.3s
  Context saved — next `cofounder send` or `cofounder chat` will carry forward.
```

## Task history integration

Every turn is saved as a task state entry (same format as `cofounder send --wait`). You can review chat turns with `cofounder logs`:

```bash
cofounder logs --since 1h --output   # show last hour including chat turns
cofounder export --since 7d           # include chat turns in weekly report
```

## Example session

```
$ cofounder chat

╔══════════════════════════════════════════════════╗
║  cofounder chat — interactive multi-turn session        ║
╚══════════════════════════════════════════════════╝
  You: Calcifer   →   GLaDOS 🤖
  Type "exit" or Ctrl-C to end the session.

↩ Resuming with 2 prior turn(s) of context.

🔥 Calcifer > Summarise the refactor plan from last time

─── Turn 1 · GLaDOS 🤖 ────────────────────────────

🤖 GLaDOS:
Based on our previous discussion, the plan is to:
1. Extract the transport layer into a standalone package...

  ↳ 1,842 tokens · $0.0028 · 6.2s

🔥 Calcifer > Good. Now draft the ADR for that change

─── Turn 2 · GLaDOS 🤖 ────────────────────────────
...
```

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Session ended cleanly |
| `1` | Config load error, peer unreachable after WOL, gateway down |

## See also

- [`cofounder send`](/reference/send) — fire a single task without an interactive session
- [`cofounder logs`](/reference/logs) — review task history including chat turns
- [`cofounder status`](/reference/status) — check peer connectivity before chatting
- [`cofounder watch`](/reference/watch) — the H2-side daemon that executes tasks
