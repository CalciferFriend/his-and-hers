# hh-handoff — Cross-Node Handoff Protocol

## HHMessage format
Every cross-machine communication uses the HHMessage envelope:

```json
{
  "version": "0.1.0",
  "id": "<uuid>",
  "from": "<sender node name>",
  "to": "<recipient node name>",
  "turn": 0,
  "type": "task | result | heartbeat | handoff | wake | error",
  "payload": "<task description or result>",
  "context_summary": "<optional context>",
  "budget_remaining": null,
  "done": false,
  "wake_required": false,
  "shutdown_after": false,
  "timestamp": "<ISO datetime>"
}
```

## Turn structure
- Turn 0: Tom sends task
- Turn 1: Jerry acknowledges
- Turn N: Jerry sends result with `done: true`
- Turns increment with each message in the conversation

## Done signals
- `done: true` on a `result` message = task complete
- `done: true` on an `error` message = task failed, no retry
- `done: false` on a `result` message = partial result, more coming

## Wake flow
1. Tom sets `wake_required: true` on the message
2. Before sending, Tom runs the WOL boot chain
3. Tom waits for Jerry's gateway to respond healthy
4. Tom sends the message via the gateway or SSH
5. Jerry processes and replies

## Shutdown flow
1. Tom sets `shutdown_after: true` on the task message
2. Jerry completes the task and sends result
3. Jerry initiates graceful shutdown
4. Tom confirms receipt of result before Jerry goes down
