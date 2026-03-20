/**
 * SDK config reader.
 *
 * Reads ~/.cofounder/cofounder.json (or a custom path) and returns a minimal
 * SDKConfig. We intentionally avoid importing the full Zod schema from the
 * CLI package to keep the SDK dependency surface small — a best-effort parse
 * is fine since the CLI's onboard wizard produces well-formed configs.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SDKConfig, SDKPeerConfig } from "./types.ts";

export const DEFAULT_CONFIG_PATH = join(homedir(), ".cofounder", "cofounder.json");

// Raw shape of the config on disk (we only care about what we need)
interface RawConfig {
  this_node?: {
    name?: string;
    emoji?: string;
    tailscale_ip?: string;
  };
  peer_node?: {
    name?: string;
    emoji?: string;
    tailscale_ip?: string;
    gateway_port?: number;
    gateway_token?: string;
    os?: string;
  };
  peer_nodes?: Array<{
    name?: string;
    emoji?: string;
    tailscale_ip?: string;
    gateway_port?: number;
    gateway_token?: string;
    os?: string;
  }>;
}

function parsePeer(raw: RawConfig["peer_node"]): SDKPeerConfig | null {
  if (!raw?.name || !raw?.tailscale_ip) return null;
  return {
    name: raw.name,
    emoji: raw.emoji,
    tailscale_ip: raw.tailscale_ip,
    gateway_port: raw.gateway_port ?? 18789,
    gateway_token: raw.gateway_token,
    os: raw.os as SDKPeerConfig["os"],
  };
}

/**
 * Load and parse the cofounder config file.
 * Returns null if the file does not exist or is unparseable.
 */
export async function loadConfig(configPath?: string): Promise<SDKConfig | null> {
  const path = configPath ?? DEFAULT_CONFIG_PATH;
  let raw: RawConfig;
  try {
    const text = await readFile(path, "utf-8");
    raw = JSON.parse(text) as RawConfig;
  } catch {
    return null;
  }

  const thisNode = raw.this_node;
  if (!thisNode?.name || !thisNode?.tailscale_ip) return null;

  const primaryPeer = parsePeer(raw.peer_node);
  if (!primaryPeer) return null;

  const additionalPeers = (raw.peer_nodes ?? [])
    .map(parsePeer)
    .filter((p): p is SDKPeerConfig => p !== null);

  return {
    this_node: {
      name: thisNode.name,
      emoji: thisNode.emoji,
      tailscale_ip: thisNode.tailscale_ip,
    },
    peer_node: primaryPeer,
    peer_nodes: additionalPeers.length > 0 ? additionalPeers : undefined,
  };
}
