# H1 vs H2 — Roles

Every cofounder setup has exactly two roles: **H1** and **H2**. Pick the right one for each machine in the first two minutes — changing it later is annoying.

---

## The short version

| | H1 | H2 |
|-|-----|-------|
| **Job** | Orchestrate | Execute |
| **Always on?** | Yes | No — sleeps when idle |
| **Heavy lifting?** | No | Yes |
| **LLM** | Cloud (Anthropic, OpenAI) | Local (Ollama, LM Studio) |
| **Gateway binding** | Loopback (127.0.0.1) | Tailscale IP |
| **Typical hardware** | AWS VM, Mac Mini, old laptop | Gaming PC, workstation, Pi |
| **Wakes the other?** | H1 wakes H2 | — |

---

## H1 — the orchestrator

H1 is always on. It receives user requests, breaks them into tasks, and delegates work to H2. H1 doesn't do heavy compute — it *coordinates*.

**H1 is the right role for:**

- A cloud VM (AWS, DigitalOcean, Hetzner) — always reachable, cheap
- A Mac Mini or low-power SBC that stays plugged in 24/7
- Your daily-driver laptop — if you leave it on and open
- Any machine that doesn't have a GPU but has reliable uptime

**What H1 does:**
- Listens for `cofounder send` commands from the user or from agent workflows
- Checks if H2 is awake; sends a Wake-on-LAN packet if not
- Builds a `CofounderMessage` and posts it to H2's gateway
- Waits for results, tracks cost in the task log
- Caches H2's capability profile for routing decisions

**H1's gateway** binds to loopback (`127.0.0.1:3737`). It's not exposed on the network — H1 initiates outbound connections to H2, not the other way around.

---

## H2 — the executor

H2 is the muscle. It runs local models, heavy inference, image generation, and anything that needs GPU horsepower. It sleeps when idle and wakes on demand.

**H2 is the right role for:**

- A gaming PC with an NVIDIA GPU (RTX 3070 Ti, 4090, etc.)
- A Mac with Apple Silicon (M2/M3 — Metal inference is fast)
- A Raspberry Pi 5 — always-on, handles lightweight tasks
- Any machine with local models you want to use

**What H2 does:**
- Runs an OpenClaw gateway bound to its Tailscale IP
- Advertises capabilities (GPU, Ollama models, skills) to H1
- Receives `CofounderMessage` tasks, runs them through OpenClaw
- Returns results with cost info attached
- Sends a heartbeat to H1 every 60 seconds while awake

**H2's gateway** binds to the Tailscale IP (e.g. `100.x.y.z:3737`) so H1 can reach it over the encrypted tunnel.

---

## Who runs what — decision guide

```
Do you have a machine that's always on and internet-connected?
  → That's H1.

Do you have a machine with a GPU or decent local inference capability?
  → That's H2.

Do you have both qualities on one machine?
  → Run it as H2. Use a cloud VM or the same machine's loopback as H1.

Do you only have one machine?
  → H1 and H2 can run on the same machine for testing.
     Set H1 to loopback, H2 to loopback on a different port.
     Real-world utility is limited but it works.
```

---

## Can I run multiple Jerrys?

Yes. H1 supports an array of H2 peers. Each gets its own config file and capability profile. H1 routes tasks to the best-fit H2 based on the task description and available capabilities.

```bash
# H1 can have multiple Jerrys:
~/.cofounder/peers/
  h2-home.json       ← RTX 3070 Ti, Windows PC
  h2-pi.json         ← Raspberry Pi 5, always-on
  h2-beast.json      ← RTX 4090 workstation

# Target a specific H2:
cofounder send "run 70B inference" --peer h2-beast

# Let H1 choose:
cofounder send "embed this document" --auto
```

See [Multi-H2 setup](/guide/multi-h2) for more.

---

## Changing roles

If you onboarded as the wrong role, re-run the wizard:

```bash
cofounder onboard --role h1     # switch this machine to H1
cofounder onboard --role h2   # switch this machine to H2
```

The wizard overwrites the existing config. Your task history is preserved.
