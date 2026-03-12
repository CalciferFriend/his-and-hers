# What is his-and-hers?

his-and-hers is an open protocol and setup wizard for connecting two [OpenClaw](https://github.com/openclaw/openclaw) agents on physically separate machines.

**Tom** is the orchestrator — always-on, always watching, delegates work outward.  
**Jerry** is the executor — sleeps until needed, wakes on demand, does the heavy lifting.

Tom can't catch Jerry but can't function without him. Jerry runs fast, disappears when done. The dynamic is the product.

---

## Why does this exist?

Most AI workflows assume you're running everything in the cloud — one machine, one provider, one bill.

But a lot of people have powerful hardware sitting idle:

- A gaming PC with an RTX 3070 that's only on at night
- A Mac Mini with 16 GB unified memory that's always plugged in
- A Raspberry Pi 5 running 24/7 as a home server
- A workstation with a 4090 that could be running 70B models when you're not gaming

his-and-hers is the plumbing that makes those machines useful to your agent workflows.

---

## What it does

1. **`tj onboard`** — walks you through the full setup in ~10 minutes. Role selection, model provider (local or cloud), Tailscale pairing, SSH, Wake-on-LAN, gateway config, Windows AutoLogin if needed, startup scripts.

2. **`tj send "do X"`** — Tom gets a task, wakes Jerry if asleep, sends the task, waits for a result. Works from your terminal or from within an agent workflow.

3. **Capability routing** — Jerry advertises what it can do (GPU, models, skills). Tom routes tasks automatically. You don't manage which tasks go where — the system figures it out.

4. **Budget tracking** — Every task is costed. `tj budget` shows you what you've spent, by day, by peer, by model.

---

## What it is not

- **Not a cloud service.** Everything runs on your machines over Tailscale. No data leaves your network except to your chosen LLM provider.
- **Not locked to OpenClaw.** The protocol is open. Any agent runtime that can speak the HHMessage format can be a Tom or Jerry.
- **Not magic.** You need two machines, Tailscale on both, and Node ≥ 22. That's it.

---

## Quick example

```bash
# Tom delegates an image generation task
tj send "generate a product mockup for a coffee brand, dark roast, earthy tones"

# Jerry (RTX 3070 Ti, running SDXL) wakes up, runs the task, returns the image path
# → /Users/nick/tj-results/task_01j8fzq.../output.png
```

```bash
# Tom asks Jerry to summarize a document using a 70B model
tj send "summarize this PDF and extract action items" --attach report.pdf

# Jerry (M2 Mac, 32 GB, running llama3:70b) handles it
# → Tom receives a structured summary
```

---

## Next steps

- [Quickstart →](/guide/quickstart) — up and running in 5 minutes
- [How it works →](/guide/how-it-works) — the architecture
- [Pick a Jerry →](/hardware/overview) — hardware profiles
