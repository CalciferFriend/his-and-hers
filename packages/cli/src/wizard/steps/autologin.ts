import * as p from "@clack/prompts";
import pc from "picocolors";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sshExec } from "@his-and-hers/core";
import { isCancelled, type WizardContext } from "../context.ts";

const execFileAsync = promisify(execFile);

const REGISTRY_PATH = String.raw`HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon`;

/**
 * Run an elevated PowerShell script on the local machine.
 * Falls back gracefully if we're already elevated or UAC is unavailable.
 */
async function runElevatedPS(script: string, timeoutMs = 30_000): Promise<{ ok: boolean; error?: string }> {
  // Try running directly first (we may already be elevated or in a headless session)
  try {
    await execFileAsync("powershell", ["-NoProfile", "-Command", script], { timeout: timeoutMs });
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // If it's an access-denied error, try runas elevation
    if (msg.includes("Access") || msg.includes("privilege") || msg.includes("Unauthorized")) {
      try {
        // Write script to a temp file and launch via Start-Process with -Verb RunAs
        const tmpScript = `$env:TEMP\\hh-autologin-${Date.now()}.ps1`;
        await execFileAsync("powershell", [
          "-NoProfile", "-Command",
          `Set-Content -Path '${tmpScript}' -Value @'\n${script}\n'@; Start-Process powershell -ArgumentList '-NoProfile -File ${tmpScript}' -Verb RunAs -Wait`,
        ], { timeout: timeoutMs });
        return { ok: true };
      } catch (err2: unknown) {
        return { ok: false, error: err2 instanceof Error ? err2.message : String(err2) };
      }
    }
    return { ok: false, error: msg };
  }
}

/** Read current AutoAdminLogon state from registry */
async function readAutoLoginState(): Promise<{ configured: boolean; username?: string }> {
  try {
    const { stdout } = await execFileAsync("powershell", [
      "-NoProfile", "-Command",
      `$r = Get-ItemProperty -Path '${REGISTRY_PATH}' -ErrorAction SilentlyContinue; ` +
      `[PSCustomObject]@{ Enabled = $r.AutoAdminLogon; User = $r.DefaultUserName } | ConvertTo-Json`,
    ], { timeout: 5_000 });
    const val = JSON.parse(stdout.trim());
    return { configured: val?.Enabled === "1", username: val?.User };
  } catch {
    return { configured: false };
  }
}

/** Write AutoAdminLogon registry values */
async function writeAutoLoginRegistry(username: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const script = [
    `Set-ItemProperty -Path '${REGISTRY_PATH}' -Name AutoAdminLogon -Value '1' -Type String -Force`,
    `Set-ItemProperty -Path '${REGISTRY_PATH}' -Name DefaultUserName -Value '${username.replace(/'/g, "''")}' -Type String -Force`,
    `Set-ItemProperty -Path '${REGISTRY_PATH}' -Name DefaultPassword -Value '${password.replace(/'/g, "''")}' -Type String -Force`,
    // DefaultDomainName prevents logon loops on domain-joined machines
    `$domain = (Get-WmiObject Win32_ComputerSystem).Domain; if ($domain -and $domain -ne 'WORKGROUP') { Set-ItemProperty -Path '${REGISTRY_PATH}' -Name DefaultDomainName -Value $domain -Type String -Force }`,
  ].join("; ");
  return runElevatedPS(script);
}

