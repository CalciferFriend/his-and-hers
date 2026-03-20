# Wake-on-LAN

Wake-on-LAN (WOL) lets H1 boot H2 remotely by sending a Magic Packet over the network. When H2 is sleeping or shut down, H1 wakes it, waits for the gateway to come online, then dispatches the task.

This is optional but highly recommended — it means H2 can stay off 23 hours a day and only run when needed.

---

## How it works

1. H1 checks if H2's gateway is reachable (HTTP GET to `http://h2-ip:3737/health`)
2. If unreachable: H1 sends a UDP Magic Packet to H2's MAC address
3. If H2 is on the same subnet: broadcast to `255.255.255.255:9`
4. If H2 is on a different subnet (typical): the packet goes via router port forward
5. H1 polls H2's Tailscale reachability every 2s, up to 60 attempts (2 minutes)
6. Once H2's gateway responds healthy, H1 dispatches the task

---

## Step 1 — Enable WOL in BIOS

Every board has a different BIOS name for WOL. Common paths:

| Manufacturer | BIOS Path |
|-------------|-----------|
| ASUS | AI Tweaker → APM Config → Power On By PCI-E |
| Gigabyte | Settings → Power → Wake on LAN |
| MSI | Settings → Advanced → Wake Up Event Setup |
| ASRock | Advanced → ACPI Configuration → PCIE Devices Power On |
| Generic | Power Management → Wake on LAN |

Set it to **Enabled**. Also check for "ErP Ready" — if enabled, it can block WOL.

After saving BIOS: shut down the machine (not restart) to confirm WOL stays active in S5 state.

---

## Step 2 — Enable WOL in Windows

```powershell
# Open Device Manager → Network Adapters → [your NIC] → Properties → Power Management tab
# Enable:
#   ☑ Allow this device to wake the computer
#   ☑ Only allow a magic packet to wake the computer

# Also: Advanced tab → Wake on Magic Packet → Enabled
#               Advanced tab → Wake on Pattern Match → Disabled (optional)
```

You can also do this via PowerShell:

```powershell
# Find your NIC
Get-NetAdapter | Where-Object { $_.Status -eq "Up" }

# Get the PnP device ID for Device Manager
Get-PnpDevice | Where-Object { $_.Class -eq "Net" } | Select FriendlyName, DeviceID
```

---

## Step 3 — Enable WOL on Linux

```bash
# Check current WOL status
sudo ethtool eth0 | grep Wake-on
# d = disabled, g = magic packet, u = unicast

# Enable temporarily
sudo ethtool -s eth0 wol g

# Make it permanent (Ubuntu/Debian with NetworkManager)
# Create /etc/NetworkManager/dispatcher.d/99-wol
sudo tee /etc/NetworkManager/dispatcher.d/99-wol << 'EOF'
#!/bin/bash
if [ "$1" = "eth0" ] && [ "$2" = "up" ]; then
    ethtool -s eth0 wol g
fi
EOF
sudo chmod +x /etc/NetworkManager/dispatcher.d/99-wol

# Or via systemd service
sudo tee /etc/systemd/system/wol.service << 'EOF'
[Unit]
Description=Wake-on-LAN for eth0
After=network.target

[Service]
Type=oneshot
ExecStart=/sbin/ethtool -s eth0 wol g
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now wol.service
```

Replace `eth0` with your actual interface name (`ip link` to list them).

---

## Step 4 — Find H2's MAC address

```powershell
# Windows
Get-NetAdapter | Where-Object { $_.Status -eq "Up" } | Select Name, MacAddress
# → Ethernet   D8-5E-D3-04-18-B4
```

```bash
# Linux
ip link show eth0 | grep ether
# → ether d8:5e:d3:04:18:b4

# macOS
ifconfig en0 | grep ether
```

Note the MAC address. It looks like `D8:5E:D3:04:18:B4` (6 hex pairs).

---

## Step 5 — Configure your router

If H1 and H2 are on the **same subnet** (e.g. both on `192.168.1.x`): no router config needed. H1 can broadcast directly.

If H1 is on a **different subnet or network** (e.g. H1 is a cloud VM, or they're on different VLANs):

1. Give H2 a **static DHCP lease** based on MAC address (in your router admin panel)
2. Set up a **UDP port 9 forward** to H2's static IP

In most consumer routers:
- Find "Port Forwarding" or "Virtual Servers"
- Add rule: Protocol=UDP, External Port=9, Internal IP=H2's IP, Internal Port=9

### Alternative: directed broadcast

Some routers allow directed broadcasts (e.g. `192.168.1.255`). If yours does:

```json
{
  "wol": {
    "broadcast_ip": "192.168.1.255",
    "mac": "D8:5E:D3:04:18:B4",
    "port": 9
  }
}
```

---

## Step 6 — Tell H1 about WOL

During `cofounder onboard`, you'll be prompted for:
- H2's MAC address
- Broadcast IP or router IP
- WOL port (default 9)

Or update manually in `~/.cofounder/peers/h2-home.json`:

```json
{
  "name": "h2-home",
  "tailscale_ip": "100.x.y.z",
  "wol": {
    "enabled": true,
    "mac": "D8:5E:D3:04:18:B4",
    "broadcast_ip": "YOUR_ROUTER_IP",
    "port": 9
  }
}
```

---

## Test WOL

From H1's machine, with H2 off:

```bash
# Send Magic Packet and wait for gateway
cofounder wake --wait

# Watch what happens
cofounder wake --wait --verbose
# → Sending magic packet to D8:5E:D3:04:18:B4 via 192.168.1.1:9
# → Polling H2 gateway... (attempt 1/60)
# → Polling H2 gateway... (attempt 8/60)
# → H2 gateway healthy. Boot took 42s.
```

---

## WOL with `cofounder send`

WOL is transparent when sending tasks. If H2 is asleep, H1 wakes it automatically:

```bash
cofounder send "run the test suite"
# → H2 is offline — sending magic packet
# → Waiting for H2 to wake (up to 120s)...
# → H2 online — dispatching task
```

To skip WOL and fail fast if H2 is offline:

```bash
cofounder send "quick task" --no-wol
# → H2 unreachable and --no-wol set — aborting
```

---

## Troubleshooting

**H2 doesn't wake**

1. Confirm WOL is enabled in BIOS (re-enter and check)
2. Confirm the NIC power management settings are correct
3. Test with a standalone WOL tool first: [wakeonlan](https://github.com/jpoliv/wakeonlan) on Linux/macOS
4. Check that your router is forwarding UDP port 9
5. Make sure H2 was properly **shut down** (not restarted) after enabling BIOS WOL — some boards only enable WOL after a full power cycle

```bash
# Test from H1 with wakeonlan tool (Linux/macOS)
brew install wakeonlan   # macOS
# or: sudo apt install wakeonlan

wakeonlan -i JERRY_BROADCAST_IP D8:5E:D3:04:18:B4
```

**Tailscale up but gateway not ready**

H2's OS is awake but the gateway hasn't started yet. Increase the `wol_timeout_seconds` in H1's config (default: 120).

**WOL works once but not on subsequent boots**

Some NICs reset WOL settings on restart. Make the ethtool change permanent (see Step 3) or use the registry fix on Windows.
