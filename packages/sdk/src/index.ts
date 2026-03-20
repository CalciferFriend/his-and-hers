/**
 * @cofounder/sdk — Programmatic API for cofounder
 *
 * Dispatch tasks, stream results, and query peer status from Node.js.
 *
 * @example Basic usage
 * ```ts
 * import { HH } from "@cofounder/sdk";
 *
 * const cf = new Cofounder();
 *
 * // Fire-and-forget
 * const { id } = await cofounder.send("Summarise the weekly diff and post it to Discord.");
 *
 * // Wait for the result
 * const result = await cofounder.send("Run inference on prompt.txt", { wait: true });
 * console.log(result.output);
 *
 * // Stream partial output
 * const result = await cofounder.send("Write a 2,000-word short story", {
 *   wait: true,
 *   onChunk: (chunk) => process.stdout.write(chunk),
 * });
 *
 * // Check peer status
 * const status = await cofounder.status();
 * console.log(status.online, status.gatewayHealthy);
 * ```
 */

import { randomUUID } from "node:crypto";
import { getTailscaleStatus, pingPeer as tsPingPeer, waitForPeer } from "@cofounder/core";
import {
  wakeAgent,
  checkGatewayHealth,
  startResultServer,
  startStreamServer,
  type StreamServerHandle,
  type ResultWebhookPayload,
} from "@cofounder/core";
import { createTaskMessage } from "@cofounder/core";
import { loadConfig } from "./config.ts";
import {
  createTaskState,
  loadTaskState,
  listTaskStates,
  pollTaskCompletion,
  updateTaskState,
} from "./state.ts";
import type {
  HHOptions,
  SDKConfig,
  SDKPeerConfig,
  SendOptions,
  SendResult,
  StatusOptions,
  StatusResult,
  PeerInfo,
  PingOptions,
  PingResult,
  TasksOptions,
  TaskSummary,
} from "./types.ts";

// ── Internal helpers ──────────────────────────────────────────────────────────

function peerGatewayUrl(peer: SDKPeerConfig): string {
  return `ws://${peer.tailscale_ip}:${peer.gateway_port}`;
}

function peerHealthUrl(peer: SDKPeerConfig): string {
  return `http://${peer.tailscale_ip}:${peer.gateway_port}/health`;
}

function resolvePeer(config: SDKConfig, name?: string): SDKPeerConfig {
  if (!name) return config.peer_node;
  const all = [config.peer_node, ...(config.peer_nodes ?? [])];
  const match = all.find((p) => p.name === name);
  if (!match) {
    throw new Error(
      `Peer "${name}" not found in config. Available: ${all.map((p) => p.name).join(", ")}`,
    );
  }
  return match;
}

// ── HH class ─────────────────────────────────────────────────────────────────

/**
 * Programmatic interface to cofounder.
 *
 * Reads `~/.cofounder/cofounder.json` by default. Inject `options.config`
 * to skip disk reads entirely (useful in tests or embedded use-cases).
 *
 * All methods are async and return plain objects — no CLI formatting,
 * no stdout writes. Errors are thrown (not process.exit'd).
 */
export class Cofounder {
  private readonly _opts: HHOptions;
  private _config: SDKConfig | null = null;

  constructor(opts: HHOptions = {}) {
    this._opts = opts;
    // If a config object was injected, cache it immediately.
    if (opts.config) {
      this._config = opts.config;
    }
  }

  // ── Config ─────────────────────────────────────────────────────────────────

  /**
   * Load (and cache) the cofounder config.
   * @throws if the config file is missing or unparseable.
   */
  async config(): Promise<SDKConfig> {
    if (this._config) return this._config;
    const cfg = await loadConfig(this._opts.configPath);
    if (!cfg) {
      throw new Error(
        `cofounder config not found at ${this._opts.configPath ?? "~/.cofounder/cofounder.json"}. ` +
          "Run `cofounder onboard` to create it.",
      );
    }
    this._config = cfg;
    return cfg;
  }

  // ── send() ─────────────────────────────────────────────────────────────────

