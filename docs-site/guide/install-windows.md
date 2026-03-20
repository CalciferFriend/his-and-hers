# Install on Windows (H2)

Windows setup guide for H2 nodes. This covers the full automation stack: Ollama, OpenClaw gateway, AutoLogin, Startup Batch, Scheduled Task, Firewall, and Wake-on-LAN.

> **Run everything in an Administrator PowerShell** unless noted otherwise. The wizard needs elevated privileges for AutoLogin registry and Scheduled Task setup.

---

## 1 — Install prerequisites

```powershell
# Node.js 22 LTS
winget install OpenJS.NodeJS.LTS

# Tailscale
winget install tailscale.tailscale

# Verify
node --version    # v22.x.x
tailscale version
```

Restart your terminal after Node installs so `npm` is in PATH.

---

## 2 — Install Ollama

```powershell
winget install Ollama.Ollama
# Or download: https://ollama.com/download/OllamaSetup.exe
```

Ollama installs as a Windows service and auto-detects your NVIDIA GPU. Verify:

```powershell
# Open a new terminal after install
ollama list
ollama run llama3.2
# Should see: "loaded on CUDA" (with NVIDIA GPU) or "loaded on CPU"
```

Pull recommended starter models:

```powershell
ollama pull llama3.2          # 3B — fast, small VRAM
ollama pull mistral            # 7B — great quality
ollama pull nomic-embed-text   # embeddings
```

---

## 3 — Install OpenClaw + cofounder

```powershell
npm install -g openclaw
npm install -g cofounder

# Verify
openclaw --version
cofounder --version
```

---

## 4 — Install Tailscale + authenticate

Open Tailscale from the system tray and log in, or use the CLI:

```powershell
# With an auth key (headless):
tailscale up --authkey tskey-auth-YOUR_KEY

# Or interactive:
tailscale up
# Opens browser for login

# Get your Tailscale IP (give this to H1)
tailscale ip -4
# → 100.x.y.z
```

---

## 5 — Run the setup wizard

Open an **Administrator PowerShell** and run:

```powershell
cofounder onboard
```

When prompted:

1. **Role:** H2
2. **Name + emoji:** e.g. `GLaDOS 🤖`
3. **LLM provider:** Ollama (auto-detected if running)
4. **H1's Tailscale IP:** get this from H1's machine via `tailscale ip -4`
5. **AutoLogin:** the wizard will prompt for your Windows username and password to configure auto-login for headless WOL boot
6. **Startup script:** wizard creates `start-gateway.bat` and installs a Scheduled Task
7. **Firewall rule:** wizard opens the gateway port (default 3737)

### Manual fallback: AutoLogin registry

If the wizard can't write the registry (UAC issues), set it manually:

```powershell
# Run as Administrator
$username = $env:USERNAME
$password = "YOUR_PASSWORD"

Set-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" `
  -Name "AutoAdminLogon" -Value "1"
Set-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" `
  -Name "DefaultUsername" -Value $username
Set-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" `
  -Name "DefaultPassword" -Value $password
```

> ⚠️ This stores your password in plaintext in the registry. Only do this on a machine you physically control. For shared machines, consider a dedicated local account with a strong password used only for this purpose.

---

## 6 — Startup batch script

The wizard creates this at `%APPDATA%\cofounder\start-gateway.bat`. To create it manually:

```bat
@echo off
rem Wait for Tailscale to connect
:wait_ts
tailscale status >nul 2>&1
if %errorlevel% neq 0 (
    timeout /t 5 /nobreak >nul
    goto wait_ts
)

rem Start the OpenClaw gateway
start /B openclaw gateway start

rem Advertise capabilities to H1
timeout /t 10 /nobreak >nul
cofounder capabilities advertise
```

Save to `%APPDATA%\cofounder\start-gateway.bat`.

---

## 7 — Scheduled Task (auto-start on login)

```powershell
# Run as Administrator
$batPath = "$env:APPDATA\cofounder\start-gateway.bat"

