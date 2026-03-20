/**
 * commands/broadcast.ts — `cofounder broadcast`
 *
 * Send the same task to multiple peer nodes concurrently. Useful for:
 *   - Delegating the same work to all available H2s simultaneously
 *   - Comparing responses from peers with different models/hardware
 *   - Racing tasks to return the fastest result (--strategy first)
 *   - Ensuring redundant execution across a cluster
 *
 * Usage:
 *   cofounder broadcast "code-review this diff"          # all peers, fire-and-forget
 *   cofounder broadcast "generate docs" --wait           # all peers, wait for results
 *   cofounder broadcast "run tests" --peers glados,piper # specific subset
 *   cofounder broadcast "quick check" --strategy first   # return when 1st responds
 *   cofounder broadcast "analyze data" --json            # machine-readable output
 *
 * Phase 7a — Calcifer ✅ (2026-03-15)
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { loadConfig } from "../config/store.ts";
import {
  wakeAgent,
  createTaskMessage,
  loadContextSummary,
  withRetry,
  checkGatewayHealth,
} from "@cofounder/core";
import { createTaskState, pollTaskCompletion } from "../state/tasks.ts";
import { getAllPeers, findPeerByName } from "../peers/select.ts";
import type { PeerNodeConfig } from "../config/schema.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BroadcastStrategy = "all" | "first";

export interface BroadcastOptions {
  /** Comma-separated peer names. Defaults to all configured peers. */
  peers?: string;
  /** Named cluster to resolve peers from (mutually exclusive with peers). */
  cluster?: string;
  /** Wait for result(s) before exiting. */
  wait?: boolean;
  /** How long to wait for results (seconds). Default: 120. */
  waitTimeoutSeconds?: string;
  /** "all" — wait for all peers to respond. "first" — stop after the first. */
  strategy?: BroadcastStrategy;
  /** Skip WOL/gateway health check for each peer (faster, less safe). */
  noCheck?: boolean;
  /** Emit JSON output instead of human-readable. */
  json?: boolean;
}

