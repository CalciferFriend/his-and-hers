/**
 * wizard/steps/firewall.ts — Windows Firewall rule for H2 gateway port
 *
 * Only runs when:
 *   - the wizard is installing on a Windows H2 node (role === "h2", platform === win32), OR
 *   - H1 is doing remote setup via SSH on a Windows H2
 *
 * Creates an inbound TCP allow rule named "HH-Gateway" on the configured
 * gateway port (default: 18790) so H1 can reach the capabilities server
 * and webhook endpoint.
 *
 * On failure (requires elevation), prints the manual netsh command.
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sshExec } from "@his-and-hers/core";
import { isCancelled, type WizardContext } from "../context.ts";

const execFileAsync = promisify(execFile);

const RULE_NAME = "HH-Gateway";

/** netsh command to add the inbound rule */
function buildNetshCmd(port: number): string {
  return (
    `netsh advfirewall firewall add rule ` +
    `name="${RULE_NAME}" ` +
    `dir=in ` +
    `action=allow ` +
    `protocol=TCP ` +
    `localport=${port} ` +
    `description="his-and-hers gateway: allows H1 to reach capabilities + webhook endpoints"`
  );
}

/** Check if the HH-Gateway rule already exists (local) */
async function ruleExists(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("netsh", [
      "advfirewall", "firewall", "show", "rule", `name=${RULE_NAME}`,
    ], { timeout: 5_000 });
    return stdout.includes(RULE_NAME);
  } catch {
    return false;
  }
}

/** Add the rule locally (may require elevation) */
async function addRuleLocal(port: number): Promise<{ ok: boolean; error?: string }> {
  const cmd = buildNetshCmd(port);
  const args = cmd.split(/\s+/);
  const exe = args.shift()!;
  try {
    await execFileAsync(exe, args, { timeout: 10_000 });
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Try via elevated PowerShell (UAC prompt)
    try {
      await execFileAsync("powershell", [
        "-NoProfile", "-Command",
        `Start-Process cmd -ArgumentList '/c ${cmd.replace(/"/g, '\\"')}' -Verb RunAs -Wait`,
      ], { timeout: 30_000 });
      return { ok: true };
    } catch (err2: unknown) {
      return { ok: false, error: msg };
    }
  }
}

// ─── Main step ────────────────────────────────────────────────────────────────

export async function stepFirewall(ctx: Partial<WizardContext>): Promise<Partial<WizardContext>> {
  const isWindowsH2Local = ctx.role === "h2" && process.platform === "win32";
  const isRemoteWindowsH2 = ctx.role === "h1" && ctx.peerOS === "windows";

  if (!isWindowsH2Local && !isRemoteWindowsH2) {
    // Nothing to do on Linux/macOS — Tailscale handles routing, no host FW needed
    return { ...ctx, firewallRuleInstalled: false };
  }

  const gatewayPort: number =
    (ctx as { gatewayPort?: number }).gatewayPort ??
    18790;

  p.log.info(
    `Setting up Windows Firewall rule for gateway port ${pc.cyan(String(gatewayPort))}…`,
  );

  const s = p.spinner();

  // ── Case 1: Running ON H2 (local Windows) ─────────────────────────────────
  if (isWindowsH2Local) {
    const exists = await ruleExists();
    if (exists) {
      p.log.success(`Firewall rule "${RULE_NAME}" already exists — skipping.`);
      return { ...ctx, firewallRuleInstalled: true };
    }

    const addFw = await p.confirm({
      message: `Add Windows Firewall inbound rule for port ${pc.cyan(String(gatewayPort))}? (Recommended)`,
      initialValue: true,
    });
    if (isCancelled(addFw)) { p.cancel("Setup cancelled."); process.exit(0); }

    if (!addFw) {
      p.log.warn(
        `Skipped. H1 may not be able to reach the capabilities server.\n` +
        pc.dim(`  Manual command: ${buildNetshCmd(gatewayPort)}`),
      );
      return { ...ctx, firewallRuleInstalled: false };
    }

    s.start("Adding Windows Firewall rule (may trigger UAC)…");
    const result = await addRuleLocal(gatewayPort);
    if (result.ok) {
      s.stop(pc.green(`✓ Firewall rule "${RULE_NAME}" added for TCP port ${gatewayPort}`));
    } else {
      s.stop(pc.yellow("⚠ Could not add rule automatically"));
      p.log.warn(`Run this command manually as Administrator:\n  ${pc.dim(buildNetshCmd(gatewayPort))}`);
    }
    return { ...ctx, firewallRuleInstalled: result.ok };
  }

  // ── Case 2: H1 adding rule on remote H2 via SSH ───────────────────────────
  const addFw = await p.confirm({
    message: `Add Windows Firewall inbound rule on H2 for port ${pc.cyan(String(gatewayPort))}?`,
    initialValue: true,
  });
  if (isCancelled(addFw)) { p.cancel("Setup cancelled."); process.exit(0); }

  if (!addFw) {
    p.log.warn(
      `Skipped. Run this on H2 as Administrator:\n` +
      pc.dim(`  ${buildNetshCmd(gatewayPort)}`),
    );
    return { ...ctx, firewallRuleInstalled: false };
  }

  const sshConfig = {
    host: ctx.peerTailscaleIP!,
    user: ctx.peerSSHUser!,
    keyPath: ctx.peerSSHKeyPath!,
  };

  s.start(`Adding firewall rule on remote H2 (${ctx.peerTailscaleIP}) via SSH…`);
  try {
    // Run via PowerShell so we can use Start-Process for elevation if needed
    await sshExec(
      sshConfig,
      `powershell -NoProfile -Command "${buildNetshCmd(gatewayPort).replace(/"/g, '\\"')}"`,
      15_000,
    );
    s.stop(pc.green(`✓ Firewall rule added on H2 (port ${gatewayPort})`));
    return { ...ctx, firewallRuleInstalled: true };
  } catch (err: unknown) {
    s.stop(pc.yellow("⚠ Remote firewall setup failed"));
    p.log.warn(
      `Run this on H2 as Administrator:\n  ${pc.dim(buildNetshCmd(gatewayPort))}`,
    );
    p.log.warn(err instanceof Error ? err.message : String(err));
    return { ...ctx, firewallRuleInstalled: false };
  }
}
