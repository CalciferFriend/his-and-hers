---
layout: home

hero:
  name: "his-and-hers"
  text: "Two agents. Separate machines."
  tagline: One command to wire them. Tom orchestrates. Jerry executes. They never meet but they build things together.
  image:
    src: /hero.svg
    alt: his-and-hers
  actions:
    - theme: brand
      text: Get Started →
      link: /guide/quickstart
    - theme: alt
      text: How it works
      link: /guide/how-it-works
    - theme: alt
      text: View on GitHub
      link: https://github.com/CalciferFriend/his-and-hers

features:
  - icon: ⚡
    title: Under 10 minutes
    details: Run `npx his-and-hers` on each machine. The wizard handles Tailscale pairing, gateway config, Wake-on-LAN, Windows AutoLogin, and startup scripts. No YAML, no manual config files.

  - icon: 🛌
    title: Wake on demand
    details: Jerry sleeps when idle. Tom wakes him via Wake-on-LAN when a task arrives. No idle GPU cost, no always-on power draw. Works across subnets via Magic Packet.

  - icon: 🧠
    title: Capability-aware routing
    details: Jerry advertises what it can do — GPU, VRAM, Ollama models, custom skills. Tom routes tasks automatically. Image gen goes to the RTX. Embeddings go to the Pi. Code goes to the Coder model.

  - icon: 🐳
    title: Docker-native
    details: Pre-built Docker images for Tom (Alpine), Jerry CPU (Debian), Jerry CUDA (NVIDIA), and Jerry ARM64 (Raspberry Pi 5). One `docker run` and you're pairing.

  - icon: 💰
    title: Budget tracking
    details: Every task is costed. `tj budget --week` shows your spend per node, per model, per day. Lightweight tasks auto-route to local models. API calls only when needed.

  - icon: 🌐
    title: Community registry
    details: Publish your node card to the community registry with `tj publish`. Discover other setups with `tj discover`. See what people are building and how they're running their Jerrys.
---

## How it looks

```bash
# On your always-on machine (Tom)
$ npx his-and-hers
✔ Role: Tom (orchestrator)
✔ Name: Calcifer 🔥
✔ Provider: Anthropic → claude-sonnet-4-6
✔ Jerry's Tailscale IP: 100.64.0.42
✔ SSH user: nick, key: ~/.ssh/id_ed25519
✔ Wake-on-LAN: AA:BB:CC:DD:EE:FF → 255.255.255.255
✔ Gateway bound to loopback:3737
✔ Jerry config pushed via SSH
✔ Round-trip test: 218ms ✓

Everything's wired. Run `tj send` to give Jerry something to do.

# Send Jerry a task
$ tj send "generate a landing page hero image for his-and-hers, dark theme, two robots"
🌙 Jerry is asleep — sending Magic Packet...
⏳ Waiting for Jerry to boot (up to 90s)...
✓ Jerry online (62s) — forwarding task...
✓ Task queued: task_01j8fzq... — use `tj logs --follow` to watch

# Check status
$ tj status
┌─────────────────────────────────────────────────┐
│  Tom: Calcifer 🔥        Jerry: GLaDOS 🤖        │
│  aws:us-east-1           home-pc                 │
│  claude-sonnet-4-6       RTX 3070 Ti (8 GB)      │
│  ✓ Tailscale reachable   ✓ Gateway healthy        │
│  Last heartbeat: 2s ago  Ollama: 3 models         │
│  Budget this week: $0.42                          │
└─────────────────────────────────────────────────┘
```

## Pick your Jerry

<div style="display: flex; gap: 1rem; flex-wrap: wrap; margin: 2rem 0">
  <a href="/hardware/pi5" style="flex: 1; min-width: 200px; padding: 1.5rem; border: 1px solid var(--vp-c-divider); border-radius: 8px; text-decoration: none; color: inherit">
    <div style="font-size: 2rem">🍓</div>
    <strong>Raspberry Pi 5</strong><br>
    <small>Always-on, low-power. 3B–7B models, embeddings.</small>
  </a>
  <a href="/hardware/rtx-3070-ti" style="flex: 1; min-width: 200px; padding: 1.5rem; border: 1px solid var(--vp-c-divider); border-radius: 8px; text-decoration: none; color: inherit">
    <div style="font-size: 2rem">🎮</div>
    <strong>RTX 3070 Ti</strong><br>
    <small>Sleep + wake. 13B models, SDXL image gen.</small>
  </a>
  <a href="/hardware/rtx-4090" style="flex: 1; min-width: 200px; padding: 1.5rem; border: 1px solid var(--vp-c-divider); border-radius: 8px; text-decoration: none; color: inherit">
    <div style="font-size: 2rem">🦾</div>
    <strong>RTX 4090</strong><br>
    <small>The beast. 70B, Flux, video gen, fine-tuning.</small>
  </a>
  <a href="/hardware/m2-mac" style="flex: 1; min-width: 200px; padding: 1.5rem; border: 1px solid var(--vp-c-divider); border-radius: 8px; text-decoration: none; color: inherit">
    <div style="font-size: 2rem">🍎</div>
    <strong>M2 / M3 Mac</strong><br>
    <small>Unified memory. Best perf/watt for inference.</small>
  </a>
</div>