$action = New-ScheduledTaskAction `
  -Execute "cmd.exe" `
  -Argument "/c `"$batPath`""

$trigger = New-ScheduledTaskTrigger -AtLogOn

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 0)  # no time limit

Register-ScheduledTask `
  -TaskName "HisAndHersGateway" `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -RunLevel Highest `
  -Force

# Verify it's registered
Get-ScheduledTask -TaskName "HisAndHersGateway"
```

---

## 8 — Windows Firewall rule

Allow inbound TCP on the gateway port (default 3737):

```powershell
# Run as Administrator
$port = 3737

New-NetFirewallRule `
  -DisplayName "His-and-Hers Gateway" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort $port `
  -Action Allow `
  -Profile Any

# Verify
Get-NetFirewallRule -DisplayName "His-and-Hers Gateway"
```

If you changed the gateway port during `cofounder onboard`, use that port number instead.

---

## 9 — Wake-on-LAN setup

WOL lets H1 boot your PC remotely. Three things must be configured:

### BIOS

1. Enter BIOS/UEFI (typically F2, F10, or Del on POST)
2. Find "Wake on LAN", "Power On By PCI-E", or similar
3. Enable it
4. Save and exit

Board-specific names:
- ASUS: `AI Tweaker → APM Config → Power On By PCI-E`
- Gigabyte: `Settings → Power → Wake on LAN`
- MSI: `Settings → Advanced → Wake Up Event Setup`

### NIC settings (Windows)

```powershell
# Find your network adapter name
Get-NetAdapter | Where-Object { $_.Status -eq "Up" }

# Open Device Manager → right-click your NIC → Properties → Power Management
# Enable:
#   ☑ Allow this device to wake the computer
#   ☑ Only allow a magic packet to wake the computer
```

Or via registry (replacing `{GUID}` with your NIC's GUID from Device Manager):

```powershell
# Get NIC GUID
Get-NetAdapter | Select Name, InterfaceGuid

# Enable WOL (value 0 = enabled)
Set-ItemProperty `
  "HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4D36E972-E325-11CE-BFC1-08002BE10318}\0001" `
  -Name "*WakeOnMagicPacket" -Value "Enabled"
```

### Find your MAC address

```powershell
Get-NetAdapter | Where-Object { $_.Status -eq "Up" } | Select Name, MacAddress
# → Name: Ethernet    MacAddress: D8-5E-D3-04-18-B4
```

Give this MAC to H1 during `cofounder onboard` or add it to config manually. See [Wake-on-LAN guide](/guide/wol) for router configuration.

---

## 10 — Verify

Reboot the machine. It should:
1. Auto-login to Windows
2. The Scheduled Task fires → `start-gateway.bat` runs
3. Tailscale connects
4. OpenClaw gateway starts
5. `cofounder capabilities advertise` runs

From H1's machine:

```bash
cofounder status
# H2 should appear with ✓ gateway healthy
```

---

## Troubleshooting

**Gateway not starting after reboot**

Check Windows Event Viewer → Windows Logs → Application for errors from `cmd.exe` or `openclaw`.

Also verify the Scheduled Task ran:
```powershell
Get-ScheduledTaskInfo -TaskName "HisAndHersGateway"
# Check LastRunTime and LastTaskResult (0 = success)
```

**Tailscale not connecting on boot**

Tailscale must be in startup apps. Open Task Manager → Startup apps → verify Tailscale is enabled.

**Ollama not using GPU**

```powershell
# Check driver version
nvidia-smi
# Must be >= 525.85

# Check Ollama logs
Get-Content "$env:LOCALAPPDATA\Ollama\logs\server.log" -Tail 50
```

**AutoLogin not working**

Check the registry values are correct:
```powershell
Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" |
  Select AutoAdminLogon, DefaultUsername
```