  /**
   * Send a task to a peer node.
   *
   * When `wait: true`, blocks until the peer delivers a result (via webhook
   * with polling fallback). Streaming chunks are delivered to `onChunk` as
   * they arrive.
   *
   * @example
   * // Fire-and-forget (returns immediately with task id)
   * const { id } = await cofounder.send("Run nightly benchmark suite");
   *
   * // Wait for result
   * const result = await cofounder.send("Render 4K upscale of scene.blend", {
   *   peer: "glados",
   *   wait: true,
   *   timeoutMs: 10 * 60 * 1000, // 10 minutes
   * });
   */
  async send(task: string, opts: SendOptions = {}): Promise<SendResult> {
    const cfg = await this.config();
    const peer = resolvePeer(cfg, opts.peer);
    const { wait = false, timeoutMs = 300_000, onChunk, routingHint, constraints = [] } = opts;

    const taskId = randomUUID();
    const wsUrl = peerGatewayUrl(peer);
    const token = peer.gateway_token ?? "";

    // Build the task message text that will be injected into the peer's session.
    const taskMsg = createTaskMessage({
      from: cfg.this_node.name,
      to: peer.name,
      objective: task,
      constraints,
      ...(routingHint ? { context: `routing_hint: ${routingHint}` } : {}),
    });

    // Write pending task state locally so `cf.tasks()` can surface it.
    await createTaskState({
      id: taskId,
      from: cfg.this_node.name,
      to: peer.name,
      objective: task,
      constraints,
      routing_hint: routingHint,
    }, this._opts.stateDirOverride);

    let webhookUrl: string | undefined;
    let streamHandle: StreamServerHandle | undefined;
    let resultServerHandle: Awaited<ReturnType<typeof startResultServer>> | undefined;

    if (wait) {
      // Start result webhook server so H2 can POST back directly.
      try {
        resultServerHandle = await startResultServer({
          taskId,
          token,
          bindAddress: cfg.this_node.tailscale_ip ?? "0.0.0.0",
          timeoutMs,
        });
        webhookUrl = resultServerHandle.url;
      } catch {
        // Non-fatal: fall back to polling below.
      }

      // Start streaming server for partial output.
      if (onChunk) {
        try {
          streamHandle = await startStreamServer({
            taskId,
            token,
            bindAddress: cfg.this_node.tailscale_ip ?? "0.0.0.0",
          });
          streamHandle.on("chunk", (chunk: string) => onChunk(chunk));
        } catch {
          // Non-fatal.
        }
      }
    }

    // Build wake text including webhook URL, routing hint, and task payload.
    const wakeText = [
      `[cofounder-sdk task_id=${taskId}]`,
      webhookUrl ? `webhook=${webhookUrl}` : "",
      streamHandle ? `stream_url=${streamHandle.url}` : "",
      routingHint ? `routing_hint=${routingHint}` : "",
      "",
      JSON.stringify(taskMsg, null, 2),
    ]
      .filter(Boolean)
      .join("\n");

    // Deliver via gateway.
    const wakeResult = await wakeAgent({ url: wsUrl, token, text: wakeText, mode: "now", timeoutMs: 15_000 });
    if (!wakeResult.ok) {
      await updateTaskState(taskId, { status: "failed" }, this._opts.stateDirOverride);
      streamHandle?.close();
      resultServerHandle?.close();
      throw new Error(`Failed to deliver task to peer "${peer.name}": ${wakeResult.error}`);
    }

    await updateTaskState(taskId, { status: "running" }, this._opts.stateDirOverride);

    if (!wait) {
      return { id: taskId, peer: peer.name, status: "pending" };
    }

    // Wait for result — prefer webhook, fall back to polling.
    let payload: ResultWebhookPayload | null = null;
    if (resultServerHandle) {
      try {
        payload = await resultServerHandle.result;
      } catch {
        // Webhook timed out or errored — fall through to polling.
      }
    }

    if (!payload) {
      // Polling fallback.
      const finalState = await pollTaskCompletion(taskId, { timeoutMs, stateDir: this._opts.stateDirOverride });
      if (!finalState || finalState.status === "timeout") {
        streamHandle?.close();
        throw new Error(`Task ${taskId} timed out waiting for result from peer "${peer.name}"`);
      }
      streamHandle?.close();
      return {
        id: taskId,
        peer: peer.name,
        status: finalState.status as SendResult["status"],
        output: finalState.result?.output,
        success: finalState.result?.success,
        error: finalState.result?.error,
        tokensUsed: finalState.result?.tokens_used,
        durationMs: finalState.result?.duration_ms,
        costUsd: finalState.result?.cost_usd,
      };
    }

    // Write final state from webhook payload.
    await updateTaskState(
      taskId,
      {
        status: payload.success ? "completed" : "failed",
        result: {
          output: payload.output,
          success: payload.success,
          error: payload.error,
          artifacts: payload.artifacts ?? [],
          tokens_used: payload.tokens_used,
          duration_ms: payload.duration_ms,
          cost_usd: payload.cost_usd,
        },
      },
      this._opts.stateDirOverride,
    );

    streamHandle?.close();

    return {
      id: taskId,
      peer: peer.name,
      status: payload.success ? "completed" : "failed",
      output: payload.output,
      success: payload.success,
      error: payload.error,
      tokensUsed: payload.tokens_used,
      durationMs: payload.duration_ms,
      costUsd: payload.cost_usd,
    };
  }

