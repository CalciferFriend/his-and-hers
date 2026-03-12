import * as p from "@clack/prompts";
import pc from "picocolors";
import { loadConfig } from "../config/store.ts";
import { pingPeer, getTailscaleStatus } from "@his-and-hers/core";
import { checkGatewayHealth } from "@his-and-hers/core";

export async function status() {
  const config = await loadConfig();

  if (!config) {
    p.log.error("No configuration found. Run `hh onboard` first.");
    return;
  }

  p.intro(pc.bgCyan(pc.black(" hh status ")));

  const thisNode = config.this_node;
  const peer = config.peer_node;

  // This node
  p.log.info(`${thisNode.emoji ?? "🖥"} ${pc.bold(thisNode.name)} (${thisNode.role})`);
  p.log.info(`  Tailscale: ${thisNode.tailscale_hostname} (${thisNode.tailscale_ip})`);
  p.log.info(`  Model: ${thisNode.provider?.model ?? "unknown"}`);
  p.log.info(`  Gateway: ws://127.0.0.1:${config.gateway_port ?? 18789}`);

  // Local gateway health
  const localHealth = await checkGatewayHealth(`http://127.0.0.1:${config.gateway_port ?? 18789}/health`);
  p.log.info(`  Gateway health: ${localHealth ? pc.green("✓ live") : pc.red("✗ unreachable")}`);

  p.log.message("");

  // Peer node
  p.log.info(`${peer.emoji ?? "🖥"} ${pc.bold(peer.name)} (${peer.role})`);
  p.log.info(`  Tailscale: ${peer.tailscale_hostname} (${peer.tailscale_ip})`);

  // Live Tailscale reachability
  const s = p.spinner();
  s.start("Pinging peer via Tailscale...");
  const reachable = await pingPeer(peer.tailscale_ip, 5000);
  s.stop(reachable ? pc.green(`✓ reachable (${peer.tailscale_ip})`) : pc.red(`✗ unreachable (${peer.tailscale_ip})`));

  if (reachable) {
    // Peer gateway health
    s.start("Checking peer gateway...");
    const peerPort = peer.gateway_port ?? 18789;
    const peerHealth = await checkGatewayHealth(`http://${peer.tailscale_ip}:${peerPort}/health`);
    s.stop(peerHealth ? pc.green(`✓ gateway live (port ${peerPort})`) : pc.yellow(`⚠ gateway not responding (port ${peerPort})`));
  }

  // WOL status
  if (peer.wol_enabled) {
    p.log.info(`  Wake-on-LAN: ${pc.green("enabled")} (MAC: ${peer.wol_mac ?? "?"})`);
    if (!reachable) {
      p.log.info(`  → Run ${pc.cyan("hh wake")} to wake this node`);
    }
  }

  // Last heartbeat
  if (config.last_heartbeat) {
    const ago = Math.round((Date.now() - new Date(config.last_heartbeat).getTime()) / 1000);
    p.log.info(`  Last heartbeat: ${ago}s ago`);
  } else {
    p.log.info(`  Last heartbeat: never`);
  }

  p.outro("Status check complete.");
}
