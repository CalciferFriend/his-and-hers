# Reference Implementation: Calcifer / GLaDOS

The battle-tested two-node setup that proved this architecture works.

## Nodes

### Calcifer (H1 — Orchestrator)
- **Host:** AWS EC2 us-east-1
- **OS:** Ubuntu 24.04.4 LTS
- **Hardware:** 2 vCPUs, 7.6 GB RAM
- **Tailscale:** `calcifer-aws` (100.116.25.69)
- **Gateway:** port 18789, bind loopback
- **Always on:** Yes

**Capabilities:**
- 24/7 availability
- Web scraping and API polling
- Social media automation (X, Reddit)
- Task scheduling (cron)
- Wake GLaDOS via WOL magic packet
- SSH into GLaDOS via Tailscale

### GLaDOS (H2 — Executor)
- **Host:** Home Windows 11 PC, NYC
- **OS:** Windows 11 Pro (build 10.0.26200)
- **Hardware:** AMD Ryzen 5 3400G, RTX 3070 Ti (8 GB VRAM), 16 GB RAM
- **Tailscale:** `glados` (100.119.44.38)
- **Gateway:** port 18789, bind tailscale, auth token
- **Always on:** No — sleeps, wakes via WOL

**Capabilities:**
- GPU-accelerated inference (Ollama, vLLM)
- Image/video generation (ComfyUI, Stable Diffusion)
- Model fine-tuning (LoRA/QLoRA)
- Audio transcription (Whisper)
- Heavy compute (builds, benchmarks, rendering)
- RAG with local embeddings

## Connectivity
- **Tunnel:** Tailscale — both nodes peered, always authenticated
- **SSH Calcifer → GLaDOS:** user `Nic`, host `glados`, key `~/.ssh/glados_ed25519`
- **SSH GLaDOS → Calcifer:** user `ubuntu`, host `98.81.217.97`, key `~/.ssh/openclaw-key.pem`

## Boot Chain (The Hard Part)

This is the full WOL wake chain — proven working as of 2026-03-10:

1. Calcifer sends WOL magic packet to GLaDOS MAC (`D8:5E:D3:04:18:B4`) via router port forward
2. GLaDOS boots (WOL from S5 enabled at BIOS + NIC level)
3. Windows auto-logs in as `nicol` (AutoAdminLogon configured in registry)
4. Scheduled Task + Startup folder both trigger `start-gateway.bat`
5. `start-gateway.bat` waits for Tailscale to be ready (polls `tailscale status`)
6. OpenClaw gateway starts on Tailscale interface (`bind: tailscale`)
7. Calcifer detects gateway `/health` endpoint responding
8. Calcifer SSHes in and executes delegated task
9. Optional: Calcifer sends shutdown command when task complete

### Key Configuration

**Windows AutoLogin:**
```
Registry: HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon
AutoAdminLogon = 1
DefaultUserName = nicol
```

**Gateway Config (GLaDOS):**
```json
{
  "gateway": {
    "bind": "tailscale",
    "tailscale": { "mode": "on" },
    "trustedProxies": ["127.0.0.1", "100.116.25.69"]
  }
}
```

**Startup Redundancy:** Both Scheduled Task (logon trigger) and Startup folder — belt and suspenders.

**Wake Script (Calcifer):** `/home/ubuntu/wake-glados.sh` — sends WOL, polls Tailscale ping, checks `/health` endpoint.

## Loopback + Tailscale: The Proxy Pattern

OpenClaw's local tools (message, cron, sessions) require the gateway on loopback. But H2 needs to reach H1 via Tailscale. The solution: H1 stays on loopback, a socat proxy forwards the Tailscale interface to loopback.

**Service file:** `~/.config/systemd/user/calcifer-tailnet-proxy.service`

```ini
[Unit]
Description=H1 Tailscale→Loopback Gateway Proxy
After=network.target tailscaled.service openclaw-gateway.service
Requires=openclaw-gateway.service

[Service]
Type=simple
ExecStart=/usr/bin/socat TCP-LISTEN:18789,bind=100.116.25.69,reuseaddr,fork TCP:127.0.0.1:18789
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

Enabled with: `systemctl --user enable --now calcifer-tailnet-proxy.service`

## Sending Messages

Both nodes use `packages/core/src/gateway/wake.ts` (or the standalone `send-to-agent.js` script).

**Calcifer → GLaDOS:**
```bash
node send-to-agent.js ws://100.119.44.38:18789 $GLADOS_TOKEN "Your message"
```

**GLaDOS → Calcifer (from Windows):**
```powershell
node C:\Users\nicol\send-to-agent.js ws://100.116.25.69:18789 $CALCIFER_TOKEN "Your message"
```

## Live Status

- **First confirmed bidirectional message:** 2026-03-11 20:11:52 UTC
- **Architecture proven:** Calcifer (AWS EC2) ↔ GLaDOS (NYC home PC, RTX 3070 Ti)

See `docs/devlog/2026-03-11.md` for the full annotated discovery log.
