/**
 * commands/result.ts — `hh result <task-id> [output]`
 *
 * Marks a pending task as completed or failed and writes the result payload.
 * When --webhook-url is provided (embedded in the H1 wake message), the result
 * is POSTed back to H1 immediately — no polling needed.
 *
 * Usage (typically called by GLaDOS after processing a delegated task):
 *
 *   hh result <task-id> "Image saved to /tmp/cat.png"
 *   hh result <task-id> --fail "Ollama model not available"
 *   hh result <task-id> --output-file /tmp/result.txt
 *   hh result <task-id> --json '{"output":"...","artifacts":["/tmp/cat.png"]}'
 *
 *   # With webhook delivery (URL comes from the HH-Result-Webhook line in the wake msg):
 *   hh result <task-id> "done" --webhook-url http://100.x.x.x:38791/result
 *
 * The state file is written to ~/.his-and-hers/state/tasks/<id>.json so
 * H1's `hh send --wait` polling loop picks it up as a fallback.
 * When --webhook-url is supplied the result is POSTed to H1 directly,
 * resolving `hh send --wait` immediately without polling delay.
 *
 * Remote delivery:
 *   GLaDOS can call this over SSH:
 *     ssh calcifer "hh result <id> 'task done'"
 *   Or via the webhook URL embedded in the wake message (recommended — faster).
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { readFile } from "node:fs/promises";
import { loadTaskState, updateTaskState, type TaskResult } from "../state/tasks.ts";
import { loadConfig } from "../config/store.ts";
import { estimateCost, summarizeTask, appendContextEntry, deliverResultWebhook } from "@his-and-hers/core";

export interface ResultOptions {
  fail?: boolean;
  outputFile?: string;
  json?: string;
  tokens?: string;
  durationMs?: string;
  artifacts?: string[];
  /**
   * Webhook URL to POST the result back to H1 immediately.
   * Extracted from the `HH-Result-Webhook:` line in the wake message.
   * Uses this node's gateway_token as the auth header.
   */
  webhookUrl?: string;
}

