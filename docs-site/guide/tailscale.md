# Tailscale Setup

Tailscale is the network layer that connects H1 and H2. All communication between them flows over an encrypted WireGuard tunnel — no port forwarding, no VPN config, no firewall punching.

---

## Why Tailscale

- **Zero config networking** — H1 and H2 just work once they're on the same Tailscale network
- **WireGuard encryption** — all traffic is encrypted point-to-point
- **NAT traversal** — works even if both machines are behind NAT
- **Stable IPs** — each device gets a stable `100.x.y.z` IP that doesn't change
- **Free for personal use** — up to 3 machines on the free plan; 100+ on Plus

---

## Install Tailscale

### macOS / Linux

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

### Windows

```powershell
winget install tailscale.tailscale
```

Or download from [tailscale.com/download](https://tailscale.com/download).

---

## Authenticate both machines

On each machine, connect to your Tailscale account:

```bash
# Interactive (opens browser)
sudo tailscale up

# Headless (CI/cloud/server)
sudo tailscale up --authkey tskey-auth-YOUR_KEY
```

Generate auth keys at [login.tailscale.com/admin/settings/keys](https://login.tailscale.com/admin/settings/keys). Use reusable keys if you're setting up multiple machines.

---

## Verify both machines can see each other

```bash
# On H1:
tailscale status
# → Should list H2's machine name and IP

# Get H1's IP (give this to H2 during onboarding)
tailscale ip -4
# → 100.x.y.z

# Ping H2
tailscale ping h2-machine-name
# → pong from h2 (100.a.b.c) via DERP(nyc) in 15ms
```

If both machines are online and authenticated to the same account, they'll appear in `tailscale status` within seconds.

---

## Pairing H1 and H2

Once both machines are on the same Tailscale network, give H1 H2's IP during `hh onboard`:

```bash
# On H2's machine:
tailscale ip -4
# → 100.a.b.c  ← give this to H1

# On H1's machine:
hh onboard
# → Enter H2's Tailscale IP: 100.a.b.c
```

his-and-hers uses the Tailscale IP directly for:
- Gateway API calls (HTTP to `100.a.b.c:3737`)
- SSH config push
- WOL reachability check

---

## Separate Tailscale accounts (sharing)

If H1 and H2 are on different Tailscale accounts (e.g. different households or users), use Tailscale's [node sharing](https://tailscale.com/kb/1084/sharing):

1. On H2's admin panel: Share → enter H1's Tailscale email
2. H1 accepts the share
3. H2's machine appears in H1's `tailscale status`

The `100.x.y.z` IP works the same way regardless.

---

## Static Tailscale IPs

Tailscale IPs are stable — they don't change as long as the device is registered to your account. No need to update H1's config if H2 reboots or changes networks.

To see all assigned IPs in your account: [login.tailscale.com/admin/machines](https://login.tailscale.com/admin/machines)

---

## Tailscale on servers (Linux systemd)

For always-on H1 nodes (cloud VMs, home servers):

```bash
# Enable and start tailscaled
sudo systemctl enable --now tailscaled

# Auth with an auth key
sudo tailscale up --authkey tskey-auth-... --hostname tom-node

# Verify it starts on boot
sudo reboot
tailscale status  # should show up within 30s
```

---

## Tailscale on Windows at boot

For H2 nodes that need to be reachable after a WOL boot:

1. Open Task Manager → Startup tab → verify Tailscale is enabled
2. Or in System Settings → Apps → Startup
3. Tailscale should be in your system tray and auto-connect on login

H1's startup script (`start-gateway.bat`) already waits for Tailscale before starting the gateway:

```bat
:wait_ts
tailscale status >nul 2>&1
if %errorlevel% neq 0 (
    timeout /t 5 /nobreak >nul
    goto wait_ts
)
```

---

## Troubleshooting

**Machines don't see each other in `tailscale status`**

- Both must be authenticated to the same account (or sharing must be enabled)
- Check: `tailscale login` if re-auth is needed
- Check firewall isn't blocking Tailscale: it uses UDP 41641 for peer traffic, plus DERP relays over TCP 443

**Tailscale ping works but gateway is unreachable**

Tailscale is up but the OpenClaw gateway isn't running on H2. Check:

```bash
# On H2:
openclaw gateway status
hh status
```

**High latency / DERP relay**

If `tailscale ping` shows `via DERP` instead of direct, the two machines can't establish a direct P2P connection. This is usually caused by restrictive NAT. Performance still works, just slightly slower.

Try enabling `--accept-routes` or check if your router supports hairpin NAT.

**Tailscale IP changed**

It shouldn't change, but if it does (device re-registered):

```bash
# Get new IP on H2
tailscale ip -4

# Update H1's peer config
# Edit ~/.his-and-hers/peers/h2-home.json → tailscale_ip field
# Then test: hh status
```
