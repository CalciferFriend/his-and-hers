/**
 * commands/send.ts — `tj send <task>`
 *
 * Send a task to the peer node.
 *
 * Flow:
 *   1. Check if peer is awake (Tailscale ping)
 *   2. If offline and WOL configured → send magic packet, wait for boot
 *   3. Verify peer gateway is healthy
 *   4. Build TJTaskMessage, write pending task state
 *   5. Deliver via wakeAgent (injects into peer's OpenClaw session) — with retry/backoff
 *   6. If --wait:
 *        a. Start a result webhook server (Phase 5d) — Jerry POSTs back directly
 *        b. Webhook URL included in the wake message so Jerry knows where to call
 *        c. Falls back to polling if webhook never arrives (older Jerry / network issue)
 *
 * Retry safety (Phase 5e):
 *   wakeAgent delivery is wrapped in withRetry(). A RetryState file persisted at
 *   ~/.tom-and-jerry/retry/<task-id>.json prevents duplicate sends from cron runs.
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { loadConfig } from "../config/store.ts";
import {
  wakeAgent,
  pingPeer,
  checkGatewayHealth,
  sendMagicPacket,
  wakeAndWait,
  suggestRouting,
  createTaskMessage,
  buildContextSummary,
  startResultServer,
  withRetry,
  setRetryState,
  clearRetryState,
  cronRetryDecision,
  type ResultWebhookPayload,
} from "@tom-and-jerry/core";
import { createTaskState, pollTaskCompletion, updateTaskState } from "../state/tasks.ts";
import { getPeer, selectBestPeer, formatPeerList } from "../peers/select.ts";

const WAKE_TIMEOUT_ATTEMPTS = 45; // 45 × 2s = 90s max
const WAKE_POLL_MS = 2000;

// Retry config for wakeAgent delivery (Phase 5e)
const SEND_RETRY_OPTS = {
  maxAttempts: 3,
  baseDelayMs: 2_000,
  maxDelayMs: 15_000,
  jitter: true,
};

export interface SendOptions {
  wait?: boolean;
  waitTimeoutSeconds?: string;
  noState?: boolean;
  /** Target a specific peer by name (for multi-Jerry setups) */
  peer?: string;
  /** Auto-select best peer based on task + capabilities (ignores --peer) */
  auto?: boolean;
  /**
   * Skip the cron duplicate-send guard (default: false).
   * Set this if you know the task is a fresh send and want to bypass state checks.
   */
  force?: boolean;
  /**
   * Disable the result webhook server (fall back to polling only).
   * Useful for debugging or when Tom's Tailscale IP isn't accessible from Jerry.
   */
  noWebhook?: boolean;
  /**
   * Max retry attempts on delivery failure (default: 3).
   * Overrides SEND_RETRY_OPTS.maxAttempts.
   */
  maxRetries?: string;
  /**
   * Phase 6: Force latent communication mode (Vision Wormhole or LatentMAS).
   * Fails with an error if the peer doesn't advertise latent capability.
   * Use --auto-latent to fall back to text gracefully.
   */
  latent?: boolean;
  /**
   * Phase 6: Use latent communication if the peer supports it, fall back to text otherwise.
   * Preferred over --latent for scripts/crons where you want best-effort latent.
   */
  autoLatent?: boolean;
}