/** Write AutoAdminLogon via SSH to a remote Windows H2 */
async function writeAutoLoginRemote(
  sshCreds: { host: string; user: string; keyPath: string },
  username: string,
  password: string,
): Promise<void> {
  const script = [
    `$p = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon'`,
    `Set-ItemProperty -Path $p -Name AutoAdminLogon -Value '1' -Type String -Force`,
    `Set-ItemProperty -Path $p -Name DefaultUserName -Value '${username.replace(/'/g, "''")}' -Type String -Force`,
    `Set-ItemProperty -Path $p -Name DefaultPassword -Value '${password.replace(/'/g, "''")}' -Type String -Force`,
  ].join("; ");
  await sshExec(sshCreds, `powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, 15_000);
}

export async function stepAutologin(ctx: Partial<WizardContext>): Promise<Partial<WizardContext>> {
  const isLocalJerry = ctx.role === "h2" && process.platform === "win32";
  const isRemoteJerry = ctx.role === "h1" && ctx.peerOS === "windows";
  const jerryIsWindows = isLocalJerry || isRemoteJerry;

  if (!jerryIsWindows) {
    return { ...ctx, windowsAutologinConfigured: false };
  }

  if (!ctx.wolEnabled) {
    p.log.info("WOL is disabled — AutoAdminLogon is not required.");
    return { ...ctx, windowsAutologinConfigured: false };
  }

  p.log.info(
    pc.bold("Windows AutoLogin required for Wake-on-LAN") + "\n" +
    "After WOL boots the machine it will sit at the lock screen unless\n" +
    "AutoAdminLogon is enabled. The gateway will never start without this.",
  );

  // Show security notice
  p.note(
    `AutoAdminLogon stores your Windows password in the registry in plain text.\n` +
    `${pc.yellow("→ Enable BitLocker or FileVault-equivalent full-disk encryption.")}`,
    "Security Note",
  );

  // Check current state (local only)
  if (isLocalJerry) {
    const current = await readAutoLoginState();
    if (current.configured) {
      p.log.info(pc.green("✓") + ` AutoAdminLogon already configured (user: ${current.username ?? "unknown"})`);
      const keep = await p.confirm({ message: "Keep existing AutoLogin settings?", initialValue: true });
      if (!isCancelled(keep) && keep) {
        return { ...ctx, windowsAutologinConfigured: true };
      }
    }
  }

  const proceed = await p.confirm({
    message: isLocalJerry
      ? "Configure AutoAdminLogon on this machine now?"
      : "Configure AutoAdminLogon on the H2 machine via SSH?",
    initialValue: true,
  });
  if (isCancelled(proceed)) { p.cancel("Setup cancelled."); process.exit(0); }

  if (!proceed) {
    p.log.warn("Skipped — WOL boots may hang at the login screen.");
    return { ...ctx, windowsAutologinConfigured: false };
  }

  const creds = await p.group(
    {
      username: () => p.text({
        message: "Windows username",
        placeholder: process.env["USERNAME"] ?? "YourUsername",
        validate: (v) => { if (!v.trim()) return "Username is required"; },
      }),
      password: () => p.password({
        message: "Windows password (stored in registry — use disk encryption)",
        validate: (v) => { if (!v.trim()) return "Password is required"; },
      }),
    },
    { onCancel: () => { p.cancel("Setup cancelled."); process.exit(0); } },
  );

  const s = p.spinner();
  s.start("Writing AutoAdminLogon registry keys...");

  try {
    if (isLocalJerry) {
      const result = await writeAutoLoginRegistry(creds.username, creds.password);
      if (result.ok) {
        s.stop(pc.green("✓ AutoAdminLogon configured — this machine will auto-login after WOL boot"));
      } else {
        s.stop(pc.yellow("⚠ Could not write registry automatically"));
        p.log.warn("Run this in an elevated PowerShell:\n" + [
          `Set-ItemProperty -Path '${REGISTRY_PATH}' -Name AutoAdminLogon -Value '1' -Type String -Force`,
          `Set-ItemProperty -Path '${REGISTRY_PATH}' -Name DefaultUserName -Value '${creds.username}' -Type String -Force`,
          `Set-ItemProperty -Path '${REGISTRY_PATH}' -Name DefaultPassword -Value '<your-password>' -Type String -Force`,
        ].join("\n"));
        return { ...ctx, windowsAutologinConfigured: false };
      }
    } else if (isRemoteJerry && ctx.peerTailscaleIP && ctx.peerSSHUser && ctx.peerSSHKeyPath) {
      await writeAutoLoginRemote(
        { host: ctx.peerTailscaleIP, user: ctx.peerSSHUser, keyPath: ctx.peerSSHKeyPath },
        creds.username,
        creds.password,
      );
      s.stop(pc.green("✓ AutoAdminLogon configured on H2 via SSH"));
    }
  } catch (err: unknown) {
    s.stop(pc.yellow("⚠ AutoLogin setup failed — configure manually"));
    p.log.warn(err instanceof Error ? err.message : String(err));
    return { ...ctx, windowsAutologinConfigured: false };
  }

  return { ...ctx, windowsAutologinConfigured: true };
}
