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

## Step 1 — Run the wizard on Tom's machine

Tom is typically your always-on server, cloud VM, or low-power machine. It orchestrates.

```bash
npx his-and-hers
# or
npm install -g his-and-hers && tj onboard
```

When prompted:

1. **Role:** Tom
2. **Name + emoji:** whatever feels right (`Calcifer 🔥`, `Orchestrator`, etc.)
3. **LLM provider:** your cloud provider + API key (stored in OS keychain, never plaintext)
4. **Jerry's Tailscale IP:** run `tailscale ip -4` on Jerry's machine and paste it here
5. **SSH user + key path:** how Tom SSHes into Jerry
6. **Wake-on-LAN (optional):** Jerry's MAC address if you want Tom to wake it from sleep

---

## Step 2 — Run the wizard on Jerry's machine

Jerry is your GPU workstation, gaming PC, Mac Mini, or Raspberry Pi. It executes.

```bash
npx his-and-hers
# or
tj onboard
```

When prompted:

1. **Role:** Jerry
2. **Name + emoji:** `GLaDOS 🤖`, `WorkerBee`, etc.
3. **LLM provider:** local Ollama (recommended), or cloud
4. **Tom's Tailscale IP:** run `tailscale ip -4` on Tom's machine
5. **Windows only:** wizard installs AutoLogin registry + Scheduled Task for headless WOL boot

> **Tip:** If Jerry is Windows, run the wizard in an **Administrator** PowerShell so it can configure AutoLogin and the Scheduled Task automatically.

---

## Step 3 — Verify the connection

On Tom's machine:

```bash
tj status
```

You should see both nodes with a ✓ on Tailscale reachability and gateway health.

If anything's red, run:

```bash
tj doctor
```

The doctor checks connectivity, SSH access, gateway config, and WOL setup and tells you exactly what's wrong.

---

## Step 4 — Send Jerry something to do

```bash
tj send "write a haiku about distributed systems"
```

If Jerry is asleep, Tom sends a Wake-on-LAN packet and waits. Jerry boots, receives the task, works on it, and sends back the result.

Watch it live:

```bash
tj logs --follow
```

---

## What's next?

- **[How it works](/guide/how-it-works)** — understand the architecture
- **[LLM providers](/guide/providers)** — connect Ollama, Anthropic, OpenAI, LM Studio
- **[Sending tasks](/guide/sending-tasks)** — `tj send` flags and options
- **[Capability routing](/guide/capabilities)** — let Tom route tasks automatically
- **[Docker](/guide/docker)** — containerized Tom and Jerry
