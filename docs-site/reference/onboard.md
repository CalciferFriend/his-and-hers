# `tj onboard` — Reference

Interactive setup wizard. Configures everything needed to get Tom and Jerry talking: role, identity, LLM provider, Tailscale pairing, SSH, Wake-on-LAN, gateway config, Windows AutoLogin, and startup scripts.

---

## Synopsis

```bash
tj onboard [flags]
```

---

## Flags

| Flag | Description |
|------|-------------|
| `--role tom` | Skip role selection, configure as Tom |
| `--role jerry` | Skip role selection, configure as Jerry |
| `--non-interactive` | Skip wizard, use environment variables (Docker/CI) |
| `--reconfigure-provider` | Re-run only the LLM provider setup step |
| `--reconfigure-gateway` | Re-run only the gateway setup step |
| `--reconfigure-peer` | Re-run only the peer connection step |
| `--regenerate-token` | Generate a new gateway token and sync to peers |
| `--reset` | Delete config and start from scratch |

---

## Wizard steps

### Tom role

1. **Role:** Tom
2. **Identity:** name, emoji
3. **LLM provider:** Anthropic / OpenAI / Ollama / custom
4. **API key:** stored in OS keychain via `keytar`
5. **Cost routing:** lightweight model vs standard model
6. **Peer connection:** Jerry's Tailscale IP, SSH user, SSH key path
7. **SSH test:** validates key, confirms SSH works
8. **Gateway config:** loopback bind (127.0.0.1), port, token
9. **Autostart:** creates systemd service (Linux) or launchd plist (macOS)
10. **Round-trip test:** sends a test ping to Jerry and waits for response

### Jerry role

1. **Role:** Jerry
2. **Identity:** name, emoji
3. **LLM provider:** Ollama (auto-detected) / LM Studio / custom
4. **Tom's Tailscale IP**
5. **Gateway config:** Tailscale IP bind, port, token
6. **WOL:** MAC address, broadcast IP, port
7. **Autostart:**
   - Linux: systemd service
   - macOS: launchd plist
   - Windows: AutoLogin registry + Scheduled Task + Firewall rule
8. **Capabilities:** runs `tj capabilities advertise`

---

## Environment variables (non-interactive mode)

Used by Docker and CI:

| Variable | Description |
|----------|-------------|
| `TJ_ROLE` | `tom` or `jerry` |
| `TJ_NAME` | Node display name |
| `TJ_EMOJI` | Node emoji |
| `TJ_PROVIDER` | `anthropic`, `openai`, `ollama`, `lmstudio`, `custom` |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `OLLAMA_BASE_URL` | Ollama URL (default: `http://localhost:11434`) |
| `JERRY_TAILSCALE_IP` | Jerry's Tailscale IP (Tom only) |
| `TOM_TAILSCALE_IP` | Tom's Tailscale IP (Jerry only) |
| `GATEWAY_PORT` | Gateway listen port (default: 3737) |
| `TS_AUTHKEY` | Tailscale auth key (Docker) |

---

## Config files created

```
~/.his-and-hers/
  tj.json                  ← main config (mode 0o600)
  peers/
    <peer-name>.json        ← one per peer (mode 0o600)
```

### tj.json structure

```json
{
  "version": "0.1.0",
  "role": "tom",
  "node": {
    "name": "Calcifer",
    "emoji": "🔥",
    "tailscale_ip": "100.x.y.z"
  },
  "gateway": {
    "bind": "127.0.0.1",
    "port": 3737,
    "token": "<64-char hex>"
  },
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "cost_routing": {
    "lightweight_model": "claude-haiku-3-5",
    "standard_model": "claude-sonnet-4-5",
    "heavy_route": "jerry"
  },
  "peer_nodes": ["jerry-home", "jerry-pi"]
}
```

---

## Re-running the wizard

The wizard is non-destructive by default — it reads existing config and only prompts for values that aren't set. To reconfigure a specific section:

```bash
tj onboard --reconfigure-provider    # change LLM provider/key
tj onboard --reconfigure-gateway     # change port or regenerate token
tj onboard --reconfigure-peer        # update peer IP or SSH key
```

To start completely fresh:

```bash
tj onboard --reset
# ⚠️  This deletes ~/.his-and-hers/tj.json and all peer configs
```

---

## What `tj onboard` doesn't do

- It doesn't install Node.js, Tailscale, or OpenClaw (check those first — see [Prerequisites](/guide/prerequisites))
- It doesn't pull Ollama models (do that separately with `ollama pull`)
- It doesn't configure your router for WOL (see [Wake-on-LAN](/guide/wol))
