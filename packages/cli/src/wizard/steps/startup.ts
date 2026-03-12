import * as p from "@clack/prompts";
import pc from "picocolors";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sshExec } from "@his-and-hers/core";
import { isCancelled, type WizardContext } from "../context.ts";

const execFileAsync = promisify(execFile);

const STARTUP_BAT = `@echo off
:: start-gateway.bat — Waits for Tailscale then starts OpenClaw gateway
:: Installed by hh onboard

echo [HH] Waiting for Tailscale to come online...
:wait_tailscale
tailscale status >nul 2>&1
if errorlevel 1 (
    timeout /t 2 /nobreak >nul
    goto wait_tailscale
)
echo [HH] Tailscale is online.

echo [HH] Starting OpenClaw gateway...
cd /d "%USERPROFILE%"
openclaw gateway
`;

const STARTUP_SH = `#!/usr/bin/env bash
# start-gateway.sh — Waits for Tailscale then starts OpenClaw gateway
# Installed by hh onboard

echo "[HH] Waiting for Tailscale to come online..."
until tailscale status &>/dev/null; do
    sleep 2
done
echo "[HH] Tailscale is online."

echo "[HH] Starting OpenClaw gateway..."
cd ~
exec openclaw gateway
`;

// ── Windows local helpers ──────────────────────────────────────────────────

