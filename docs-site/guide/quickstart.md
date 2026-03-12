# Quickstart

Two machines, two commands, ~10 minutes.

---

## Prerequisites

On **both** machines:

| Requirement | Version | Install |
|-------------|---------|---------|
| Node.js | ≥ 22 | [nodejs.org](https://nodejs.org) |
| Tailscale | any | [tailscale.com](https://tailscale.com/download) |
| OpenClaw | any | `npm install -g openclaw` |

Both machines must be connected to the same Tailscale network (same account or shared via Tailscale's share feature).

---

## Step 1 — Run the wizard on H1's machine

H1 is typically your always-on server, cloud VM, or low-power machine. It orchestrates.

```bash
npx his-and-hers
# or
npm install -g his-and-hers && hh onboard
```

When prompted:

1. **Role:** H1
2. **Name + emoji:** whatever feels right (`Calcifer 🔥`, `Orchestrator`, etc.)
3. **LLM provider:** your cloud provider + API key (stored in OS keychain, never plaintext)
4. **H2's Tailscale IP:** run `tailscale ip -4` on H2's machine and paste it here
5. **SSH user + key path:** how H1 SSHes into H2
6. **Wake-on-LAN (optional):** H2's MAC address if you want H1 to wake it from sleep

---

## Step 2 — Run the wizard on H2's machine

H2 is your GPU workstation, gaming PC, Mac Mini, or Raspberry Pi. It executes.

```bash
npx his-and-hers
# or
hh onboard
```

When prompted:

1. **Role:** H2
2. **Name + emoji:** `GLaDOS 🤖`, `WorkerBee`, etc.
3. **LLM provider:** local Ollama (recommended), or cloud
4. **H1's Tailscale IP:** run `tailscale ip -4` on H1's machine
5. **Windows only:** wizard installs AutoLogin registry + Scheduled Task for headless WOL boot

> **Tip:** If H2 is Windows, run the wizard in an **Administrator** PowerShell so it can configure AutoLogin and the Scheduled Task automatically.

---

## Step 3 — Verify the connection

On H1's machine:

```bash
hh status
```

You should see both nodes with a ✓ on Tailscale reachability and gateway health.

If anything's red, run:

```bash
hh doctor
```

The doctor checks connectivity, SSH access, gateway config, and WOL setup and tells you exactly what's wrong.

---

## Step 4 — Send H2 something to do

```bash
hh send "write a haiku about distributed systems"
```

If H2 is asleep, H1 sends a Wake-on-LAN packet and waits. H2 boots, receives the task, works on it, and sends back the result.

Watch it live:

```bash
hh logs --follow
```

---

## What's next?

- **[How it works](/guide/how-it-works)** — understand the architecture
- **[LLM providers](/guide/providers)** — connect Ollama, Anthropic, OpenAI, LM Studio
- **[Sending tasks](/guide/sending-tasks)** — `hh send` flags and options
- **[Capability routing](/guide/capabilities)** — let H1 route tasks automatically
- **[Docker](/guide/docker)** — containerized H1 and H2
