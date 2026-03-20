/**
 * commands/pipeline.ts — `cofounder pipeline`
 *
 * Run a sequence of tasks across peers, feeding each step's output into the next.
 *
 * Usage:
 *   cofounder pipeline "glados:write tests -> piper:review code"      # inline spec
 *   cofounder pipeline --file pipeline.json                           # from file
 *   cofounder pipeline --file pipeline.json --json                    # JSON output
 *   cofounder pipeline --file pipeline.json --timeout 180             # per-step timeout
 *
 * Each task may use placeholders:
 *   {{previous.output}}      — output of the immediately preceding step
 *   {{steps.1.output}}       — output of step N (1-based)
 *   {{previous.error}}       — error message from preceding step
 *   {{steps.N.error}}        — error from step N
 *
 * Phase 7e — Calcifer ✅ (2026-03-15)
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../config/store.ts";
import {
  wakeAgent,
  createTaskMessage,
  loadContextSummary,
  withRetry,
  checkGatewayHealth,
} from "@cofounder/core";
import {
  interpolatePipelineTask,
  parsePipelineSpec,
  parsePipelineFile,
  type PipelineStep,
  type PipelineStepResult,
  type PipelineRunResult,
  type PipelineDefinition,
} from "@cofounder/core";
import { createTaskState, pollTaskCompletion } from "../state/tasks.ts";
import { findPeerByName } from "../peers/select.ts";

// ─── Options ──────────────────────────────────────────────────────────────────

export interface PipelineOptions {
  /** Path to a JSON pipeline definition file. */
  file?: string;
  /** Per-step wait timeout in seconds (overrides step-level timeout). */
  timeout?: string;
  /** Emit machine-readable JSON output. */
  json?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SEND_RETRY_OPTS = {
  maxAttempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 8_000,
};

const DEFAULT_STEP_TIMEOUT_S = 120;

function badge(status: PipelineStepResult["status"]): string {
  switch (status) {
    case "completed": return pc.green("✓");
    case "failed":    return pc.red("✗");
    case "timeout":   return pc.yellow("⏱");
    case "skipped":   return pc.dim("—");
  }
}

