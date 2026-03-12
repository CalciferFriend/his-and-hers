import * as p from "@clack/prompts";
import { loadConfig } from "../config/store.ts";
import { wakeAndWait } from "@his-and-hers/core";

export async function wake() {
  const config = await loadConfig();

  if (!config) {
    p.log.error("No configuration found. Run `tj onboard` first.");
    return;
  }

  const peer = config.peer_node;
  if (!peer.wol?.enabled) {
    p.log.error("WOL is not configured for the peer node.");
    return;
  }

  p.intro("Waking Jerry node...");

  const spinner = p.spinner();
  spinner.start("Sending magic packet and waiting for boot...");

  const success = await wakeAndWait(
    {
      mac: peer.wol.mac!,
      broadcastIP: peer.wol.broadcast_ip!,
      port: peer.wol.router_port,
    },
    peer.tailscale_ip,
    peer.wol.health_endpoint!,
    {
      pollIntervalMs: peer.wol.poll_interval_seconds * 1000,
      maxAttempts: Math.ceil(peer.wol.wait_timeout_seconds / peer.wol.poll_interval_seconds),
    },
  );

  if (success) {
    spinner.stop("Jerry is awake and gateway is healthy.");
  } else {
    spinner.stop("Failed to wake Jerry — check WOL config with `tj doctor`.");
  }
}
