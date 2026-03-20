import * as p from "@clack/prompts";
import pc from "picocolors";
import { generatePairingCode, hashPairingCode } from "@cofounder/core";
import { saveConfig, getConfigPath } from "../../config/store.ts";
import type { HHConfig } from "../../config/schema.ts";
import type { WizardContext } from "../context.ts";

export async function stepFinalize(ctx: Partial<WizardContext>): Promise<Partial<WizardContext>> {
  const spinner = p.spinner();
  spinner.start("Writing configuration...");

  // Generate pairing code
  const pairingCode = generatePairingCode();
  const pairingCodeHash = hashPairingCode(pairingCode);

  const peerRole = ctx.role === "h1" ? "h2" : "h1";

  const config: HHConfig = {
    version: "0.1.0",
    gateway_port: 18789,
    this_node: {
      role: ctx.role!,
      name: ctx.name!,
      emoji: ctx.emoji,
      persona: ctx.persona,
      tailscale_hostname: ctx.tailscaleHostname!,
      tailscale_ip: ctx.tailscaleIP!,
    },
    peer_node: {
      role: peerRole,
      name: ctx.peerTailscaleHostname!,
      emoji: undefined,
      tailscale_hostname: ctx.peerTailscaleHostname!,
      tailscale_ip: ctx.peerTailscaleIP!,
      ssh_user: ctx.peerSSHUser!,
      ssh_key_path: ctx.peerSSHKeyPath!,
      os: ctx.peerOS ?? "linux",
      windows_autologin_configured: ctx.windowsAutologinConfigured,
      wol: ctx.wolEnabled
        ? {
            enabled: true,
            mac: ctx.wolMAC,
            broadcast_ip: ctx.wolBroadcastIP,
            router_port: ctx.wolRouterPort ?? 9,
            wait_timeout_seconds: ctx.wolTimeoutSeconds ?? 120,
            poll_interval_seconds: ctx.wolPollIntervalSeconds ?? 2,
            health_endpoint: `http://${ctx.peerTailscaleIP}:${ctx.peerGatewayPort ?? 18789}/health`,
          }
        : { enabled: false, router_port: 9, wait_timeout_seconds: 120, poll_interval_seconds: 2 },
      gateway_port: ctx.peerGatewayPort ?? 18789,
      gateway: {
        port: ctx.peerGatewayPort ?? 18789,
        bind: ctx.peerBindMode ?? "tailscale",
      },
    },
    pair: {
      established_at: new Date().toISOString(),
      pairing_code_hash: pairingCodeHash,
      trusted: ctx.validationPassed ?? false,
    },
    protocol: {
      heartbeat_interval_seconds: 60,
      handoff_done_signal: "DONE",
      message_format: "json",
    },
  };

  try {
    await saveConfig(config);
    spinner.stop(`${pc.green("✓")} Config written to ${getConfigPath()}`);
  } catch (err) {
    spinner.stop(`${pc.red("✗")} Failed to write config.`);
    p.log.error(String(err));
    return { ...ctx, configWritten: false };
  }

  // Print summary
  const emoji = ctx.emoji ?? (ctx.role === "h1" ? "🐱" : "🐭");
  const peerEmoji = ctx.role === "h1" ? "🐭" : "🐱";

  p.note(
    [
      `${emoji} ${pc.bold(ctx.name!)} (${ctx.role}) — ${ctx.tailscaleHostname} (${ctx.tailscaleIP})`,
      `${peerEmoji} ${pc.bold(ctx.peerTailscaleHostname!)} (${peerRole}) — ${ctx.peerTailscaleHostname} (${ctx.peerTailscaleIP})`,
      ``,
      `WOL:         ${ctx.wolEnabled ? `enabled (MAC: ${ctx.wolMAC})` : "disabled"}`,
      `Gateway:     ${ctx.thisBindMode} (this) / ${ctx.peerBindMode} (peer) on port ${ctx.peerGatewayPort ?? 18789}`,
      `AutoLogin:   ${ctx.windowsAutologinConfigured ? "configured" : "n/a"}`,
      `Startup:     ${ctx.startupScriptInstalled ? "installed" : "not installed"}`,
      `Templates:   ${ctx.soulTemplateCopied ? "installed" : "skipped"}`,
      `Validation:  ${ctx.validationPassed ? pc.green("passed") : pc.yellow("incomplete")}`,
      `Provider:    ${ctx.provider} ${ctx.apiKeyStored ? "(key stored)" : ""}`,
      ``,
      `Config:      ${getConfigPath()}`,
    ].join("\n"),
    "Setup Complete"
  );

  // Show pairing code prominently
  p.note(
    `Share this code with the peer machine to complete pairing:\n\n` +
    `  ${pc.bold(pc.cyan(pairingCode))}\n\n` +
    `On the peer machine, run:\n` +
    `  ${pc.cyan(`cofounder pair --code ${pairingCode}`)}`,
    "Pairing Code"
  );

  return {
    ...ctx,
    pairingCode,
    pairingCodeHash,
    configWritten: true,
  };
}