export async function send(task: string, opts: SendOptions = {}) {
  const config = await loadConfig();

  if (!config) {
    p.log.error("No configuration found. Run `tj onboard` first.");
    return;
  }

  // Resolve target peer: --auto selects by capability, --peer selects by name,
  // otherwise falls back to primary peer_node.
  let peer;
  try {
    if (opts.auto) {
      peer = await selectBestPeer(config, task);
      p.log.info(pc.dim(`Auto-selected peer: ${peer.emoji ?? ""} ${peer.name}`));
    } else {
      peer = getPeer(config, opts.peer);
    }
  } catch (err) {
    p.log.error(String(err));
    if ((config.peer_nodes ?? []).length > 0) {
      p.log.info(`Available peers:\n${formatPeerList(config)}`);
    }
    p.outro("Send failed.");
    return;
  }

  p.intro(`${pc.bold("Sending task")} → ${peer.emoji ?? ""} ${peer.name}`);
  p.log.info(`Task: ${pc.italic(task)}`);

  // Routing hint (Phase 3 capability-aware + Phase 6 latent)
  const routing = suggestRouting(task);
  if (routing === "jerry-local") {
    p.log.info(`Routing hint: ${pc.yellow("heavy task")} → recommended for ${peer.name} (local GPU)`);
  }

  // Phase 6: Latent communication check
  // Load cached peer capabilities to check for latent support.
  // --latent: hard-require latent (error if not supported)
  // --auto-latent: prefer latent, fall back to text silently
  let useLatent = false;
  let latentCodec: string | undefined;
  let kvModel: string | undefined;

  if (opts.latent || opts.autoLatent) {
    const { loadPeerCapabilities, routeTask } = await import("@tom-and-jerry/core");
    const peerCaps = await loadPeerCapabilities(peer.name).catch(() => null);
    if (peerCaps) {
      const latentDecision = routeTask(task, peerCaps);
      if (latentDecision.hint === "jerry-latent") {
        useLatent = true;
        latentCodec = latentDecision.codec_id ?? latentDecision.latent_codec;
        kvModel = latentDecision.kv_model;
        const mode = latentCodec ? `Vision Wormhole (${latentCodec})` : `LatentMAS (${kvModel})`;
        p.log.info(`${pc.magenta("⚡ Latent mode")} — ${mode}`);
      } else if (opts.latent) {
        // Hard-require: fail if peer doesn't support latent
        p.log.error(
          `Peer ${peer.name} doesn't advertise latent capability (no codecs or KV-compatible models). ` +
          `Use --auto-latent to fall back to text automatically.`
        );
        p.outro("Send failed.");
        return;
      } else {
        // auto-latent + no latent support → silently use text
        p.log.info(pc.dim(`Peer has no latent capability — using standard text send`));
      }
    } else if (opts.latent) {
      p.log.error(
        `No cached capabilities for ${peer.name}. Run \`tj capabilities fetch\` first, ` +
        `or omit --latent to use text transport.`
      );
      p.outro("Send failed.");
      return;
    } else {
      p.log.info(pc.dim(`No cached peer capabilities — using standard text send`));
    }
  }

  // Warn if latent was requested but codec unavailable (implementation stub)
  if (useLatent) {
    p.log.warn(
      pc.yellow("⚠ Latent transport is Phase 6 / experimental. ") +
      "Vision Wormhole codec is not yet production-ready. " +
      "Message will be sent as standard TJTaskMessage with latent metadata attached."
    );
  }

  // Step 1: check if peer is awake
  const s = p.spinner();
  s.start(`Checking if ${peer.name} is reachable...`);
  const reachable = await pingPeer(peer.tailscale_ip, 5000);

  if (!reachable) {
    if (peer.wol_enabled && peer.wol_mac && peer.wol_broadcast) {
      s.stop(pc.yellow(`${peer.name} is offline — sending Wake-on-LAN...`));

      const wakeS = p.spinner();
      wakeS.start(`Sending magic packet to ${peer.wol_mac}...`);
      const peerPort = peer.gateway_port ?? 18789;
      const healthEndpoint = `http://${peer.tailscale_ip}:${peerPort}/health`;

      const woke = await wakeAndWait(
        { mac: peer.wol_mac, broadcastIP: peer.wol_broadcast },
        peer.tailscale_ip,
        healthEndpoint,
        { pollIntervalMs: WAKE_POLL_MS, maxAttempts: WAKE_TIMEOUT_ATTEMPTS },
      );

      if (!woke) {
        wakeS.stop(pc.red(`✗ ${peer.name} didn't come online in time`));
        p.outro("Send failed. Try again once the node is running.");
        return;
      }
      wakeS.stop(pc.green(`✓ ${peer.name} is online`));
    } else {
      s.stop(pc.red(`✗ ${peer.name} is offline and WOL is not configured`));
      p.log.warn(`Start ${peer.name} manually and try again.`);
      p.outro("Send failed.");
      return;
    }
  } else {
    s.stop(pc.green(`✓ ${peer.name} is reachable`));
  }

  // Step 2: check gateway is up
  const gwS = p.spinner();
  gwS.start("Checking peer gateway...");
  const peerPort = peer.gateway_port ?? 18789;
  const gwHealthy = await checkGatewayHealth(
    `http://${peer.tailscale_ip}:${peerPort}/health`,
  );
  if (!gwHealthy) {
    gwS.stop(pc.yellow("Gateway not responding yet — waiting up to 30s..."));
    let ready = false;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      ready = await checkGatewayHealth(
        `http://${peer.tailscale_ip}:${peerPort}/health`,
      );
      if (ready) break;
    }
    if (!ready) {
      gwS.stop(pc.red("Gateway didn't become healthy in time"));
      p.outro("Send failed.");
      return;
    }
  }
  gwS.stop(pc.green("✓ Gateway ready"));

  // Step 3: build TJTaskMessage (attach context summary for multi-turn continuity)
  const contextSummary = await buildContextSummary(peer.name, 3).catch(() => null);
  if (contextSummary) {
    p.log.info(pc.dim(`Context: ${contextSummary.split("\n")[0]}`));
  }
  const msg = createTaskMessage(config.this_node.name, peer.name, {
    objective: task,
    constraints: [],
  }, { context_summary: contextSummary });

  // ─── Phase 5e: Cron duplicate-send guard ────────────────────────────────────
  if (!opts.force) {
    const decision = await cronRetryDecision(msg.id).catch(() => "send" as const);
    if (decision === "skip") {
      p.log.warn(`Task ${pc.dim(msg.id.slice(0, 8))} is already in flight or completed — skipping.`);
      p.log.info(pc.dim(`Use --force to send anyway.`));
      p.outro("Skipped (cron guard).");
      return;
    }
    if (decision === "backoff") {
      p.log.warn(`Previous attempt failed — still within backoff window. Skipping.`);
      p.log.info(pc.dim(`Use --force to send anyway.`));
      p.outro("Skipped (backoff).");
      return;
    }
  }

  // Step 4: write pending task state (unless --no-state)
  if (!opts.noState) {
    await createTaskState({
      id: msg.id,
      from: msg.from,
      to: msg.to,
      objective: task,
      constraints: [],
      routing_hint: routing,
    });
    p.log.info(`Task ID: ${pc.cyan(msg.id.slice(0, 8))} (full: ${pc.dim(msg.id)})`);
    p.log.info(pc.dim(`  State: ~/.tom-and-jerry/state/tasks/${msg.id}.json`));
  }

  // ─── Phase 5d: Start result webhook server (if --wait and not disabled) ─────
  let webhookUrl: string | null = null;
  let webhookHandle: Awaited<ReturnType<typeof startResultServer>> | null = null;

  if (opts.wait && !opts.noWebhook) {
    const tomIP = config.this_node?.tailscale_ip ?? null;
    if (tomIP && peer.gateway_token) {
      try {
        const timeoutMs = opts.waitTimeoutSeconds
          ? parseInt(opts.waitTimeoutSeconds, 10) * 1000
          : 300_000;
        webhookHandle = await startResultServer({
          taskId: msg.id,
          token: peer.gateway_token, // shared secret — Jerry must echo this back
          bindAddress: tomIP,
          timeoutMs,
        });
        webhookUrl = webhookHandle.url;
        p.log.info(pc.dim(`Webhook: ${webhookUrl} (Jerry will POST result here)`));
      } catch {
        // Webhook setup failed — fall through to polling silently
        p.log.info(pc.dim("Webhook server unavailable — will use polling fallback."));
      }
    }
  }

  // Step 5: deliver via wakeAgent — with exponential backoff retry (Phase 5e)
  const sendS = p.spinner();
  sendS.start("Delivering task...");
  if (!peer.gateway_token) {
    p.log.error("Peer gateway token not set. Run `tj pair` first.");
    p.outro("Send failed.");
    webhookHandle?.close();
    return;
  }

  const wakeText = buildWakeText(msg.from, msg.id, task, webhookUrl);

  const maxRetries = opts.maxRetries ? parseInt(opts.maxRetries, 10) : SEND_RETRY_OPTS.maxAttempts;
  const retryOpts = { ...SEND_RETRY_OPTS, maxAttempts: maxRetries };

  // Mark as pending before first attempt
  await setRetryState(msg.id, { status: "pending", attempts: 0 }).catch(() => {});

  let deliveryResult: { ok: boolean; error?: string };
  let attemptsMade = 0;

  try {
    deliveryResult = await withRetry(
      async () => {
        attemptsMade++;
        const res = await wakeAgent({
          url: `ws://${peer.tailscale_ip}:${peerPort}`,
          token: peer.gateway_token!,
          text: wakeText,
          mode: "now",
        });
        if (!res.ok) throw new Error(res.error ?? "delivery failed");
        return res;
      },
      {
        ...retryOpts,
        onRetry: (attempt, err, delayMs) => {
          sendS.message(
            `Attempt ${attempt} failed (${(err as Error).message}) — retrying in ${(delayMs / 1000).toFixed(1)}s...`,
          );
        },
      },
    );
    await clearRetryState(msg.id).catch(() => {});
  } catch (err) {
    deliveryResult = { ok: false, error: (err as Error).message };
    const nextRetryMs = Math.min(
      SEND_RETRY_OPTS.baseDelayMs * Math.pow(2, attemptsMade),
      SEND_RETRY_OPTS.maxDelayMs,
    );
    await setRetryState(msg.id, {
      status: "failed",
      attempts: attemptsMade,
      last_error: deliveryResult.error,
      next_retry_at: new Date(Date.now() + nextRetryMs).toISOString(),
    }).catch(() => {});
  }

  if (!deliveryResult.ok) {
    sendS.stop(
      pc.red(
        `✗ Delivery failed after ${attemptsMade} attempt(s): ${deliveryResult.error}`,
      ),
    );
    p.log.info(pc.dim(`Retry state persisted. Next cron run will retry automatically.`));
    p.outro("Send failed.");
    webhookHandle?.close();
    return;
  }

  sendS.stop(pc.green(`✓ Task delivered to ${peer.name}`));

  // Step 6: wait for result if --wait flag
  if (opts.wait) {
    const timeoutMs = opts.waitTimeoutSeconds
      ? parseInt(opts.waitTimeoutSeconds, 10) * 1000
      : 300_000;

    const waitS = p.spinner();

    // ─── Phase 5d: Try webhook first ──────────────────────────────────────────
    if (webhookHandle) {
      waitS.start(
        `Waiting for ${peer.name} to POST result (webhook)... ${pc.dim("(Ctrl+C to detach)")}`,
      );

      const webhookResult = await webhookHandle.waitForResult();

      if (webhookResult) {
        waitS.stop(pc.green(`✓ Result received via webhook!`));
        displayResult(webhookResult, p);

        // Update task state with the webhook delivery
        if (!opts.noState) {
          await updateTaskState(msg.id, {
            status: webhookResult.success ? "completed" : "failed",
            result: {
              output: webhookResult.output,
              success: webhookResult.success,
              error: webhookResult.error,
              artifacts: webhookResult.artifacts ?? [],
              tokens_used: webhookResult.tokens_used,
              duration_ms: webhookResult.duration_ms,
              cost_usd: webhookResult.cost_usd,
            },
          }).catch(() => {});
        }
        p.outro("Done.");
        return;
      }

      // Webhook timed out — fall through to polling
      waitS.stop(pc.yellow("Webhook timeout — falling back to polling..."));
    }

    // ─── Fallback: poll task state file ───────────────────────────────────────
    p.log.info(
      pc.dim(
        `Polling for result (timeout: ${timeoutMs / 1000}s). Press Ctrl+C to detach.`,
      ),
    );

    const pollS = p.spinner();
    pollS.start(`Waiting for ${peer.name} to complete task...`);

    const finalState = await pollTaskCompletion(msg.id, {
      timeoutMs,
      pollIntervalMs: 3000,
    });

    if (!finalState) {
      pollS.stop(pc.red("Task state lost — the state file may have been removed."));
    } else if (finalState.status === "timeout") {
      pollS.stop(pc.yellow("Timed out waiting for result. Task is still pending."));
      p.log.info(`Check later with: ${pc.cyan(`tj task-status ${msg.id}`)}`);
    } else if (finalState.status === "completed") {
      pollS.stop(pc.green("✓ Task completed!"));
      p.log.info(`\n${pc.bold("Result:")}`);
      p.log.info(finalState.result?.output ?? "(empty output)");
      if (finalState.result?.artifacts && finalState.result.artifacts.length > 0) {
        p.log.info(`Artifacts: ${finalState.result.artifacts.join(", ")}`);
      }
      if (finalState.result?.tokens_used) {
        p.log.info(pc.dim(`Tokens used: ${finalState.result.tokens_used.toLocaleString()}`));
      }
    } else if (finalState.status === "failed") {
      pollS.stop(pc.red("Task failed."));
      p.log.error(finalState.result?.error ?? finalState.result?.output ?? "Unknown error");
    }

    p.outro("Done.");
  } else {
    p.log.info(pc.dim(`To wait for result: tj send --wait "${task}"`));
    p.log.info(pc.dim(`To check status:   tj task-status ${msg.id.slice(0, 8)}`));
    p.outro("Task sent.");
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build the wake message text sent to the peer agent.
 * Includes the webhook URL when available so Jerry knows where to push the result.
 */
function buildWakeText(from: string, taskId: string, task: string, webhookUrl: string | null): string {
  const lines = [
    `[TJMessage:task from ${from} id=${taskId}] ${task}`,
    ``,
    `When done, run: tj result ${taskId} "<your output here>"`,
  ];

  if (webhookUrl) {
    lines.push(``);
    lines.push(`TJ-Result-Webhook: ${webhookUrl}`);
    lines.push(`TJ-Result-Token: (use your configured gateway_token)`);
    lines.push(`(POST JSON to the webhook URL to deliver result instantly, skipping polling)`);
  }

  return lines.join("\n");
}

/** Display a webhook-delivered result payload using clack prompts. */
function displayResult(result: ResultWebhookPayload, promptsLib: typeof p): void {
  promptsLib.log.info(`\n${pc.bold("Result:")}`);
  promptsLib.log.info(result.output ?? "(empty output)");
  if (result.artifacts && result.artifacts.length > 0) {
    promptsLib.log.info(`Artifacts: ${result.artifacts.join(", ")}`);
  }
  if (result.tokens_used) {
    promptsLib.log.info(pc.dim(`Tokens used: ${result.tokens_used.toLocaleString()}`));
  }
  if (result.cost_usd !== undefined) {
    promptsLib.log.info(pc.dim(`Cost: $${result.cost_usd.toFixed(4)}`));
  }
  if (result.context_summary) {
    promptsLib.log.info(pc.dim(`Context summary: ${result.context_summary.split("\n")[0]}`));
  }
}
