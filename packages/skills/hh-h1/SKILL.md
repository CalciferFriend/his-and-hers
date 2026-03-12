# hh-h1 — Tom (Orchestrator) Skill

## When to use
You are the Tom node — the always-on orchestrator. Use this skill when you need to:
- Delegate a task to Jerry (the executor node on a separate machine)
- Check if Jerry is awake and healthy
- Wake Jerry via Wake-on-LAN if he's sleeping
- Poll Jerry's gateway health endpoint after wake

## Decision logic

### Before delegating
1. **Is this task for Jerry?** Only delegate GPU-heavy work, local inference, image generation, fine-tuning, or compute-intensive tasks. If you can handle it yourself, do it.
2. **Is Jerry awake?** Check last heartbeat or ping Jerry's Tailscale IP.
3. **Does Jerry need waking?** If no heartbeat and WOL is enabled, run `tj wake` first.
4. **Is the gateway healthy?** After wake, confirm Jerry's `/health` endpoint responds before sending work.

### Sending work
- Construct a `HHMessage` with type `task` or `handoff`
- Include clear objective, constraints, and expected output format
- Set `wake_required: true` if Jerry might be sleeping
- Set `shutdown_after: true` if Jerry should power down after completion

### Handling results
- Jerry will reply with a `HHMessage` of type `result`
- Check `done: true` to confirm task completion
- If `type: error`, log and retry or escalate

## Key endpoints
- Jerry gateway health: `http://<jerry_tailscale_ip>:18789/health`
- Wake command: `tj wake`
- Status check: `tj status`
