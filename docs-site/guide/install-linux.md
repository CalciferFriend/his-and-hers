# Install on Linux / macOS

Detailed setup guide for H1 (and H2) on Linux or macOS. If you just want the 5-minute version, see [Quickstart](/guide/quickstart).

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
hh --version
```

---

## 5 — Run the setup wizard

```bash
hh onboard
```

The wizard will ask:

1. **Role** — H1 (orchestrator) or H2 (executor). See [Roles](/guide/roles).
2. **Name + emoji** — e.g. `Calcifer 🔥`
3. **LLM provider** — cloud API key or local Ollama
4. **Peer connection** — Tailscale IP, SSH user, key path
5. **Wake-on-LAN** — H2's MAC address (optional, H2 only)
6. **Gateway binding** — loopback for H1, Tailscale IP for H2

### What the wizard creates

```
~/.his-and-hers/
  hh.json                 ← main config (0o600 permissions)
  peers/
    h2-home.json       ← one file per peer
  tasks/                  ← task state (created on first send)
  context/                ← conversation context per peer
  capabilities.json       ← this node's capabilities (H2)
  peer-capabilities.json  ← cached peer capabilities (H1)
```

---

## 6 — Autostart (H1 on Linux)

Create a systemd service so the gateway restarts on boot:

```bash
sudo tee /etc/systemd/system/hh-gateway.service << 'EOF'
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
sudo systemctl enable --now hh-gateway
sudo systemctl status hh-gateway
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
  <string>/tmp/hh-gateway.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/hh-gateway.err</string>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.his-and-hers.gateway.plist
launchctl list | grep his-and-hers
```

---

## 7 — Verify the connection

```bash
hh status
```

Expected output:

```
his-and-hers v0.5.2

H1  ✓ gateway healthy   127.0.0.1:3737
     ✓ Tailscale up      100.x.y.z

H2 (h2-home)
     ✓ Tailscale reachable  100.a.b.c
     ✓ gateway healthy      100.a.b.c:3737
     ✓ last heartbeat       12s ago
     ✓ WOL configured       D8:5E:D3:04:18:B4

Budget (today): $0.00 cloud / $0.00 local
```

If anything shows ✗, run `hh doctor` for a detailed diagnosis.

---

## 8 — Send your first task

```bash
hh send "what is the Tailscale IP of this node?"
```

Watch the task live:

```bash
hh logs --follow
```

---

## Ollama setup (H2 on Linux)

If H2 is on Linux with a GPU:

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

Then run `hh capabilities advertise` to register your GPU and models with H1.

---

## Troubleshooting

**`openclaw: command not found`**
Check npm global bin is in PATH: `npm config get prefix` → add `<prefix>/bin` to `$PATH`.

**Tailscale not connecting**
Run `sudo tailscale up` and re-authenticate if the key expired.

**SSH permission denied**
Verify your public key is in H2's `~/.ssh/authorized_keys`. Check permissions: `chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys`.

**Gateway not starting**
Check logs: `journalctl -u hh-gateway -f` (Linux) or `cat /tmp/hh-gateway.err` (macOS).
