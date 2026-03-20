/**
 * commands/send.ts — `cofounder send <task>`
 *
 * Send a task to the peer node.
 *
 * Flow:
 *   1. Check if peer is awake (Tailscale ping)
 *   2. If offline and WOL configured → send magic packet, wait for boot
 *   3. Verify peer gateway is healthy
 *   4. Build CofounderTaskMessage, write pending task state
 *   5. Deliver via wakeAgent (injects into peer's OpenClaw session) — with retry/backoff
 *   6. If --wait:
 *        a. Start a result webhook server (Phase 5d) — H2 POSTs back directly
 *        b. Webhook URL included in the wake message so H2 knows where to call
 *        c. Falls back to polling if webhook never arrives (older H2 / network issue)
 *
 * Retry safety (Phase 5e):
 *   wakeAgent delivery is wrapped in withRetry(). A RetryState file persisted at
 *   ~/.cofounder/retry/<task-id>.json prevents duplicate sends from cron runs.
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { loadConfig } from "../config/store.ts";
import {
  wakeAgent,
  pingPeer,
  checkGatewayHealth,
  wakeAndWait,
  suggestRouting,
  createTaskMessage,
  loadContextSummary,
  startResultServer,
  startStreamServer,
  type StreamServerHandle,
  withRetry,
  setRetryState,
  clearRetryState,
  cronRetryDecisionAsync,
  type ResultWebhookPayload,
  deliverNotification,
  checkBudget,
  broadcastNotification,
} from "@cofounder/core";
import { createTaskState, pollTaskCompletion, updateTaskState } from "../state/tasks.ts";
import { getPeer, selectBestPeer, formatPeerList } from "../peers/select.ts";
import { getActiveWebhooks } from "@cofounder/core/notify/config";
import type { NotificationContext } from "@cofounder/core/notify/notify";
import { loadAttachments, formatAttachmentSummary, appendAuditEntry } from "@cofounder/core";
import type { AttachmentPayload } from "@cofounder/core";

const WAKE_TIMEOUT_ATTEMPTS = 45; // 45 × 2s = 90s max
const WAKE_POLL_MS = 2000;

// Retry config for wakeAgent delivery (Phase 5e)
const SEND_RETRY_OPTS = {
  maxAttempts: 3,
  baseDelayMs: 2_000,
  maxDelayMs: 15_000,
  jitter: true,
};

/**
 * Fire the --notify URL (if provided) plus all persistent webhooks matching
 * the task outcome. Errors are soft-logged and never propagate.
 */
async function fireNotifications(
  ctx: NotificationContext,
  adHocUrl?: string,
): Promise<void> {
  const tasks: Promise<void>[] = [];

  // Ad-hoc --notify URL (legacy --notify flag, still supported)
  if (adHocUrl) {
    tasks.push(
      deliverNotification(adHocUrl, ctx).then((ok) => {
        if (ok) {
          p.log.info(pc.dim("✓ Notification sent."));
        } else {
          p.log.warn(pc.yellow("⚠ Notification delivery failed (non-fatal)."));
        }
      }),
    );
  }

  // Legacy persistent webhooks from `cofounder notify add` (notify/config.ts store)
  const persisted = await getActiveWebhooks(ctx.success).catch(() => []);
  for (const wh of persisted) {
    tasks.push(
      deliverNotification(wh.url, ctx).then((ok) => {
        const label = wh.name ?? wh.url;
        if (ok) {
          p.log.info(pc.dim(`✓ Notification sent (${label}).`));
        } else {
          p.log.warn(pc.yellow(`⚠ Notification to ${label} failed (non-fatal).`));
        }
      }),
    );
  }

  // ─── Phase 12b: Phase 11c targets (event-typed, HMAC-signed) ───────────────
  // broadcastNotification handles target filtering by event type + parallel delivery.
  const event = ctx.success ? "task_completed" : "task_failed";
  tasks.push(
    broadcastNotification(event, {
      task_id: ctx.taskId,
      peer: ctx.peer,
      objective: ctx.task,
      output: ctx.output,
      duration_ms: ctx.durationMs,
      cost_usd: ctx.costUsd,
      success: ctx.success,
      timestamp: new Date().toISOString(),
    }),
  );

  await Promise.allSettled(tasks);
}

