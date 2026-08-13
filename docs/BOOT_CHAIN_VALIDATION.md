# Boot Chain Validation (Windows/H2)

This document describes the end-to-end validation procedure for the Windows boot chain setup created by `cofounder onboard`.

## Phase 2b Completion Checklist

**Goal:** Verify that a cold Windows boot automatically brings the H2 node online and ready to receive tasks.

### Prerequisites

- Onboard wizard completed successfully
- AutoLogin configured (via registry)
- Startup script created: `start-cofounder.bat`
- Scheduled Task installed: `CofounderAutoStart`
- Firewall rule configured for gateway port
- WOL configured in BIOS/NIC settings

### Test Procedure

#### 1. Cold Boot Test

```powershell
# From H1 (Linux), initiate clean shutdown of H2
cofounder send glados --command "shutdown /s /f /t 10"

# Wait 30 seconds for full shutdown
sleep 30

# Wake H2 via WOL (should be ~10-20s)
~/wake-glados.sh --wait

# Give boot + auto-login + startup time
sleep 60

# Test connectivity
cofounder doctor --peer glados

# Expected: All checks pass (Tailscale, SSH, gateway, capabilities)
```

#### 2. Component Verification

From H2 Windows shell:

```powershell
# Verify scheduled task exists and is enabled
schtasks /query /tn "CofounderAutoStart" /v

# Check gateway is running
cofounder gateway status

# Verify capabilities are being served
curl http://localhost:18789/capabilities

# Check trace for boot timing
cofounder trace list
```

#### 3. Trace Analysis

```bash
# From H1, send test task and analyze trace
cofounder send glados "run cofounder status" --wait
cofounder trace <task_id>

# Expected timeline:
# - Tailscale ping: <50ms
# - Gateway health: <100ms
# - WS connect: <200ms
# - Task execution: varies
# - Total: <2s (if already booted)
```

#### 4. Failure Recovery Test

```powershell
# From H2, manually kill gateway
taskkill /F /IM node.exe

# Wait for scheduled task to restart (or manually trigger)
schtasks /run /tn "CofounderAutoStart"

# Verify auto-recovery
cofounder gateway status
```

### Success Criteria

- ✅ Cold boot → auto-login completes within 60s
- ✅ `start-cofounder.bat` executes automatically
- ✅ Gateway binds and listens within 10s of login
- ✅ Capabilities endpoint responds within 20s total
- ✅ H1 can reach H2 via `cofounder doctor --peer glados`
- ✅ H1 can send tasks successfully via `cofounder send glados`
- ✅ Trace shows full pipeline timing

### Troubleshooting

**Gateway not starting:**
- Check Event Viewer → Windows Logs → Application for errors
- Verify `start-cofounder.bat` path in scheduled task
- Check firewall rule: `netsh advfirewall firewall show rule name="CofounderGateway"`

**Auto-login not working:**
- Verify registry: `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon`
- Check `AutoAdminLogon=1`, `DefaultUserName`, `DefaultPassword` set

**WOL not waking:**
- BIOS: Verify "Wake on LAN" enabled
- NIC: `devmgmt.msc` → Network adapters → Properties → Power Management
  - ✅ "Allow this device to wake the computer"
  - ✅ "Only allow magic packet to wake"
- Router: Ensure port 9 forwards to 192.168.50.255 (broadcast)

### Logging the Results

After completing validation, document results in:
- `ROADMAP.md` — Mark Phase 2b boot chain task complete
- Daily memory log — Note any issues encountered and resolutions
- If failures occurred → `.learnings/ERRORS.md`

### Next Phase

Once boot chain validation passes, Phase 2 is complete and we move to Phase 3 (collaborative workflows).