async function getWindowsStartupDir(): Promise<string> {
  // Prefer APPDATA if set, fall back to execing PowerShell
  if (process.env["APPDATA"]) {
    return join(process.env["APPDATA"], "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
  }
  const { stdout } = await execFileAsync("powershell", [
    "-NoProfile", "-Command",
    "[Environment]::GetFolderPath('Startup')",
  ], { timeout: 5_000 });
  return stdout.trim();
}

async function installWindowsLocalStartup(): Promise<{ ok: boolean; batPath: string; error?: string }> {
  try {
    const startupDir = await getWindowsStartupDir();
    const batPath = join(startupDir, "start-gateway.bat");
    await writeFile(batPath, STARTUP_BAT, { encoding: "ascii" });

    // Scheduled Task as belt-and-suspenders (survives if Startup folder is skipped)
    await execFileAsync("schtasks", [
      "/Create",
      "/TN", "HH-OpenClawGateway",
      "/TR", batPath,
      "/SC", "ONLOGON",
      "/RL", "HIGHEST",
      "/F", // overwrite if exists
    ], { timeout: 10_000 }).catch(() => {
      // schtasks may fail if not elevated — not fatal, Startup folder covers us
    });

    // Verify the task was created
    const { stdout: taskCheck } = await execFileAsync("schtasks", [
      "/Query", "/TN", "HH-OpenClawGateway",
    ], { timeout: 5_000 }).catch(() => ({ stdout: "" }));

    return { ok: true, batPath, error: taskCheck.includes("HH-OpenClawGateway") ? undefined : "Scheduled Task not confirmed (Startup folder is still active)" };
  } catch (err: unknown) {
    return { ok: false, batPath: "", error: err instanceof Error ? err.message : String(err) };
  }
}

async function installLinuxLocalStartup(): Promise<{ ok: boolean; shPath: string }> {
  const shPath = join(process.env["HOME"] ?? "~", "start-gateway.sh");
  await writeFile(shPath, STARTUP_SH, { mode: 0o755 });
  // Add @reboot crontab entry
  await execFileAsync("bash", [
    "-c",
    `(crontab -l 2>/dev/null | grep -v start-gateway; echo "@reboot ${shPath}") | crontab -`,
  ], { timeout: 10_000 });
  return { ok: true, shPath };
}

// ── Main step ──────────────────────────────────────────────────────────────

export async function stepStartup(ctx: Partial<WizardContext>): Promise<Partial<WizardContext>> {
  // Only relevant for H2 role setup
  const isJerrySetup = ctx.role === "h2" || (ctx.role === "h1" && ctx.peerOS !== undefined);
  if (!isJerrySetup) return { ...ctx, startupScriptInstalled: false };

  const peerIsWindows = ctx.role === "h1" ? ctx.peerOS === "windows" : process.platform === "win32";
  const isLocal = ctx.role === "h2";

  const install = await p.confirm({
    message: isLocal
      ? "Install startup script on this machine (gateway auto-starts after boot)?"
      : "Install startup script on the remote H2 node via SSH?",
    initialValue: true,
  });
  if (isCancelled(install)) { p.cancel("Setup cancelled."); process.exit(0); }
  if (!install) {
    p.log.warn("Skipped — gateway won't start automatically after boot.");
    return { ...ctx, startupScriptInstalled: false };
  }

  const s = p.spinner();

  // ── Case 1: Running ON H2 (local Windows) ──────────────────────────────
  if (isLocal && process.platform === "win32") {
    s.start("Installing startup script + Scheduled Task...");
    const result = await installWindowsLocalStartup();
    if (result.ok) {
      s.stop(pc.green(`✓ Installed: ${result.batPath}`) + (result.error ? `\n  ${pc.yellow("ℹ")} ${result.error}` : ""));
    } else {
      s.stop(pc.yellow("⚠ Automated install failed — writing script to Desktop"));
      // Last resort: write to desktop so user can copy it manually
      const desktop = join(process.env["USERPROFILE"] ?? "", "Desktop", "start-gateway.bat");
      await writeFile(desktop, STARTUP_BAT, { encoding: "ascii" }).catch(() => {});
      p.log.warn(`Script written to: ${desktop}`);
      p.log.warn("Copy it to your Startup folder: shell:startup");
    }
    return { ...ctx, startupScriptInstalled: result.ok };
  }

  // ── Case 2: Running ON H2 (local Linux/macOS) ──────────────────────────
  if (isLocal && process.platform !== "win32") {
    s.start("Installing startup script + crontab...");
    try {
      const result = await installLinuxLocalStartup();
      s.stop(pc.green(`✓ Installed: ${result.shPath} (added to crontab @reboot)`));
      return { ...ctx, startupScriptInstalled: true };
    } catch (err) {
      s.stop(pc.yellow("⚠ Install failed"));
      p.log.warn(err instanceof Error ? err.message : String(err));
      return { ...ctx, startupScriptInstalled: false };
    }
  }

  // ── Case 3: H1 installing on remote H2 via SSH ────────────────────────
  const sshConfig = {
    host: ctx.peerTailscaleIP!,
    user: ctx.peerSSHUser!,
    keyPath: ctx.peerSSHKeyPath!,
  };

  s.start(`Installing startup script on remote H2 via SSH (${peerIsWindows ? "Windows" : "Linux"})...`);

  try {
    if (peerIsWindows) {
      // Write bat file to Windows Startup folder
      const psWriteCmd = [
        `$startup = [Environment]::GetFolderPath('Startup')`,
        `$bat = @'\n${STARTUP_BAT.replace(/'/g, "''")}\n'@`,
        `Set-Content -Path "$startup\\start-gateway.bat" -Value $bat -Encoding ASCII`,
      ].join("; ");
      await sshExec(sshConfig, `powershell -NoProfile -Command "${psWriteCmd.replace(/"/g, '\\"')}"`, 20_000);

      // Scheduled Task on remote
      await sshExec(
        sshConfig,
        `schtasks /Create /TN "HH-OpenClawGateway" /TR "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\start-gateway.bat" /SC ONLOGON /RL HIGHEST /F`,
        15_000,
      );
      s.stop(pc.green("✓ Startup script + Scheduled Task installed on Windows H2"));
    } else {
      // Write shell script + crontab on Linux/macOS H2
      await sshExec(
        sshConfig,
        `cat > ~/start-gateway.sh << 'TJEOF'\n${STARTUP_SH}\nTJEOF\nchmod +x ~/start-gateway.sh`,
        15_000,
      );
      await sshExec(
        sshConfig,
        `(crontab -l 2>/dev/null | grep -v start-gateway; echo "@reboot ~/start-gateway.sh") | crontab -`,
        15_000,
      );
      s.stop(pc.green("✓ Startup script + @reboot crontab installed on Linux/macOS H2"));
    }
    return { ...ctx, startupScriptInstalled: true };
  } catch (err) {
    s.stop(pc.yellow("⚠ Remote install failed"));
    p.log.warn("Install the startup script manually on the H2 machine.");
    p.log.warn(err instanceof Error ? err.message : String(err));
    return { ...ctx, startupScriptInstalled: false };
  }
}