function stepLabel(step: PipelineStep, idx: number): string {
  return step.label ?? `Step ${idx + 1}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Run a pipeline — either from an inline spec string or a --file.
 *
 * @param spec    Inline spec ("peer1:task1 -> peer2:task2") or undefined if using --file.
 * @param opts    Pipeline options.
 */
export async function pipeline(spec: string | undefined, opts: PipelineOptions = {}) {
  const config = await loadConfig();
  if (!config) {
    p.log.error("No configuration found. Run `cofounder onboard` first.");
    return;
  }

  // ── Load pipeline definition ──────────────────────────────────────────────

  let def: PipelineDefinition;

  if (opts.file) {
    if (!existsSync(opts.file)) {
      p.log.error(`Pipeline file not found: ${opts.file}`);
      return;
    }
    const raw = readFileSync(opts.file, "utf8");
    try {
      def = parsePipelineFile(raw, opts.file);
    } catch (e) {
      p.log.error((e as Error).message);
      return;
    }
  } else if (spec) {
    try {
      const steps = parsePipelineSpec(spec);
      def = { name: "inline", steps };
    } catch (e) {
      p.log.error(`Invalid pipeline spec: ${(e as Error).message}`);
      p.log.info("Format: \"peer1:task one -> peer2:task two\"");
      return;
    }
  } else {
    p.log.error("Provide a pipeline spec or --file <path>");
    p.log.info("Example: cofounder pipeline \"glados:generate code -> piper:review it\"");
    return;
  }

  const globalTimeoutS = opts.timeout ? parseInt(opts.timeout, 10) : null;
  const pipelineId = randomUUID().slice(0, 8);
  const pipelineName = def.name ?? "pipeline";
  const startedAt = new Date().toISOString();

  if (!opts.json) {
    p.intro(pc.bold(`🔗 Pipeline: ${pipelineName}`) + pc.dim(` [${pipelineId}]`));
    p.log.info(`${def.steps.length} step(s) — ${def.steps.map((s, i) => `${stepLabel(s, i)} → ${s.peer}`).join(" → ")}`);
  }

  // ── Run steps sequentially ────────────────────────────────────────────────

  const stepResults: PipelineStepResult[] = [];
  let pipelineAborted = false;

  for (let i = 0; i < def.steps.length; i++) {
    const step = def.steps[i]!;
    const label = stepLabel(step, i);
    const timeoutS = globalTimeoutS ?? step.timeout ?? DEFAULT_STEP_TIMEOUT_S;

    if (pipelineAborted) {
      stepResults.push({
        stepIndex: i,
        label,
        peer: step.peer,
        task_id: "",
        status: "skipped",
      });
      if (!opts.json) {
        p.log.warn(`${badge("skipped")} ${label} (${step.peer}) — skipped (pipeline aborted)`);
      }
      continue;
    }

    // Interpolate task text from prior step outputs
    const resolvedTask = interpolatePipelineTask(step.task, stepResults);

    // Resolve peer config
    const peerConfig = findPeerByName(config, step.peer);
    if (!peerConfig) {
      const err = `Peer '${step.peer}' not found in config`;
      stepResults.push({
        stepIndex: i,
        label,
        peer: step.peer,
        task_id: "",
        status: "failed",
        error: err,
      });
      if (!opts.json) {
        p.log.error(`${badge("failed")} ${label} — ${err}`);
      }
      if (!step.continueOnError) {
        pipelineAborted = true;
      }
      continue;
    }

    if (!opts.json) {
      p.log.step(`${pc.bold(`[${i + 1}/${def.steps.length}]`)} ${label} → ${pc.cyan(step.peer)}`);
      if (resolvedTask !== step.task) {
        p.log.info(`  Task (interpolated): ${resolvedTask.slice(0, 120)}${resolvedTask.length > 120 ? "…" : ""}`);
      } else {
        p.log.info(`  Task: ${resolvedTask.slice(0, 120)}${resolvedTask.length > 120 ? "…" : ""}`);
      }
    }

    const stepStart = Date.now();

    // Health check
    try {
      await checkGatewayHealth(peerConfig.gateway_url, peerConfig.gateway_token);
    } catch (e) {
      const err = `Gateway unreachable: ${(e as Error).message}`;
      stepResults.push({
        stepIndex: i,
        label,
        peer: step.peer,
        task_id: "",
        status: "failed",
        error: err,
        duration_ms: Date.now() - stepStart,
      });
      if (!opts.json) {
        p.log.error(`  ${badge("failed")} ${err}`);
      }
      if (!step.continueOnError) pipelineAborted = true;
      continue;
    }

    // Create task state + wake peer
    let taskState;
    let taskId = "";
    try {
      const contextSummary = await loadContextSummary(config.identity.name);
      taskState = await createTaskState({
        id: randomUUID(),
        peer: step.peer,
        task: resolvedTask,
      });
      taskId = taskState.id;

      const wakeText = createTaskMessage({
        from: config.identity.name,
        taskId,
        task: resolvedTask,
        contextSummary,
        pipelineId,
        pipelineStep: i + 1,
        pipelineTotalSteps: def.steps.length,
      });

      await withRetry(
        () => wakeAgent(peerConfig.gateway_url, peerConfig.gateway_token, wakeText),
        SEND_RETRY_OPTS,
      );
    } catch (e) {
      const err = `Failed to wake ${step.peer}: ${(e as Error).message}`;
      stepResults.push({
        stepIndex: i,
        label,
        peer: step.peer,
        task_id: taskId,
        status: "failed",
        error: err,
        duration_ms: Date.now() - stepStart,
      });
      if (!opts.json) p.log.error(`  ${badge("failed")} ${err}`);
      if (!step.continueOnError) pipelineAborted = true;
      continue;
    }

    if (!opts.json) {
      p.log.info(`  ⏳ Waiting for result (timeout: ${timeoutS}s) …`);
    }

    // Poll for completion
    const finalState = await pollTaskCompletion(taskId, { timeoutMs: timeoutS * 1_000 });
    const duration_ms = Date.now() - stepStart;

    if (!finalState || finalState.status === "timeout") {
      stepResults.push({
        stepIndex: i,
        label,
        peer: step.peer,
        task_id: taskId,
        status: "timeout",
        error: `Timed out after ${timeoutS}s`,
        duration_ms,
      });
      if (!opts.json) {
        p.log.warn(`  ${badge("timeout")} Timed out after ${timeoutS}s`);
      }
      if (!step.continueOnError) pipelineAborted = true;
      continue;
    }

    if (finalState.status === "failed" || finalState.status === "cancelled") {
      const err = finalState.result?.error ?? `Step failed (status: ${finalState.status})`;
      stepResults.push({
        stepIndex: i,
        label,
        peer: step.peer,
        task_id: taskId,
        status: "failed",
        error: err,
        duration_ms,
      });
      if (!opts.json) {
        p.log.error(`  ${badge("failed")} ${err}`);
      }
      if (!step.continueOnError) pipelineAborted = true;
      continue;
    }

    // Success
    const output = finalState.result?.output ?? "";
    stepResults.push({
      stepIndex: i,
      label,
      peer: step.peer,
      task_id: taskId,
      status: "completed",
      output,
      tokens_used: finalState.result?.tokens_used,
      cost_usd: finalState.result?.cost_usd,
      duration_ms,
    });

    if (!opts.json) {
      p.log.success(
        `  ${badge("completed")} Done in ${(duration_ms / 1000).toFixed(1)}s` +
        (finalState.result?.tokens_used ? ` · ${finalState.result.tokens_used} tokens` : "") +
        (finalState.result?.cost_usd ? ` · $${finalState.result.cost_usd.toFixed(4)}` : ""),
      );
      if (output) {
        const preview = output.slice(0, 200);
        p.log.info(`  Output: ${preview}${output.length > 200 ? "…" : ""}`);
      }
    }
  }

  // ── Build run result ──────────────────────────────────────────────────────

  const finishedAt = new Date().toISOString();
  const completedSteps = stepResults.filter((r) => r.status === "completed").length;
  const failedSteps = stepResults.filter((r) => r.status === "failed" || r.status === "timeout").length;
  const overallStatus: PipelineRunResult["status"] =
    failedSteps === 0 ? "completed" :
    completedSteps > 0 ? "partial" : "failed";

  const runResult: PipelineRunResult = {
    pipeline_id: pipelineId,
    name: pipelineName,
    status: overallStatus,
    steps: stepResults,
    total_steps: def.steps.length,
    completed_steps: completedSteps,
    failed_steps: failedSteps,
    total_cost_usd: stepResults.reduce((s, r) => s + (r.cost_usd ?? 0), 0),
    total_tokens: stepResults.reduce((s, r) => s + (r.tokens_used ?? 0), 0),
    total_duration_ms: stepResults.reduce((s, r) => s + (r.duration_ms ?? 0), 0),
    started_at: startedAt,
    finished_at: finishedAt,
  };

  // ── Output ────────────────────────────────────────────────────────────────

  if (opts.json) {
    console.log(JSON.stringify(runResult, null, 2));
    return;
  }

  const statusColor =
    overallStatus === "completed" ? pc.green :
    overallStatus === "partial"   ? pc.yellow :
    pc.red;

  p.outro(
    statusColor(`Pipeline ${overallStatus.toUpperCase()}`) +
    pc.dim(` — ${completedSteps}/${def.steps.length} steps completed`) +
    (runResult.total_cost_usd > 0 ? pc.dim(` · $${runResult.total_cost_usd.toFixed(4)} total`) : "") +
    (runResult.total_tokens > 0 ? pc.dim(` · ${runResult.total_tokens} tokens`) : ""),
  );

  // Final output from last successful step
  const lastOutput = [...stepResults].reverse().find((r) => r.output);
  if (lastOutput?.output) {
    console.log("\n" + pc.bold("Final output:"));
    console.log(lastOutput.output);
  }
}