/** A per-peer result from a broadcast. */
export interface BroadcastResult {
  peer: string;
  task_id: string;
  status: "sent" | "completed" | "failed" | "timeout";
  output?: string;
  error?: string;
  tokens_used?: number;
  cost_usd?: number;
  duration_ms?: number;
  elapsed_ms: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SEND_RETRY_OPTS = {
  maxAttempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 8_000,
};

function buildWakeText(
  from: string,
  taskId: string,
  task: string,
): string {
  return [
    `[CofounderMessage:task from ${from} id=${taskId}] ${task}`,
    ``,
    `When done, run: cofounder result ${taskId} "<your output here>"`,
  ].join("\n");
}

/** Send the task to a single peer and optionally wait for its result. */
async function sendToPeer(
  fromName: string,
  peer: PeerNodeConfig,
  task: string,
  opts: {
    wait: boolean;
    waitTimeoutMs: number;
    noCheck: boolean;
  },
): Promise<BroadcastResult> {
  const start = Date.now();
  const peerPort = peer.gateway_port ?? 18789;

  // ── 1. Gateway health check ────────────────────────────────────────────────
  if (!opts.noCheck) {
    const healthy = await checkGatewayHealth(
      `http://${peer.tailscale_ip}:${peerPort}/health`,
    ).catch(() => false);
    if (!healthy) {
      return {
        peer: peer.name,
        task_id: "(not sent)",
        status: "failed",
        error: `Gateway not healthy at ${peer.tailscale_ip}:${peerPort}`,
        elapsed_ms: Date.now() - start,
      };
    }
  }

  // ── 2. Build + store task ──────────────────────────────────────────────────
  const contextSummary = await loadContextSummary(peer.name, 3).catch(() => null);
  const msg = createTaskMessage(fromName, peer.name, {
    objective: task,
    constraints: [],
  }, { context_summary: contextSummary });

  await createTaskState({
    id: msg.id,
    from: msg.from,
    to: msg.to,
    objective: task,
    constraints: [],
  });

  // ── 3. Deliver via wakeAgent ───────────────────────────────────────────────
  const wakeText = buildWakeText(fromName, msg.id, task);
  if (!peer.gateway_token) {
    return {
      peer: peer.name,
      task_id: msg.id,
      status: "failed",
      error: "Peer gateway token not set. Run `cofounder pair` first.",
      elapsed_ms: Date.now() - start,
    };
  }

  try {
    const res = await withRetry(
      async () => {
        const r = await wakeAgent({
          url: `ws://${peer.tailscale_ip}:${peerPort}`,
          token: peer.gateway_token!,
          text: wakeText,
          mode: "now",
        });
        if (!r.ok) throw new Error(r.error ?? "delivery failed");
        return r;
      },
      SEND_RETRY_OPTS,
    );
    if (!res.ok) {
      return {
        peer: peer.name,
        task_id: msg.id,
        status: "failed",
        error: res.error ?? "delivery failed",
        elapsed_ms: Date.now() - start,
      };
    }
  } catch (err) {
    return {
      peer: peer.name,
      task_id: msg.id,
      status: "failed",
      error: (err as Error).message,
      elapsed_ms: Date.now() - start,
    };
  }

  if (!opts.wait) {
    return {
      peer: peer.name,
      task_id: msg.id,
      status: "sent",
      elapsed_ms: Date.now() - start,
    };
  }

  // ── 4. Poll for result ─────────────────────────────────────────────────────
  const finalState = await pollTaskCompletion(msg.id, {
    timeoutMs: opts.waitTimeoutMs,
    intervalMs: 5_000,
  }).catch(() => null);

  if (!finalState) {
    return {
      peer: peer.name,
      task_id: msg.id,
      status: "timeout",
      error: "Timed out waiting for result",
      elapsed_ms: Date.now() - start,
    };
  }

  return {
    peer: peer.name,
    task_id: msg.id,
    status: finalState.status === "completed" ? "completed" : "failed",
    output: finalState.result?.output,
    error: finalState.result?.error,
    tokens_used: finalState.result?.tokens_used,
    cost_usd: finalState.result?.cost_usd,
    duration_ms: finalState.result?.duration_ms,
    elapsed_ms: Date.now() - start,
  };
}

// ─── Formatters ───────────────────────────────────────────────────────────────

const STATUS_ICON: Record<BroadcastResult["status"], string> = {
  sent: "📤",
  completed: "✅",
  failed: "❌",
  timeout: "⏱",
};

const STATUS_COLOR: Record<BroadcastResult["status"], (s: string) => string> = {
  sent: pc.blue,
  completed: pc.green,
  failed: pc.red,
  timeout: pc.yellow,
};

function renderResult(r: BroadcastResult): void {
  const icon = STATUS_ICON[r.status];
  const col = STATUS_COLOR[r.status];
  const elapsed = `(${(r.elapsed_ms / 1000).toFixed(1)}s)`;

  p.log.info(`${icon}  ${pc.bold(r.peer)}  ${col(r.status)}  ${pc.dim(r.task_id.slice(0, 8))}  ${pc.dim(elapsed)}`);

  if (r.output) {
    const preview = r.output.length > 200 ? r.output.slice(0, 200) + "…" : r.output;
    p.log.info(pc.dim(`   ${preview.replace(/\n/g, "\n   ")}`));
  }
  if (r.error) {
    p.log.error(`   ${r.error}`);
  }
  const meta: string[] = [];
  if (r.tokens_used) meta.push(`${r.tokens_used.toLocaleString()} tokens`);
  if (r.cost_usd !== undefined) meta.push(`$${r.cost_usd.toFixed(4)}`);
  if (meta.length) p.log.info(pc.dim(`   ${meta.join(" · ")}`));
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function broadcast(task: string, opts: BroadcastOptions = {}) {
  const config = await loadConfig();
  if (!config) {
    p.outro(pc.red("No config found. Run `cofounder onboard` first."));
    process.exitCode = 1;
    return;
  }

  // ── Resolve target peers ───────────────────────────────────────────────────
  let targets: PeerNodeConfig[];

  if (opts.cluster && opts.peers) {
    p.outro(pc.red("--cluster and --peers are mutually exclusive. Use one or the other."));
    process.exitCode = 1;
    return;
  }

  if (opts.cluster) {
    // Resolve peer names from the named cluster
    const clusterMap = config.clusters ?? {};
    const clusterPeerNames = clusterMap[opts.cluster];
    if (!clusterPeerNames) {
      const defined = Object.keys(clusterMap);
      p.outro(
        pc.red(`Cluster "${opts.cluster}" not found.`) +
        (defined.length > 0 ? ` Defined: ${defined.join(", ")}` : " No clusters defined yet (run cofounder cluster add)."),
      );
      process.exitCode = 1;
      return;
    }
    targets = clusterPeerNames.map((name) => {
      const peer = findPeerByName(config, name);
      if (!peer) {
        p.log.warn(`Cluster peer ${pc.yellow(name)} not found in config — skipping`);
      }
      return peer;
    }).filter((p): p is PeerNodeConfig => p !== null);
  } else if (opts.peers) {
    const names = opts.peers.split(",").map((n) => n.trim());
    targets = names.map((name) => {
      const peer = findPeerByName(config, name);
      if (!peer) {
        p.log.warn(`Unknown peer: ${pc.yellow(name)} — skipping`);
      }
      return peer;
    }).filter((p): p is PeerNodeConfig => p !== null);
  } else {
    targets = getAllPeers(config);
  }

  if (targets.length === 0) {
    p.outro(pc.red("No peers configured. Run `cofounder pair` first."));
    process.exitCode = 1;
    return;
  }

  const strategy: BroadcastStrategy = opts.strategy ?? "all";
  const wait = opts.wait ?? false;
  const waitTimeoutMs = opts.waitTimeoutSeconds
    ? parseInt(opts.waitTimeoutSeconds, 10) * 1000
    : 120_000;
  const noCheck = opts.noCheck ?? false;

  // ── Header ─────────────────────────────────────────────────────────────────
  if (!opts.json) {
    p.intro(`${pc.bold("cofounder broadcast")} — sending to ${targets.length} peer${targets.length === 1 ? "" : "s"}`);
    p.log.info(`Task: ${pc.cyan(task.length > 80 ? task.slice(0, 80) + "…" : task)}`);
    p.log.info(`Strategy: ${pc.yellow(strategy)} · Wait: ${wait ? pc.green("yes") : pc.dim("no")} · Peers: ${targets.map((t) => pc.blue(t.name)).join(", ")}`);
  }

  // ── Fire all sends concurrently ────────────────────────────────────────────
  const results: BroadcastResult[] = [];

  if (strategy === "first" && wait) {
    // Race: resolve as soon as first peer returns a result
    const peerPromises = targets.map((peer) =>
      sendToPeer(config.this_node.name, peer, task, { wait, waitTimeoutMs, noCheck }),
    );

    const first = await Promise.race(peerPromises);
    results.push(first);

    if (!opts.json) {
      p.log.success(`First result from ${pc.bold(first.peer)}:`);
      renderResult(first);
    }
  } else {
    // All: wait for every peer (concurrently); surface results as they arrive
    const settled = await Promise.allSettled(
      targets.map((peer) =>
        sendToPeer(config.this_node.name, peer, task, { wait, waitTimeoutMs, noCheck }).then(
          (r) => {
            if (!opts.json) renderResult(r);
            return r;
          },
        ),
      ),
    );

    for (const outcome of settled) {
      if (outcome.status === "fulfilled") {
        results.push(outcome.value);
      } else {
        results.push({
          peer: "(unknown)",
          task_id: "(error)",
          status: "failed",
          error: outcome.reason?.message ?? "unknown error",
          elapsed_ms: 0,
        });
      }
    }
  }

  // ── Summary / output ───────────────────────────────────────────────────────
  if (opts.json) {
    console.log(JSON.stringify({ task, strategy, results }, null, 2));
    return;
  }

  const ok = results.filter((r) => r.status === "completed" || r.status === "sent").length;
  const fail = results.filter((r) => r.status === "failed" || r.status === "timeout").length;
  const totalCost = results.reduce((s, r) => s + (r.cost_usd ?? 0), 0);
  const totalTokens = results.reduce((s, r) => s + (r.tokens_used ?? 0), 0);

  const summary: string[] = [
    `${ok}/${results.length} succeeded`,
    fail > 0 ? pc.red(`${fail} failed`) : "",
    totalTokens > 0 ? pc.dim(`${totalTokens.toLocaleString()} tokens`) : "",
    totalCost > 0 ? pc.dim(`$${totalCost.toFixed(4)} total`) : "",
  ].filter(Boolean).join("  ·  ");

  p.outro(summary);
}
