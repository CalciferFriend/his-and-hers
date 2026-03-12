/**
 * commands/peers.ts — `tj peers`
 *
 * List all configured peer nodes and their current reachability status.
 *
 * Usage:
 *   tj peers              — list peers with cached capability info
 *   tj peers --ping       — live reachability check for each peer
 *   tj peers --json       — machine-readable output
 *
 * The primary peer is marked with ★. Additional peers from peer_nodes[]
 * are listed in declaration order.
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { loadConfig } from "../config/store.ts";
import { pingPeer, loadPeerCapabilities } from "@his-and-hers/core";
import { getAllPeers } from "../peers/select.ts";

export interface PeersOptions {
  ping?: boolean;
  json?: boolean;
}

interface PeerStatus {
  name: string;
  emoji: string;
  role: string;
  tailscale_ip: string;
  primary: boolean;
  reachable?: boolean;
  gpu?: string;
  ollama_models?: number;
  skill_tags?: string[];
}

export async function peers(opts: PeersOptions = {}) {
  const config = await loadConfig();

  if (!config) {
    p.log.error("No configuration found. Run `tj onboard` first.");
    process.exitCode = 1;
    return;
  }

  const allPeers = getAllPeers(config);

  const statuses: PeerStatus[] = await Promise.all(
    allPeers.map(async (peer, i): Promise<PeerStatus> => {
      // Load cached peer capabilities — matches by node name to handle
      // multi-peer configs where only the primary peer's cache may be present.
      const allCaps = await loadPeerCapabilities().catch(() => null);
      const caps = allCaps?.node === peer.name ? allCaps : null;

      let reachable: boolean | undefined;
      if (opts.ping) {
        reachable = await pingPeer(peer.tailscale_ip, 3000).catch(() => false);
      }

      return {
        name: peer.name,
        emoji: peer.emoji ?? "🤖",
        role: peer.role,
        tailscale_ip: peer.tailscale_ip,
        primary: i === 0,
        reachable,
        gpu: caps?.gpu?.available ? (caps.gpu.name ?? "GPU") : undefined,
        ollama_models: caps?.ollama?.models?.length,
        skill_tags: caps?.skills,
      };
    }),
  );

  if (opts.json) {
    process.stdout.write(JSON.stringify(statuses, null, 2) + "\n");
    return;
  }

  p.intro(`${pc.bold("Configured peers")} (${allPeers.length} total)`);

  for (const s of statuses) {
    const tag = s.primary ? pc.bold(pc.yellow("★ primary")) : pc.dim("  peer");
    const reach = s.reachable === true
      ? pc.green("● online")
      : s.reachable === false
      ? pc.red("○ offline")
      : pc.dim("? (run --ping to check)");

    p.log.info(`${s.emoji} ${pc.bold(s.name)}  [${tag}]  ${pc.cyan(s.tailscale_ip)}  ${reach}`);

    if (s.gpu) {
      p.log.info(`   ${pc.dim("GPU:")} ${s.gpu}`);
    }
    if (s.ollama_models !== undefined) {
      p.log.info(`   ${pc.dim("Ollama:")} ${s.ollama_models} model${s.ollama_models === 1 ? "" : "s"} loaded`);
    }
    if (s.skill_tags && s.skill_tags.length > 0) {
      p.log.info(`   ${pc.dim("Skills:")} ${s.skill_tags.join(", ")}`);
    }
  }

  p.log.info("");
  p.log.info(pc.dim(`Use ${pc.italic("tj send --peer <name> <task>")} to target a specific peer.`));
  p.log.info(pc.dim(`Use ${pc.italic("tj send --auto <task>")} to auto-select by capability.`));

  p.outro("Done");
}
