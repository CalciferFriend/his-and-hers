/**
 * peers/select.ts — Peer selection utilities for multi-H2 setups.
 *
 * When a H1 node has multiple peers configured (`peer_node` + `peer_nodes[]`),
 * these helpers resolve which peer to use for a given send operation.
 *
 * Selection strategy:
 *   1. Explicit: `--peer <name>` → exact name match (case-insensitive)
 *   2. Capability-aware auto: pick the peer whose cached capabilities best
 *      match the task description (GPU needed? Ollama model available? etc.)
 *   3. Fallback: primary `peer_node`
 *
 * All peers are available via `getAllPeers(config)` — returns primary first,
 * then additionals in declaration order.
 */

import type { HHConfig, PeerNodeConfig } from "../config/schema.ts";
import { loadPeerCapabilities } from "@cofounder/core";

export type { PeerNodeConfig };

/**
 * Return all configured peers: primary peer_node first, then peer_nodes[].
 */
export function getAllPeers(config: HHConfig): PeerNodeConfig[] {
  const peers: PeerNodeConfig[] = [config.peer_node];
  if (config.peer_nodes && config.peer_nodes.length > 0) {
    peers.push(...config.peer_nodes);
  }
  return peers;
}

/**
 * Resolve a peer by name (case-insensitive).
 * Returns the matching peer or null if not found.
 */
export function findPeerByName(config: HHConfig, name: string): PeerNodeConfig | null {
  const lower = name.toLowerCase();
  return getAllPeers(config).find((p) => p.name.toLowerCase() === lower) ?? null;
}

/**
 * Get a peer for use in a send operation.
 *
 * @param config   - Current HHConfig
 * @param peerName - If provided, resolve by name (throws if not found).
 *                   If omitted, returns the primary peer_node.
 */
export function getPeer(config: HHConfig, peerName?: string): PeerNodeConfig {
  if (!peerName) {
    return config.peer_node;
  }
  const found = findPeerByName(config, peerName);
  if (!found) {
    const names = getAllPeers(config).map((p) => `"${p.name}"`).join(", ");
    throw new Error(`Peer "${peerName}" not found. Known peers: ${names}`);
  }
  return found;
}

/**
 * Keywords that signal a task needs GPU / local model capabilities.
 */
const GPU_KEYWORDS = [
  "image", "diffusion", "stable diffusion", "comfyui", "automatic1111",
  "render", "generate image", "img2img", "upscale", "video",
  "transcribe", "whisper", "speech",
];

const OLLAMA_KEYWORDS = [
  "ollama", "local model", "llama", "mistral", "gemma", "phi",
  "run locally", "local llm", "offline",
];

/**
 * Select the best peer for a given task using cached capability data.
 *
 * Algorithm:
 *   - Score each peer based on whether the task description matches their
 *     advertised capabilities (GPU, Ollama models, skill tags).
 *   - Return the highest-scoring peer, falling back to peer_node on tie.
 *
 * This is a fast, synchronous scoring pass on cached data — no network calls.
 */
export async function selectBestPeer(config: HHConfig, task: string): Promise<PeerNodeConfig> {
  const peers = getAllPeers(config);
  if (peers.length === 1) return peers[0]!;

  const taskLower = task.toLowerCase();
  const needsGPU = GPU_KEYWORDS.some((kw) => taskLower.includes(kw));
  const needsOllama = OLLAMA_KEYWORDS.some((kw) => taskLower.includes(kw));

  const scores: Array<{ peer: PeerNodeConfig; score: number }> = [];

  for (const peer of peers) {
    let score = 0;

    // Load cached capabilities (non-blocking — file may not exist)
    // Note: loadPeerCapabilities() reads the single cached peer report;
    // in a multi-H2 setup each peer's capability file is namespaced by the
    // capabilities store path — for now we gracefully skip scoring on cache miss.
    const caps = await loadPeerCapabilities().catch(() => null);

    if (caps && caps.node === peer.name) {
      if (needsGPU && caps.gpu?.available) {
        score += 10;
        // Bonus: dedicated GPU (non-integrated)
        if (caps.gpu.name && !caps.gpu.name.toLowerCase().includes("intel")) {
          score += 5;
        }
      }
      if (needsOllama && caps.ollama?.running) {
        score += 8;
        // Extra if they have models loaded
        if (caps.ollama.models && caps.ollama.models.length > 0) {
          score += 3;
        }
      }
      // Skill tag matching (field is `skills` in HHCapabilityReport)
      if (caps.skills && caps.skills.length > 0) {
        for (const tag of caps.skills) {
          if (taskLower.includes(tag.toLowerCase())) {
            score += 4;
          }
        }
      }
    }

    scores.push({ peer, score });
  }

  // Sort descending — stable sort preserves peer_node priority on ties (index 0)
  scores.sort((a, b) => b.score - a.score);

  return scores[0]!.peer;
}

/**
 * Format a peer list for display in CLI output.
 */
export function formatPeerList(config: HHConfig): string {
  const peers = getAllPeers(config);
  return peers
    .map((p, i) => `  ${i === 0 ? "*" : " "} ${p.emoji ?? "🤖"} ${p.name} (${p.tailscale_ip})${i === 0 ? " [primary]" : ""}`)
    .join("\n");
}
