# Install on Linux / macOS

Detailed setup guide for Tom (and Jerry) on Linux or macOS. If you just want the 5-minute version, see [Quickstart](/guide/quickstart).

---

## 1 — Install Node.js 22+

Use `nvm` (recommended — avoids permission issues with global packages):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc   # or: source ~/.zshrc

nvm install 22
nvm use 22
nvm alias default 22

node --version     # v22.x.x
npm --version      # 10.x.x
```

Alternatively, use the NodeSource APT package (Ubuntu/Debian):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

---

## 2 — Install Tailscale

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

Authenticate:

```bash
sudo tailscale up --authkey tskey-auth-YOUR_KEY
# Or just: sudo tailscale up  (opens browser for login)
```

Verify:

```bash
tailscale ip -4
# → 100.x.y.z  (your Tailscale IP — note this down)

tailscale status
# Should show other nodes in your network
```

---

## 3 — Install OpenClaw

```bash
npm install -g openclaw
openclaw --version
```

Start the gateway:

```bash
openclaw gateway start
openclaw gateway status
```

---

## 4 — Install his-and-hers

```bash
npm install -g his-and-hers
tj --version
```

---

## 5 — Run the setup wizard

```bash
tj onboard
```

The wizard will ask:

1. **Role** — Tom (orchestrator) or Jerry (executor). See [Roles](/guide/roles).
2. **Name + emoji** — e.g. `Calcifer 🔥`
3. **LLM provider** — cloud API key or local Ollama
4. **Peer connection** — Tailscale IP, SSH user, key path
5. **Wake-on-LAN** — Jerry's MAC address (optional, Jerry only)
6. **Gateway binding** — loopback for Tom, Tailscale IP for Jerry

### What the wizard creates

```
~/.his-and-hers/
  tj.json                 ← main config (0o600 permissions)
  peers/
    jerry-home.json       ← one file per peer
  tasks/                  ← task state (created on first send)
  context/                ← conversation context per peer
  capabilities.json       ← this node's capabilities (Jerry)
  peer-capabilities.json  ← cached peer capabilities (Tom)
```

---

## 6 — Autostart (Tom on Linux)

Create a systemd service so the gateway restarts on boot:

```bash
sudo tee /etc/systemd/system/tj-gateway.service << 'EOF'
[Unit]
Description=his-and-hers gateway (OpenClaw)
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
Type=simple
User=YOUR_USERNAME
Environment=HOME=/home/YOUR_USERNAME
ExecStart=/home/YOUR_USERNAME/.nvm/versions/node/v22.14.0/bin/openclaw gateway start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now tj-gateway
sudo systemctl status tj-gateway
```

Replace `YOUR_USERNAME` and the Node path (`which openclaw` to find the right path).

### Autostart — macOS (launchd)

```bash
cat > ~/Library/LaunchAgents/com.his-and-hers.gateway.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.his-and-hers.gateway</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/openclaw</string>
    <string>gateway</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/tj-gateway.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/tj-gateway.err</string>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.his-and-hers.gateway.plist
launchctl list | grep his-and-hers
```

---

## 7 — Verify the connection

```bash
tj status
```

Expected output:

```
his-and-hers v0.5.2

Tom  ✓ gateway healthy   127.0.0.1:3737
     ✓ Tailscale up      100.x.y.z

Jerry (jerry-home)
     ✓ Tailscale reachable  100.a.b.c
     ✓ gateway healthy      100.a.b.c:3737
     ✓ last heartbeat       12s ago
     ✓ WOL configured       D8:5E:D3:04:18:B4

Budget (today): $0.00 cloud / $0.00 local
```

If anything shows ✗, run `tj doctor` for a detailed diagnosis.

---

## 8 — Send your first task

```bash
tj send "what is the Tailscale IP of this node?"
```

Watch the task live:

```bash
tj logs --follow
```

---

## Ollama setup (Jerry on Linux)

If Jerry is on Linux with a GPU:

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# NVIDIA GPU: verify CUDA is working
nvidia-smi                    # should show your GPU
ollama run llama3.2 --verbose # look for "using CUDA"

# AMD GPU: ROCm
# Ollama auto-detects via rocm-smi

# Pull recommended starter models
ollama pull llama3.2          # 3B, fast
ollama pull mistral            # 7B, best quality/speed
ollama pull nomic-embed-text   # embeddings
```

Then run `tj capabilities advertise` to register your GPU and models with Tom.

---

## Troubleshooting

**`openclaw: command not found`**
Check npm global bin is in PATH: `npm config get prefix` → add `<prefix>/bin` to `$PATH`.

**Tailscale not connecting**
Run `sudo tailscale up` and re-authenticate if the key expired.

**SSH permission denied**
Verify your public key is in Jerry's `~/.ssh/authorized_keys`. Check permissions: `chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys`.

**Gateway not starting**
Check logs: `journalctl -u tj-gateway -f` (Linux) or `cat /tmp/tj-gateway.err` (macOS).
