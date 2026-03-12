/**
 * commands/result.ts — `hh result <task-id> [output]`
 *
 * Marks a pending task as completed or failed and writes the result payload.
 *
 * Usage (typically called by GLaDOS after processing a delegated task):
 *
 *   hh result <task-id> "Image saved to /tmp/cat.png"
 *   hh result <task-id> --fail "Ollama model not available"
 *   hh result <task-id> --output-file /tmp/result.txt
 *   hh result <task-id> --json '{"output":"...","artifacts":["/tmp/cat.png"]}'
 *
 * The state file is written to ~/.his-and-hers/state/tasks/<id>.json so
 * H1's `hh send --wait` polling loop picks it up automatically.
 *
 * Remote delivery:
 *   GLaDOS can call this over SSH:
 *     ssh calcifer "hh result <id> 'task done'"
 *   Or via wakeAgent (the result text is injected into Calcifer's session
 *   which can then run `hh result` directly).
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { readFile } from "node:fs/promises";
import { loadTaskState, updateTaskState, type TaskResult } from "../state/tasks.ts";
import { loadConfig } from "../config/store.ts";
import { estimateCost, summarizeTask, appendContextEntry } from "@his-and-hers/core";

export interface ResultOptions {
  fail?: boolean;
  outputFile?: string;
  json?: string;
  tokens?: string;
  durationMs?: string;
  artifacts?: string[];
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

  // Auto-compute cost if tokens are known and cost wasn't explicitly provided
  if (resultPayload.tokens_used && resultPayload.cost_usd === undefined) {
    const config = await loadConfig();
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

    // Generate and store a context summary for multi-turn handoff continuity.
    // This summary will be forwarded as context_summary on the next outbound task.
    try {
      const config = await loadConfig();
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