  // ── status() ───────────────────────────────────────────────────────────────

  /**
   * Check the health of a peer node.
   *
   * @example
   * const { online, gatewayHealthy } = await cofounder.status();
   * if (!online) console.warn("Peer is offline — WOL may be needed");
   */
  async status(opts: StatusOptions = {}): Promise<StatusResult> {
    const cfg = await this.config();
    const peer = resolvePeer(cfg, opts.peer);

    const start = Date.now();
    const reachable = await tsPingPeer(peer.tailscale_ip, 5000);
    const latencyMs = reachable ? Date.now() - start : undefined;

    const gatewayHealthy = reachable
      ? await checkGatewayHealth(peerHealthUrl(peer), 5000)
      : false;

    return {
      online: reachable,
      gatewayHealthy,
      peer: {
        name: peer.name,
        emoji: peer.emoji,
        tailscale_ip: peer.tailscale_ip,
        gateway_port: peer.gateway_port,
      },
      latencyMs,
    };
  }

  // ── peers() ────────────────────────────────────────────────────────────────

  /**
   * List all configured peer nodes.
   *
   * @example
   * const peers = await cf.peers();
   * const gpuPeers = peers.filter(p => p.os === "windows");
   */
  async peers(): Promise<PeerInfo[]> {
    const cfg = await this.config();
    const all: PeerInfo[] = [
      { ...cfg.peer_node, primary: true },
      ...(cfg.peer_nodes ?? []).map((p) => ({ ...p, primary: false })),
    ];
    return all;
  }

  // ── ping() ─────────────────────────────────────────────────────────────────

  /**
   * Ping a peer via Tailscale to check reachability.
   *
   * @example
   * const { reachable, latencyMs } = await cf.ping({ peer: "glados" });
   */
  async ping(opts: PingOptions = {}): Promise<PingResult> {
    const cfg = await this.config();
    const peer = resolvePeer(cfg, opts.peer);
    const timeoutMs = opts.timeoutMs ?? 5000;

    const start = Date.now();
    const reachable = await tsPingPeer(peer.tailscale_ip, timeoutMs);
    const latencyMs = reachable ? Date.now() - start : undefined;

    return { peer: peer.name, reachable, latencyMs };
  }

  // ── tasks() ────────────────────────────────────────────────────────────────

