# What is cofounder?

cofounder is an open protocol and setup wizard for connecting two [OpenClaw](https://github.com/openclaw/openclaw) agents on physically separate machines.

**H1** is the orchestrator — always-on, always watching, delegates work outward.  
**H2** is the executor — sleeps until needed, wakes on demand, does the heavy lifting.

H1 can't catch H2 but can't function without him. H2 runs fast, disappears when done. The dynamic is the product.

---

## Why does this exist?

Most AI workflows assume you're running everything in the cloud — one machine, one provider, one bill.

But a lot of people have powerful hardware sitting idle:

- A gaming PC with an RTX 3070 that's only on at night
- A Mac Mini with 16 GB unified memory that's always plugged in
- A Raspberry Pi 5 running 24/7 as a home server
- A workstation with a 4090 that could be running 70B models when you're not gaming

cofounder is the plumbing that makes those machines useful to your agent workflows.

---

## What it does

1. **`cofounder onboard`** — walks you through the full setup in ~10 minutes. Role selection, model provider (local or cloud), Tailscale pairing, SSH, Wake-on-LAN, gateway config, Windows AutoLogin if needed, startup scripts.

2. **`cofounder send "do X"`** — H1 gets a task, wakes H2 if asleep, sends the task, waits for a result. Works from your terminal or from within an agent workflow.

3. **Capability routing** — H2 advertises what it can do (GPU, models, skills). H1 routes tasks automatically. You don't manage which tasks go where — the system figures it out.

4. **Budget tracking** — Every task is costed. `cofounder budget` shows you what you've spent, by day, by peer, by model.

---

## What it is not

- **Not a cloud service.** Everything runs on your machines over Tailscale. No data leaves your network except to your chosen LLM provider.
- **Not locked to OpenClaw.** The protocol is open. Any agent runtime that can speak the CofounderMessage format can be a H1 or H2.
- **Not magic.** You need two machines, Tailscale on both, and Node ≥ 22. That's it.

---

## Quick example

```bash
# H1 delegates an image generation task
cofounder send "generate a product mockup for a coffee brand, dark roast, earthy tones"

# H2 (RTX 3070 Ti, running SDXL) wakes up, runs the task, returns the image path
# → /Users/nick/cofounder-results/task_01j8fzq.../output.png
```

```bash
# H1 asks H2 to summarize a document using a 70B model
cofounder send "summarize this PDF and extract action items" --attach report.pdf

# H2 (M2 Mac, 32 GB, running llama3:70b) handles it
# → H1 receives a structured summary
```

---

## Next steps

- [Quickstart →](/guide/quickstart) — up and running in 5 minutes
- [How it works →](/guide/how-it-works) — the architecture
- [Pick an H2 →](/hardware/overview) — hardware profiles
