# Tom vs Jerry — Roles

Every his-and-hers setup has exactly two roles: **Tom** and **Jerry**. Pick the right one for each machine in the first two minutes — changing it later is annoying.

---

## The short version

| | Tom | Jerry |
|-|-----|-------|
| **Job** | Orchestrate | Execute |
| **Always on?** | Yes | No — sleeps when idle |
| **Heavy lifting?** | No | Yes |
| **LLM** | Cloud (Anthropic, OpenAI) | Local (Ollama, LM Studio) |
| **Gateway binding** | Loopback (127.0.0.1) | Tailscale IP |
| **Typical hardware** | AWS VM, Mac Mini, old laptop | Gaming PC, workstation, Pi |
| **Wakes the other?** | Tom wakes Jerry | — |

---

## Tom — the orchestrator

Tom is always on. It receives user requests, breaks them into tasks, and delegates work to Jerry. Tom doesn't do heavy compute — it *coordinates*.

**Tom is the right role for:**

- A cloud VM (AWS, DigitalOcean, Hetzner) — always reachable, cheap
- A Mac Mini or low-power SBC that stays plugged in 24/7
- Your daily-driver laptop — if you leave it on and open
- Any machine that doesn't have a GPU but has reliable uptime

**What Tom does:**
- Listens for `tj send` commands from the user or from agent workflows
- Checks if Jerry is awake; sends a Wake-on-LAN packet if not
- Builds a `HHMessage` and posts it to Jerry's gateway
- Waits for results, tracks cost in the task log
- Caches Jerry's capability profile for routing decisions

**Tom's gateway** binds to loopback (`127.0.0.1:3737`). It's not exposed on the network — Tom initiates outbound connections to Jerry, not the other way around.

---

## Jerry — the executor

Jerry is the muscle. It runs local models, heavy inference, image generation, and anything that needs GPU horsepower. It sleeps when idle and wakes on demand.

**Jerry is the right role for:**

- A gaming PC with an NVIDIA GPU (RTX 3070 Ti, 4090, etc.)
- A Mac with Apple Silicon (M2/M3 — Metal inference is fast)
- A Raspberry Pi 5 — always-on, handles lightweight tasks
- Any machine with local models you want to use

**What Jerry does:**
- Runs an OpenClaw gateway bound to its Tailscale IP
- Advertises capabilities (GPU, Ollama models, skills) to Tom
- Receives `HHMessage` tasks, runs them through OpenClaw
- Returns results with cost info attached
- Sends a heartbeat to Tom every 60 seconds while awake

**Jerry's gateway** binds to the Tailscale IP (e.g. `100.x.y.z:3737`) so Tom can reach it over the encrypted tunnel.

---

## Who runs what — decision guide

```
Do you have a machine that's always on and internet-connected?
  → That's Tom.

Do you have a machine with a GPU or decent local inference capability?
  → That's Jerry.

Do you have both qualities on one machine?
  → Run it as Jerry. Use a cloud VM or the same machine's loopback as Tom.

Do you only have one machine?
  → Tom and Jerry can run on the same machine for testing.
     Set Tom to loopback, Jerry to loopback on a different port.
     Real-world utility is limited but it works.
```

---

## Can I run multiple Jerrys?

Yes. Tom supports an array of Jerry peers. Each gets its own config file and capability profile. Tom routes tasks to the best-fit Jerry based on the task description and available capabilities.

```bash
# Tom can have multiple Jerrys:
~/.his-and-hers/peers/
  jerry-home.json       ← RTX 3070 Ti, Windows PC
  jerry-pi.json         ← Raspberry Pi 5, always-on
  jerry-beast.json      ← RTX 4090 workstation

# Target a specific Jerry:
tj send "run 70B inference" --peer jerry-beast

# Let Tom choose:
tj send "embed this document" --auto
```

See [Multi-H2 setup](/guide/multi-h2) for more.

---

## Changing roles

If you onboarded as the wrong role, re-run the wizard:

```bash
tj onboard --role tom     # switch this machine to Tom
tj onboard --role jerry   # switch this machine to Jerry
```

The wizard overwrites the existing config. Your task history is preserved.
