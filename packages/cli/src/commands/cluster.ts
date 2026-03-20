/**
 * commands/cluster.ts — `cofounder cluster` / `cofounder clusters`
 *
 * Named peer groups for cluster-targeted dispatch.
 *
 * Clusters let you alias a set of peers under a short name and then target
 * the whole group with `cofounder broadcast --cluster <name>` or inspect the group
 * with `cofounder peers --cluster <name>`.
 *
 * Usage:
 *   cofounder clusters                                  # list all clusters
 *   cofounder cluster add gpu --peers glados,piper      # define a new cluster
 *   cofounder cluster show gpu                          # show peers in a cluster
 *   cofounder cluster remove gpu                        # delete a cluster
 *   cofounder cluster peers add gpu forge               # add a peer to a cluster
 *   cofounder cluster peers remove gpu glados           # remove a peer from a cluster
 *
 * Config storage: clusters are persisted as `clusters` in cofounder.json.
 * Peer names are validated against the full peer roster at write time.
 *
 * Phase 7c — Calcifer ✅ (2026-03-15)
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { loadConfig, patchConfig } from "../config/store.ts";
import { getAllPeers, findPeerByName } from "../peers/select.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClusterInfo {
  name: string;
  peers: string[];
  /** Peers from the cluster that no longer exist in config (stale) */
  stale: string[];
}

