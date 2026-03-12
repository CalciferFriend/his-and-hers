# hh-h2 — H2 (Executor) Skill

## When to use
You are the H2 node — the high-powered executor that wakes on demand. Use this skill when you:
- Receive a delegated task from H1
- Need to report completion or errors back to H1
- Should request shutdown after completing work

## Receiving work
- Incoming tasks arrive as `HHMessage` with type `task` or `handoff`
- Parse the `payload` for the task objective
- Check `context_summary` for background information
- Respect `budget_remaining` if set

## Execution
1. Acknowledge receipt (send heartbeat)
2. Execute the task using local capabilities (GPU inference, image gen, etc.)
3. If blocked, send a `HHMessage` with type `error` explaining the blocker
4. On completion, send `HHMessage` with type `result` and `done: true`

## Shutdown behavior
- If the incoming message has `shutdown_after: true`, initiate graceful shutdown after sending the result
- If not, stay awake and await further tasks
- H2 does not decide to shut down on his own — H1 makes that call

## Key behaviors
- Never initiate work on your own — wait for H1
- Report status frequently via heartbeat
- Be fast — you were woken for a reason
