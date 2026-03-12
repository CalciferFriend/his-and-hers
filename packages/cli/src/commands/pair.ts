import * as p from "@clack/prompts";
import pc from "picocolors";
import { verifyPairingCode, pingPeer, testSSH, checkGatewayHealth } from "@his-and-hers/core";
import { loadConfig, saveConfig } from "../config/store.ts";

export async function pair(options: { code: string }) {
  p.intro(pc.bgCyan(pc.black(" his-and-hers pair ")));

  const code = options.code.trim();
  if (!/^\d{6}$/.test(code)) {
    p.log.error("Pairing code must be exactly 6 digits.");
    process.exit(1);
  }

  const config = await loadConfig();
  if (!config) {
    p.log.error("No configuration found on this machine. Run `hh onboard` first.");
    process.exit(1);
  }

  // Verify pairing code against stored hash
  if (!config.pair?.pairing_code_hash) {
    p.log.error("No pairing code hash found in config. Run `hh onboard` on the H1 node first.");
    process.exit(1);
  }

  const spinner = p.spinner();
  spinner.start("Verifying pairing code...");

  const valid = verifyPairingCode(code, config.pair.pairing_code_hash);

  if (!valid) {
    spinner.stop(`${pc.red("✗")} Invalid pairing code.`);
    p.log.error("The code does not match. Get a fresh code from the H1 node by running `hh onboard`.");
    process.exit(1);
  }

  spinner.stop(`${pc.green("✓")} Pairing code verified.`);

  // Run connectivity checks
  const peerIP = config.peer_node.tailscale_ip;
  const gwPort = config.peer_node.gateway?.port ?? 18789;

  const checks = [
    {
      name: "Tailscale ping",
      fn: () => pingPeer(peerIP),
    },
    {
      name: "SSH connection",
      fn: () => testSSH({
        host: peerIP,
        user: config.peer_node.ssh_user,
        keyPath: config.peer_node.ssh_key_path,
      }),
    },
    {
      name: "Gateway health",
      fn: () => checkGatewayHealth(`http://${peerIP}:${gwPort}/health`),
    },
  ];

  let allPassed = true;
  for (const check of checks) {
    const s = p.spinner();
    s.start(`Checking: ${check.name}...`);
    const ok = await check.fn();
    if (ok) {
      s.stop(`${pc.green("✓")} ${check.name}`);
    } else {
      s.stop(`${pc.red("✗")} ${check.name}`);
      allPassed = false;
    }
  }

  // Update pair state
  config.pair.trusted = allPassed;
  config.pair.last_handshake = new Date().toISOString();

  await saveConfig(config);

  if (allPassed) {
    p.log.success("Pairing verified — both nodes are connected and healthy.");
  } else {
    p.log.warn("Pairing saved but some connectivity checks failed. Run `hh doctor` for diagnostics.");
  }

  p.note(
    [
      `This node:  ${config.this_node.emoji ?? ""} ${config.this_node.name} (${config.this_node.role})`,
      `Peer node:  ${config.peer_node.tailscale_hostname} (${config.peer_node.role})`,
      `Trusted:    ${config.pair.trusted ? pc.green("yes") : pc.yellow("no")}`,
      `Paired at:  ${config.pair.established_at}`,
    ].join("\n"),
    "Pair Status"
  );

  p.outro("Pairing complete.");
}