export interface SendOptions {
  wait?: boolean;
  waitTimeoutSeconds?: string;
  noState?: boolean;
  /** Target a specific peer by name (for multi-H2 setups) */
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
   * Useful for debugging or when H1's Tailscale IP isn't accessible from H2.
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
  /**
   * Webhook URL to POST a completion notification to when the task finishes.
   * Supports Discord (discord.com/api/webhooks/…), Slack (hooks.slack.com/…),
   * and any generic HTTP endpoint. Used with --wait or --no-wait (fires async).
   */
  notify?: string;
  /**
   * Phase 7b: Path to sync to H2 before dispatching the task.
   * Equivalent to running `cofounder sync <path>` immediately before `cofounder send`.
   * Sync failure is non-fatal: a warning is shown and send continues.
   */
  sync?: string;
  /**
   * Phase 7d: One or more local file paths to attach to the task.
   * Supported: PDF, images (PNG/JPEG/WebP/GIF), text, code, markdown, JSON.
   * Files are base64-encoded and embedded in CofounderTaskMessage.payload.attachments[].
   * Soft cap: 10 MB per file (warns but continues). Hard cap: 50 MB (error).
   * H2 injects multimodal types via message API; text/code as fenced blocks.
   */
  attach?: string[];
}

export async function send(task: string, opts: SendOptions = {}) {
  const config = await loadConfig();

  if (!config) {
    p.log.error("No configuration found. Run `cofounder onboard` first.");
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

  // Phase 7b: --sync <path> — push files to H2 before dispatch
  if (opts.sync) {
    const { sync: runSync } = await import("./sync.ts");
    p.log.info(pc.dim(`Syncing ${opts.sync} to ${peer.name} before task dispatch…`));
    const syncResult = await runSync(opts.sync, { peer: peer.name, quiet: false });
    if (!syncResult.ok) {
      p.log.warn(pc.yellow(`⚠ Sync to ${peer.name} failed (non-fatal): ${syncResult.error ?? "unknown error"}`));
      p.log.warn(pc.dim("Continuing with task dispatch…"));
    } else {
      p.log.success(pc.green(`✓ Synced ${syncResult.filesTransferred} file${syncResult.filesTransferred === 1 ? "" : "s"} to ${peer.name}`));
    }
  }

  p.intro(`${pc.bold("Sending task")} → ${peer.emoji ?? ""} ${peer.name}`);
  p.log.info(`Task: ${pc.italic(task)}`);

  // Routing hint (Phase 3 capability-aware + Phase 6 latent)
  const routing = suggestRouting(task);
  if (routing === "h2-local") {
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
    const { loadPeerCapabilities, routeTask } = await import("@cofounder/core");
    const peerCaps = await loadPeerCapabilities().catch(() => null);
    if (peerCaps) {
      const latentDecision = routeTask(task, peerCaps);
      if (latentDecision.hint === "h2-latent") {
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
        `No cached capabilities for ${peer.name}. Run \`cofounder capabilities fetch\` first, ` +
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
      "Message will be sent as standard CofounderTaskMessage with latent metadata attached."
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

  // ─── Phase 12a: Budget gate ─────────────────────────────────────────────────
  // Check spend caps before dispatching. Block if action=block and cap exceeded;
  // warn (and fire budget_warn notification) if action=warn or at >80% threshold.
  {
    const budgetCheck = await checkBudget(peer.name, 0).catch(() => null);
    if (budgetCheck && budgetCheck.reason) {
      if (!budgetCheck.allowed) {
        // Hard block
        p.log.error(pc.red(`✗ Budget cap exceeded: ${budgetCheck.reason}`));
        p.log.info(
          pc.dim(
            `Daily: $${budgetCheck.spent_today.toFixed(4)}  Monthly: $${budgetCheck.spent_month.toFixed(4)}  ` +
            `Cap: $${budgetCheck.limit.toFixed(2)} (${budgetCheck.limit_type})`,
          ),
        );
        p.log.info(pc.dim(`Adjust the cap with: cofounder budget-cap set ${peer.name} --action warn`));
        p.outro("Send blocked by budget policy.");
        // Fire budget_warn notification to all registered targets
        broadcastNotification("budget_warn", {
          peer: peer.name,
          reason: budgetCheck.reason,
          spent_today: budgetCheck.spent_today,
          spent_month: budgetCheck.spent_month,
          limit: budgetCheck.limit,
          limit_type: budgetCheck.limit_type,
          timestamp: new Date().toISOString(),
        }).catch(() => {});
        return;
      } else {
        // Soft warning — show but continue
        p.log.warn(pc.yellow(`⚠ Budget warning: ${budgetCheck.reason}`));
        p.log.info(
          pc.dim(
            `Daily: $${budgetCheck.spent_today.toFixed(4)}  Monthly: $${budgetCheck.spent_month.toFixed(4)}  ` +
            `Cap: $${budgetCheck.limit.toFixed(2)} (${budgetCheck.limit_type})`,
          ),
        );
        // Fire budget_warn notification even on soft warn
        broadcastNotification("budget_warn", {
          peer: peer.name,
          reason: budgetCheck.reason,
          spent_today: budgetCheck.spent_today,
          spent_month: budgetCheck.spent_month,
          limit: budgetCheck.limit,
          limit_type: budgetCheck.limit_type,
          timestamp: new Date().toISOString(),
        }).catch(() => {});
      }
    }
  }

  // Phase 7d: load file attachments
  let attachments: AttachmentPayload[] = [];
  if (opts.attach && opts.attach.length > 0) {
    const attachS = p.spinner();
    attachS.start(`Loading ${opts.attach.length} attachment${opts.attach.length === 1 ? "" : "s"}…`);
    const loaded = await loadAttachments(opts.attach);

    // Surface warnings (soft cap exceeded)
    for (const warn of loaded.warnings) {
      attachS.message(warn);
    }

    // Hard errors: abort if any file failed to load
    if (loaded.errors.length > 0) {
      attachS.stop(pc.red("✗ Attachment error"));
      for (const err of loaded.errors) {
        p.log.error(err);
      }
      p.outro("Send failed.");
      return;
    }

    attachments = loaded.attachments;
    const totalMB = (attachments.reduce((s, a) => s + a.size_bytes, 0) / 1024 / 1024).toFixed(2);
    attachS.stop(pc.green(`✓ ${attachments.length} attachment${attachments.length === 1 ? "" : "s"} loaded (${totalMB} MB total)`));

    for (const a of attachments) {
      p.log.info(pc.dim(`  · ${a.filename} (${a.mime_type}, ${(a.size_bytes / 1024).toFixed(0)} KB)`));
    }
  }

  // Step 3: build CofounderTaskMessage (attach context summary for multi-turn continuity)
  const contextSummary = await loadContextSummary(peer.name, 3).catch(() => null);
  if (contextSummary) {
    p.log.info(pc.dim(`Context: ${contextSummary.split("\n")[0]}`));
  }
  const msg = createTaskMessage(config.this_node.name, peer.name, {
    objective: task,
    constraints: [],
    attachments,
  }, { context_summary: contextSummary });

  // ─── Phase 5e: Cron duplicate-send guard ────────────────────────────────────
  if (!opts.force) {
    const decision = await cronRetryDecisionAsync(msg.id).catch(() => "send" as const);
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
    p.log.info(pc.dim(`  State: ~/.cofounder/state/tasks/${msg.id}.json`));
  }

  // ─── Phase 5d: Start result webhook server (if --wait and not disabled) ─────
  let webhookUrl: string | null = null;
  let webhookHandle: Awaited<ReturnType<typeof startResultServer>> | null = null;

  // ─── Phase 3: Start streaming server (partial updates while H2 works) ────────
  let streamUrl: string | null = null;
  let streamToken: string | null = null;
  let streamHandle: StreamServerHandle | null = null;

  if (opts.wait && !opts.noWebhook) {
    const tomIP = config.this_node?.tailscale_ip ?? null;
    if (tomIP && peer.gateway_token) {
      try {
        const timeoutMs = opts.waitTimeoutSeconds
          ? parseInt(opts.waitTimeoutSeconds, 10) * 1000
          : 300_000;
        webhookHandle = await startResultServer({
          taskId: msg.id,
          token: peer.gateway_token, // shared secret — H2 must echo this back
          bindAddress: tomIP,
          timeoutMs,
        });
        webhookUrl = webhookHandle.url;
        p.log.info(pc.dim(`Webhook: ${webhookUrl} (H2 will POST result here)`));
      } catch {
        // Webhook setup failed — fall through to polling silently
        p.log.info(pc.dim("Webhook server unavailable — will use polling fallback."));
      }

      // Start streaming server on a separate port — fire-and-forget setup
      try {
        streamToken = peer.gateway_token;
        streamHandle = await startStreamServer({
          taskId: msg.id,
          token: streamToken,
          bindAddress: tomIP,
        });
        streamUrl = streamHandle.url;
        p.log.info(pc.dim(`Streaming: ${streamUrl} (H2 posts live output here)`));
      } catch {
        // Stream server is optional — degrade silently
        streamHandle = null;
        streamUrl = null;
      }
    }
  }

  // Step 5: deliver via wakeAgent — with exponential backoff retry (Phase 5e)
  const sendS = p.spinner();
  sendS.start("Delivering task...");
  if (!peer.gateway_token) {
    p.log.error("Peer gateway token not set. Run `cofounder pair` first.");
    p.outro("Send failed.");
    webhookHandle?.close();
    streamHandle?.close();
    return;
  }

  const wakeText = buildWakeText(msg.from, msg.id, task, webhookUrl, streamUrl, streamToken, attachments);

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
    streamHandle?.close();
    return;
  }

  sendS.stop(pc.green(`✓ Task delivered to ${peer.name}`));

  // Phase 10b: Write audit entry for task_sent
  await appendAuditEntry("task_sent", {
    peer: peer.name,
    task_id: msg.id,
    objective: task,
  }).catch(() => {
    // Soft fail — audit entry is best-effort
  });

  // ─── Phase 12b: Broadcast task_sent to registered notify targets ────────────
  broadcastNotification("task_sent", {
    task_id: msg.id,
    peer: peer.name,
    objective: task,
    timestamp: new Date().toISOString(),
  }).catch(() => {});

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

      // ─── Phase 3: Stream live output while waiting ─────────────────────────
      // If a stream server is running, display partial chunks as they arrive.
      // We race the stream against the webhook result — whichever settles first.
      if (streamHandle) {
        let chunkCount = 0;
        streamHandle.on("chunk", (chunk: string) => {
          if (chunkCount === 0) {
            // First chunk — stop spinner and switch to streaming display mode
            waitS.stop(pc.cyan(`⟳ Live output from ${peer.name}:`));
            process.stdout.write(pc.dim("─".repeat(40)) + "\n");
          }
          chunkCount++;
          // Write raw chunk without extra formatting — preserve newlines
          process.stdout.write(chunk);
        });

        streamHandle.on("done", () => {
          if (chunkCount > 0) {
            process.stdout.write("\n" + pc.dim("─".repeat(40)) + "\n");
          }
        });
      }

      const webhookResult = await webhookHandle.waitForResult();

      // Clean up stream server
      streamHandle?.close();

      if (webhookResult) {
        if (!streamHandle) {
          waitS.stop(pc.green(`✓ Result received via webhook!`));
        } else {
          p.log.success(`✓ Result received from ${peer.name}`);
        }
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

        // ─── Notify webhook (webhook path) ────────────────────────────────
        await fireNotifications(
          {
            task,
            taskId: msg.id,
            success: webhookResult.success,
            output: webhookResult.output,
            peer: peer.name,
            durationMs: webhookResult.duration_ms,
            costUsd: webhookResult.cost_usd,
          },
          opts.notify,
        );

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
      p.log.info(`Check later with: ${pc.cyan(`cofounder task-status ${msg.id}`)}`);
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

      // ─── Notify webhook (poll path) ──────────────────────────────────────
      await fireNotifications(
        {
          task,
          taskId: msg.id,
          success: true,
          output: finalState.result?.output,
          peer: peer.name,
          durationMs: finalState.result?.duration_ms,
          costUsd: finalState.result?.cost_usd,
        },
        opts.notify,
      );
    } else if (finalState.status === "failed") {
      pollS.stop(pc.red("Task failed."));
      p.log.error(finalState.result?.error ?? finalState.result?.output ?? "Unknown error");

      // ─── Notify webhook (failure path) ───────────────────────────────────
      await fireNotifications(
        {
          task,
          taskId: msg.id,
          success: false,
          output: finalState.result?.error ?? finalState.result?.output,
          peer: peer.name,
          durationMs: finalState.result?.duration_ms,
        },
        opts.notify,
      );
    }

    p.outro("Done.");
  } else {
    p.log.info(pc.dim(`To wait for result: cofounder send --wait "${task}"`));
    p.log.info(pc.dim(`To check status:   cofounder task-status ${msg.id.slice(0, 8)}`));
    p.outro("Task sent.");
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build the wake message text sent to the peer agent.
 * Includes the webhook URL when available so H2 knows where to push the result.
 * Includes the stream URL when available so H2 can push partial output chunks.
 * Includes attachment summary when files are attached (Phase 7d).
 */
function buildWakeText(
  from: string,
  taskId: string,
  task: string,
  webhookUrl: string | null,
  streamUrl?: string | null,
  streamToken?: string | null,
  attachments?: AttachmentPayload[],
): string {
  // Build the `cofounder result` invocation hint — include --webhook-url flag if available
  // so H2 can deliver the result back to H1 instantly without polling.
  const resultCmd = webhookUrl
    ? `cofounder result ${taskId} "<your output here>" --webhook-url ${webhookUrl}`
    : `cofounder result ${taskId} "<your output here>"`;

  const lines = [
    `[CofounderMessage:task from ${from} id=${taskId}] ${task}`,
    ``,
    `When done, run: ${resultCmd}`,
  ];

  // Phase 7d: attachment summary
  if (attachments && attachments.length > 0) {
    lines.push(``);
    lines.push(formatAttachmentSummary(attachments));
  }

  if (webhookUrl) {
    lines.push(``);
    lines.push(`HH-Result-Webhook: ${webhookUrl}`);
    lines.push(`(--webhook-url delivers the result to H1 immediately; omit to fall back to polling)`);
  }

  // Phase 3 streaming: H2's cofounder watch picks this up via COFOUNDER_STREAM_URL env
  if (streamUrl && streamToken) {
    lines.push(``);
    lines.push(`HH-Stream-URL: ${streamUrl}`);
    lines.push(`HH-Stream-Token: ${streamToken}`);
    lines.push(
      `(cofounder watch reads these to POST stdout chunks in real-time; H1 displays live progress)`,
    );
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