  /**
   * List tasks from local state (most recent first).
   *
   * @example
   * // All recent tasks
   * const tasks = await cf.tasks();
   *
   * // Only failed tasks for a specific peer
   * const failed = await cf.tasks({ status: "failed", peer: "glados", limit: 10 });
   */
  async tasks(opts: TasksOptions = {}): Promise<TaskSummary[]> {
    const { status, peer, limit = 50 } = opts;
    const all = await listTaskStates(this._opts.stateDirOverride);

    const filtered = all
      .filter((t) => {
        if (status) {
          const statuses = Array.isArray(status) ? status : [status];
          if (!statuses.includes(t.status as TaskSummary["status"])) return false;
        }
        if (peer && t.to !== peer) return false;
        return true;
      })
      .slice(0, limit);

    return filtered.map((t) => ({
      id: t.id,
      from: t.from,
      to: t.to,
      objective: t.objective,
      status: t.status as TaskSummary["status"],
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      output: t.result?.output,
      tokensUsed: t.result?.tokens_used,
      durationMs: t.result?.duration_ms,
      costUsd: t.result?.cost_usd,
    }));
  }

  // ── getTask() ──────────────────────────────────────────────────────────────

  /**
   * Look up a single task by ID (or ID prefix).
   * Returns `null` if not found.
   *
   * @example
   * const task = await cf.getTask("a3f9");
   * console.log(task?.status, task?.output);
   */
  async getTask(id: string): Promise<TaskSummary | null> {
    // Try exact match first.
    const exact = await loadTaskState(id, this._opts.stateDirOverride);
    if (exact) {
      return {
        id: exact.id,
        from: exact.from,
        to: exact.to,
        objective: exact.objective,
        status: exact.status as TaskSummary["status"],
        createdAt: exact.created_at,
        updatedAt: exact.updated_at,
        output: exact.result?.output,
        tokensUsed: exact.result?.tokens_used,
        durationMs: exact.result?.duration_ms,
        costUsd: exact.result?.cost_usd,
      };
    }

    // Prefix search.
    const all = await listTaskStates(this._opts.stateDirOverride);
    const match = all.find((t) => t.id.startsWith(id));
    if (!match) return null;

    return {
      id: match.id,
      from: match.from,
      to: match.to,
      objective: match.objective,
      status: match.status as TaskSummary["status"],
      createdAt: match.created_at,
      updatedAt: match.updated_at,
      output: match.result?.output,
      tokensUsed: match.result?.tokens_used,
      durationMs: match.result?.duration_ms,
      costUsd: match.result?.cost_usd,
    };
  }

  // ── waitFor() ──────────────────────────────────────────────────────────────

  /**
   * Poll a task until it reaches a terminal state.
   *
   * Useful when you sent a fire-and-forget task earlier and want to
   * check the result later.
   *
   * @example
   * const { id } = await cofounder.send("Heavy GPU job");
   * // ... do other work ...
   * const result = await cf.waitFor(id, { timeoutMs: 15 * 60 * 1000 });
   */
  async waitFor(
    id: string,
    opts: { timeoutMs?: number; pollIntervalMs?: number } = {},
  ): Promise<TaskSummary | null> {
    const final = await pollTaskCompletion(id, {
      timeoutMs: opts.timeoutMs ?? 300_000,
      pollIntervalMs: opts.pollIntervalMs ?? 3_000,
      stateDir: this._opts.stateDirOverride,
    });
    if (!final) return null;
    return {
      id: final.id,
      from: final.from,
      to: final.to,
      objective: final.objective,
      status: final.status as TaskSummary["status"],
      createdAt: final.created_at,
      updatedAt: final.updated_at,
      output: final.result?.output,
      tokensUsed: final.result?.tokens_used,
      durationMs: final.result?.duration_ms,
      costUsd: final.result?.cost_usd,
    };
  }
}

// ── Convenience factory ───────────────────────────────────────────────────────

/**
 * Create an HH instance with optional overrides.
 *
 * @example
 * import { createHH } from "@cofounder/sdk";
 * const cf = createCofounder({ configPath: "/custom/path/cofounder.json" });
 */
export function createCofounder(opts?: HHOptions): Cofounder {
  return new Cofounder(opts);
}

// ── Re-exports ────────────────────────────────────────────────────────────────

export type {
  HHOptions,
  SDKConfig,
  SDKPeerConfig,
  SendOptions,
  SendResult,
  StatusOptions,
  StatusResult,
  PeerInfo,
  PingOptions,
  PingResult,
  TasksOptions,
  TaskSummary,
} from "./types.ts";