export async function result(taskId: string, output: string | undefined, opts: ResultOptions) {
  // Load existing task
  const task = await loadTaskState(taskId);

  if (!task) {
    p.log.error(`Task not found: ${taskId}`);
    p.log.info("Run `hh status --tasks` to list known tasks.");
    process.exitCode = 1;
    return;
  }

  if (task.status === "completed" || task.status === "failed") {
    p.log.warn(`Task ${pc.dim(taskId.slice(0, 8))} is already ${task.status}.`);
  }

  // Build result payload
  let resultPayload: TaskResult;

  if (opts.json) {
    // Raw JSON result (full payload)
    try {
      resultPayload = JSON.parse(opts.json) as TaskResult;
    } catch {
      p.log.error("Invalid JSON in --json option");
      process.exitCode = 1;
      return;
    }
  } else if (opts.outputFile) {
    // Read output from a file
    try {
      const fileOutput = await readFile(opts.outputFile, "utf-8");
      resultPayload = {
        output: fileOutput.trim(),
        success: !opts.fail,
        error: opts.fail ? (output ?? "Task failed") : undefined,
        artifacts: opts.artifacts ?? [],
        tokens_used: opts.tokens ? parseInt(opts.tokens, 10) : undefined,
        duration_ms: opts.durationMs ? parseInt(opts.durationMs, 10) : undefined,
      };
    } catch (err) {
      p.log.error(`Could not read output file: ${err}`);
      process.exitCode = 1;
      return;
    }
  } else {
    resultPayload = {
      output: output ?? "(no output)",
      success: !opts.fail,
      error: opts.fail ? (output ?? "Task failed") : undefined,
      artifacts: opts.artifacts ?? [],
      tokens_used: opts.tokens ? parseInt(opts.tokens, 10) : undefined,
      duration_ms: opts.durationMs ? parseInt(opts.durationMs, 10) : undefined,
    };
  }

  // Load config once — needed for cost estimation, context summary, and webhook auth
  const config = await loadConfig();

  // Auto-compute cost if tokens are known and cost wasn't explicitly provided
  if (resultPayload.tokens_used && resultPayload.cost_usd === undefined) {
    const model = config?.this_node?.provider?.model
      ? `${config.this_node.provider.kind ?? "anthropic"}/${config.this_node.provider.model}`
      : "anthropic/claude-sonnet-4-6";
    const computed = estimateCost(resultPayload.tokens_used, model);
    if (computed !== null) {
      resultPayload.cost_usd = computed;
    }
  }

  const newStatus = opts.fail ? "failed" : "completed";

  try {
    const updated = await updateTaskState(taskId, {
      status: newStatus,
      result: resultPayload,
    });

    const icon = newStatus === "completed" ? pc.green("✓") : pc.red("✗");
    const shortId = pc.dim(taskId.slice(0, 8));
    p.log.info(`${icon} Task ${shortId} marked as ${pc.bold(newStatus)}`);
    p.log.info(`  Objective: ${pc.italic(updated.objective)}`);
    if (resultPayload.artifacts.length > 0) {
      p.log.info(`  Artifacts: ${resultPayload.artifacts.join(", ")}`);
    }
    if (resultPayload.tokens_used) {
      p.log.info(`  Tokens used: ${resultPayload.tokens_used.toLocaleString()}`);
    }
    if (resultPayload.duration_ms) {
      p.log.info(`  Duration: ${(resultPayload.duration_ms / 1000).toFixed(1)}s`);
    }

    // ── Phase 5d: Webhook delivery back to H1 ────────────────────────────────
    // If H1 included a webhook URL in the wake message, POST the result there
    // immediately so `hh send --wait` resolves without polling.
    if (opts.webhookUrl) {
      const token = config?.this_node?.gateway?.gateway_token ?? "";
      if (!token) {
        p.log.warn(
          "  Webhook delivery skipped — no gateway_token in config. " +
          "Run `hh onboard` or set this_node.gateway.gateway_token.",
        );
      } else {
        const webhookS = p.spinner();
        webhookS.start(`  Delivering result to H1 via webhook…`);
        const webhookResult = await deliverResultWebhook(opts.webhookUrl, token, {
          task_id: taskId,
          output: resultPayload.output,
          success: resultPayload.success,
          error: resultPayload.error,
          artifacts: resultPayload.artifacts ?? [],
          tokens_used: resultPayload.tokens_used,
          duration_ms: resultPayload.duration_ms,
          cost_usd: resultPayload.cost_usd,
        });
        if (webhookResult.ok) {
          webhookS.stop(pc.green("  ✓ Result delivered to H1 via webhook."));
        } else {
          webhookS.stop(
            pc.yellow(
              `  ⚠ Webhook delivery failed: ${webhookResult.error ?? "unknown error"}. ` +
              "H1 will pick up the result via polling.",
            ),
          );
        }
      }
    }

    // Generate and store a context summary for multi-turn handoff continuity.
    // This summary will be forwarded as context_summary on the next outbound task.
    try {
      const peerName = config?.peer_node?.name ?? updated.to;
      const summary = summarizeTask({
        task_id: taskId,
        objective: updated.objective,
        output: resultPayload.output,
        success: resultPayload.success,
        error: resultPayload.error,
        artifacts: resultPayload.artifacts,
        tokens_used: resultPayload.tokens_used,
        duration_ms: resultPayload.duration_ms,
      });
      await appendContextEntry(peerName, {
        task_id: taskId,
        summary,
        created_at: new Date().toISOString(),
      });
    } catch {
      // Context summary is best-effort; don't fail the result command if it errors
    }
  } catch (err) {
    p.log.error(`Failed to update task state: ${err}`);
    process.exitCode = 1;
  }
}