export interface ClustersJsonOutput {
  clusters: ClusterInfo[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Load clusters map from config, defaulting to empty. */
async function loadClusters(): Promise<{ clusters: Record<string, string[]>; allPeerNames: string[] }> {
  const config = await loadConfig();
  if (!config) throw new Error("No config found. Run `cofounder onboard` first.");
  const clusters: Record<string, string[]> = config.clusters ?? {};
  const allPeerNames = getAllPeers(config).map((p) => p.name);
  return { clusters, allPeerNames };
}

/** Annotate a cluster's peer list with stale entries. */
function buildClusterInfo(name: string, peers: string[], allPeerNames: string[]): ClusterInfo {
  const stale = peers.filter((p) => !allPeerNames.includes(p));
  return { name, peers, stale };
}

/**
 * Resolve peer names for a cluster from the current config.
 * Returns null if the cluster doesn't exist.
 */
export async function resolveClusterPeers(clusterName: string): Promise<string[] | null> {
  const config = await loadConfig();
  if (!config) return null;
  return config.clusters?.[clusterName] ?? null;
}

// ─── cofounder clusters ──────────────────────────────────────────────────────────────

export async function clusterList(opts: { json?: boolean } = {}) {
  const config = await loadConfig();
  if (!config) {
    p.log.error("No configuration found. Run `cofounder onboard` first.");
    process.exitCode = 1;
    return;
  }

  const clusters = config.clusters ?? {};
  const allPeerNames = getAllPeers(config).map((p) => p.name);
  const entries = Object.entries(clusters);

  if (opts.json) {
    const out: ClustersJsonOutput = {
      clusters: entries.map(([name, peers]) => buildClusterInfo(name, peers, allPeerNames)),
    };
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    return;
  }

  if (entries.length === 0) {
    p.intro(pc.bold("cofounder clusters"));
    p.log.info(pc.dim("No clusters defined yet."));
    p.log.info(pc.dim(`Run ${pc.italic("cofounder cluster add <name> --peers <peer1,peer2>")} to create one.`));
    p.outro("Done");
    return;
  }

  p.intro(`${pc.bold("cofounder clusters")} (${entries.length} defined)`);

  for (const [name, peers] of entries) {
    const info = buildClusterInfo(name, peers, allPeerNames);
    const staleNote = info.stale.length > 0
      ? pc.red(` [stale: ${info.stale.join(", ")}]`)
      : "";
    p.log.info(`  ${pc.bold(pc.cyan(name))}  →  ${peers.join(", ")}${staleNote}`);
  }

  p.log.info("");
  p.log.info(pc.dim(`Use ${pc.italic("cofounder broadcast \"task\" --cluster <name>")} to target a group.`));

  p.outro("Done");
}

// ─── cofounder cluster add ───────────────────────────────────────────────────────────

export interface ClusterAddOptions {
  /** Comma-separated peer names to include in the group. */
  peers: string;
  /** Skip validation of peer names against the roster. */
  noValidate?: boolean;
  /** Output as JSON (cluster info). */
  json?: boolean;
}

export async function clusterAdd(name: string, opts: ClusterAddOptions) {
  const config = await loadConfig();
  if (!config) {
    p.log.error("No configuration found. Run `cofounder onboard` first.");
    process.exitCode = 1;
    return;
  }

  if (!name || !/^[a-z0-9_-]+$/i.test(name)) {
    p.log.error(`Invalid cluster name ${pc.yellow(JSON.stringify(name))}. Use letters, numbers, hyphens, underscores.`);
    process.exitCode = 1;
    return;
  }

  const requestedPeers = opts.peers
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);

  if (requestedPeers.length === 0) {
    p.log.error("At least one peer name is required. Use --peers <name1,name2,...>");
    process.exitCode = 1;
    return;
  }

  // Validate peer names against the roster
  if (!opts.noValidate) {
    const allPeerNames = getAllPeers(config).map((p) => p.name);
    const unknown = requestedPeers.filter((n) => !allPeerNames.includes(n));
    if (unknown.length > 0) {
      p.log.warn(
        `Unknown peer(s): ${unknown.map((n) => pc.yellow(n)).join(", ")}. ` +
        `Known peers: ${allPeerNames.join(", ")}. ` +
        `Use --no-validate to allow unknown names.`,
      );
      process.exitCode = 1;
      return;
    }
  }

  const existing = config.clusters ?? {};
  const isUpdate = name in existing;

  const updated: Record<string, string[]> = { ...existing, [name]: requestedPeers };
  await patchConfig({ clusters: updated });

  if (opts.json) {
    const allPeerNames = getAllPeers(config).map((p) => p.name);
    const info = buildClusterInfo(name, requestedPeers, allPeerNames);
    process.stdout.write(JSON.stringify(info, null, 2) + "\n");
    return;
  }

  p.log.success(
    `${isUpdate ? "Updated" : "Created"} cluster ${pc.bold(pc.cyan(name))}: ${requestedPeers.join(", ")}`,
  );
}

// ─── cofounder cluster show ──────────────────────────────────────────────────────────

export async function clusterShow(name: string, opts: { json?: boolean } = {}) {
  const config = await loadConfig();
  if (!config) {
    p.log.error("No configuration found. Run `cofounder onboard` first.");
    process.exitCode = 1;
    return;
  }

  const clusters = config.clusters ?? {};
  if (!(name in clusters)) {
    p.log.error(
      `Cluster ${pc.yellow(JSON.stringify(name))} not found. ` +
      `Defined clusters: ${Object.keys(clusters).join(", ") || "(none)"}`,
    );
    process.exitCode = 1;
    return;
  }

  const peers = clusters[name]!;
  const allPeerNames = getAllPeers(config).map((p) => p.name);
  const info = buildClusterInfo(name, peers, allPeerNames);

  if (opts.json) {
    process.stdout.write(JSON.stringify(info, null, 2) + "\n");
    return;
  }

  p.intro(`${pc.bold("Cluster:")} ${pc.cyan(name)}`);

  for (const peerName of info.peers) {
    const peer = findPeerByName(config, peerName);
    const staleTag = info.stale.includes(peerName) ? pc.red(" [stale — not in config]") : "";
    const emoji = peer?.emoji ?? "🤖";
    const ip = peer ? pc.dim(` (${peer.tailscale_ip})`) : "";
    p.log.info(`  ${emoji} ${pc.bold(peerName)}${ip}${staleTag}`);
  }

  if (info.stale.length > 0) {
    p.log.warn(`${info.stale.length} stale peer(s) — run ${pc.italic(`cofounder cluster peers remove ${name} <peer>`)} to clean up.`);
  }

  p.outro("Done");
}

// ─── cofounder cluster remove ────────────────────────────────────────────────────────

export async function clusterRemove(name: string, opts: { force?: boolean; json?: boolean } = {}) {
  const config = await loadConfig();
  if (!config) {
    p.log.error("No configuration found. Run `cofounder onboard` first.");
    process.exitCode = 1;
    return;
  }

  const clusters = config.clusters ?? {};
  if (!(name in clusters)) {
    p.log.error(
      `Cluster ${pc.yellow(JSON.stringify(name))} not found. ` +
      `Defined clusters: ${Object.keys(clusters).join(", ") || "(none)"}`,
    );
    process.exitCode = 1;
    return;
  }

  if (!opts.force) {
    const peers = clusters[name]!;
    const confirmed = await p.confirm({
      message: `Remove cluster ${pc.cyan(name)} (${peers.join(", ")})?`,
      initialValue: false,
    });
    if (!confirmed || p.isCancel(confirmed)) {
      p.outro("Cancelled.");
      return;
    }
  }

  const updated = { ...clusters };
  delete updated[name];
  await patchConfig({ clusters: Object.keys(updated).length > 0 ? updated : undefined });

  if (opts.json) {
    process.stdout.write(JSON.stringify({ removed: name }) + "\n");
    return;
  }

  p.log.success(`Removed cluster ${pc.bold(pc.cyan(name))}.`);
}

// ─── cofounder cluster peers add ─────────────────────────────────────────────────────

export async function clusterPeersAdd(
  clusterName: string,
  peerName: string,
  opts: { noValidate?: boolean; json?: boolean } = {},
) {
  const config = await loadConfig();
  if (!config) {
    p.log.error("No configuration found. Run `cofounder onboard` first.");
    process.exitCode = 1;
    return;
  }

  const clusters = config.clusters ?? {};
  if (!(clusterName in clusters)) {
    p.log.error(
      `Cluster ${pc.yellow(JSON.stringify(clusterName))} not found. ` +
      `Create it first with ${pc.italic(`cofounder cluster add ${clusterName} --peers ${peerName}`)}`,
    );
    process.exitCode = 1;
    return;
  }

  if (!opts.noValidate) {
    if (!findPeerByName(config, peerName)) {
      const allPeerNames = getAllPeers(config).map((p) => p.name);
      p.log.error(`Unknown peer: ${pc.yellow(peerName)}. Known peers: ${allPeerNames.join(", ")}`);
      process.exitCode = 1;
      return;
    }
  }

  const current = clusters[clusterName]!;
  if (current.includes(peerName)) {
    p.log.warn(`Peer ${pc.yellow(peerName)} is already in cluster ${pc.cyan(clusterName)}.`);
    return;
  }

  const updated = { ...clusters, [clusterName]: [...current, peerName] };
  await patchConfig({ clusters: updated });

  if (opts.json) {
    const allPeerNames = getAllPeers(config).map((p) => p.name);
    const info = buildClusterInfo(clusterName, updated[clusterName]!, allPeerNames);
    process.stdout.write(JSON.stringify(info, null, 2) + "\n");
    return;
  }

  p.log.success(`Added ${pc.bold(peerName)} to cluster ${pc.cyan(clusterName)}.`);
}

// ─── cofounder cluster peers remove ──────────────────────────────────────────────────

export async function clusterPeersRemove(
  clusterName: string,
  peerName: string,
  opts: { json?: boolean } = {},
) {
  const config = await loadConfig();
  if (!config) {
    p.log.error("No configuration found. Run `cofounder onboard` first.");
    process.exitCode = 1;
    return;
  }

  const clusters = config.clusters ?? {};
  if (!(clusterName in clusters)) {
    p.log.error(`Cluster ${pc.yellow(JSON.stringify(clusterName))} not found.`);
    process.exitCode = 1;
    return;
  }

  const current = clusters[clusterName]!;
  if (!current.includes(peerName)) {
    p.log.warn(`Peer ${pc.yellow(peerName)} is not in cluster ${pc.cyan(clusterName)}.`);
    return;
  }

  const after = current.filter((n) => n !== peerName);
  const updated = { ...clusters, [clusterName]: after };
  await patchConfig({ clusters: updated });

  if (opts.json) {
    const allPeerNames = getAllPeers(config).map((p) => p.name);
    const info = buildClusterInfo(clusterName, after, allPeerNames);
    process.stdout.write(JSON.stringify(info, null, 2) + "\n");
    return;
  }

  p.log.success(
    `Removed ${pc.bold(peerName)} from cluster ${pc.cyan(clusterName)}.` +
    (after.length === 0 ? pc.dim(" (cluster is now empty)") : ""),
  );
}
