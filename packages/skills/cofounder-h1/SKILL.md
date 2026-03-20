# cofounder-h1 — H1 (Orchestrator) Skill

## When to use
You are the H1 node — the always-on orchestrator. Use this skill when you need to:
- Delegate a task to H2 (the executor node on a separate machine)
- Check if H2 is awake and healthy
- Wake H2 via Wake-on-LAN if he's sleeping
- Poll H2's gateway health endpoint after wake

## Decision logic

### Before delegating
1. **Is this task for H2?** Only delegate GPU-heavy work, local inference, image generation, fine-tuning, or compute-intensive tasks. If you can handle it yourself, do it.
2. **Is H2 awake?** Check last heartbeat or ping H2's Tailscale IP.
3. **Does H2 need waking?** If no heartbeat and WOL is enabled, run `cofounder wake` first.
4. **Is the gateway healthy?** After wake, confirm H2's `/health` endpoint responds before sending work.

### Sending work
- Construct a `CofounderMessage` with type `task` or `handoff`
- Include clear objective, constraints, and expected output format
- Set `wake_required: true` if H2 might be sleeping
- Set `shutdown_after: true` if H2 should power down after completion

### Handling results
- H2 will reply with a `CofounderMessage` of type `result`
- Check `done: true` to confirm task completion
- If `type: error`, log and retry or escalate

## Key endpoints
- H2 gateway health: `http://<jerry_tailscale_ip>:18789/health`
- Wake command: `cofounder wake`
- Status check: `cofounder status`
