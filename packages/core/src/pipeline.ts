/**
 * core/pipeline.ts — Pipeline schema + step-interpolation utilities
 *
 * A pipeline is an ordered sequence of steps. Each step sends a task to a
 * named peer and optionally threads the previous step's output into the next
 * task text via `{{previous.output}}` / `{{steps.<n>.output}}` placeholders.
 *
 * Phase 7e — Calcifer ✅ (2026-03-15)
 */

// ─── Schema ───────────────────────────────────────────────────────────────────

/** A single step in a pipeline. */
export interface PipelineStep {
  /** Human-readable label (optional). */
  label?: string;
  /** Task text sent to the peer. Supports `{{previous.output}}` interpolation. */
  task: string;
  /** Peer name to send the task to. Must be a configured peer_node. */
  peer: string;
  /**
   * How long to wait for a result (seconds). Default: 120.
   * Use 0 to fire-and-forget (subsequent steps will not receive output).
   */
  timeout?: number;
  /**
   * Continue the pipeline even if this step fails.
   * Default: false — failure stops the pipeline.
   */
  continueOnError?: boolean;
}

/** Pipeline definition (can be loaded from a JSON/YAML file or constructed inline). */
export interface PipelineDefinition {
  /** Human-readable name for the pipeline. */
  name?: string;
  /** Optional description surfaced in output + logs. */
  description?: string;
  /** Ordered list of steps. */
  steps: PipelineStep[];
}

/** Result for a single completed step. */
export interface PipelineStepResult {
  stepIndex: number;
  label: string;
  peer: string;
  task_id: string;
  status: "completed" | "failed" | "timeout" | "skipped";
  output?: string;
  error?: string;
  tokens_used?: number;
  cost_usd?: number;
  duration_ms?: number;
}

/** Aggregated result for an entire pipeline run. */
export interface PipelineRunResult {
  pipeline_id: string;
  name: string;
  status: "completed" | "failed" | "partial";
  steps: PipelineStepResult[];
  total_steps: number;
  completed_steps: number;
  failed_steps: number;
  total_cost_usd: number;
  total_tokens: number;
  total_duration_ms: number;
  started_at: string;
  finished_at: string;
}

// ─── Interpolation ────────────────────────────────────────────────────────────

/**
 * Interpolate `{{previous.output}}` and `{{steps.<n>.output}}` placeholders
 * in a task string given the results of prior steps.
 *
 * @param template   Raw task text, possibly containing placeholders.
 * @param results    Array of completed step results (index = step position).
 * @returns          Task text with placeholders replaced.
 */
export function interpolatePipelineTask(
  template: string,
  results: PipelineStepResult[],
): string {
  let out = template;

  // {{previous.output}} → last completed step output
  if (out.includes("{{previous.output}}")) {
    const last = [...results].reverse().find((r) => r.output != null);
    out = out.replaceAll("{{previous.output}}", last?.output ?? "");
  }

  // {{previous.error}}
  if (out.includes("{{previous.error}}")) {
    const last = [...results].reverse().find((r) => r.error != null);
    out = out.replaceAll("{{previous.error}}", last?.error ?? "");
  }

  // {{steps.<n>.output}} — 1-based step index
  out = out.replace(/\{\{steps\.(\d+)\.output\}\}/g, (_match, idx) => {
    const stepIdx = parseInt(idx, 10) - 1; // convert 1-based → 0-based
    return results[stepIdx]?.output ?? "";
  });

  // {{steps.<n>.error}}
  out = out.replace(/\{\{steps\.(\d+)\.error\}\}/g, (_match, idx) => {
    const stepIdx = parseInt(idx, 10) - 1;
    return results[stepIdx]?.error ?? "";
  });

  return out;
}

/**
 * Parse a shorthand pipeline spec from CLI args.
 *
 * Format: "peer1:task one -> peer2:task two -> peer3:task three"
 *
 * Returns an array of PipelineStep or throws if parsing fails.
 */
export function parsePipelineSpec(spec: string): PipelineStep[] {
  const parts = spec.split(/\s*->\s*/);
  if (parts.length === 0 || (parts.length === 1 && !parts[0].trim())) {
    throw new Error("Pipeline spec must contain at least one step in the form 'peer:task'");
  }

  return parts.map((part, i) => {
    const colonIdx = part.indexOf(":");
    if (colonIdx === -1) {
      throw new Error(
        `Step ${i + 1}: expected format 'peer:task', got '${part.trim()}'`,
      );
    }
    const peer = part.slice(0, colonIdx).trim();
    const task = part.slice(colonIdx + 1).trim();
    if (!peer) throw new Error(`Step ${i + 1}: peer name is empty`);
    if (!task) throw new Error(`Step ${i + 1}: task text is empty`);
    return { peer, task };
  });
}

/**
 * Load a pipeline definition from a JSON or YAML-formatted string.
 * Supports both JSON and YAML (parsed as JSON with lenient comment stripping).
 */
export function parsePipelineFile(content: string, filename: string): PipelineDefinition {
  // Try JSON first
  if (filename.endsWith(".json") || content.trimStart().startsWith("{")) {
    try {
      const def = JSON.parse(content) as PipelineDefinition;
      validatePipelineDef(def, filename);
      return def;
    } catch (e) {
      throw new Error(`Failed to parse pipeline file as JSON: ${(e as Error).message}`);
    }
  }

  // Basic YAML → JSON (handles simple key:value, arrays with -, quoted strings)
  // For full YAML support we'd need a parser — for now document JSON as primary.
  throw new Error(
    "YAML pipeline files are not yet supported. Save your pipeline as JSON.",
  );
}

function validatePipelineDef(def: unknown, source: string): asserts def is PipelineDefinition {
  if (typeof def !== "object" || def === null) {
    throw new Error(`${source}: pipeline definition must be a JSON object`);
  }
  const d = def as Record<string, unknown>;
  if (!Array.isArray(d.steps) || d.steps.length === 0) {
    throw new Error(`${source}: 'steps' must be a non-empty array`);
  }
  for (const [i, step] of (d.steps as unknown[]).entries()) {
    if (typeof step !== "object" || step === null) {
      throw new Error(`${source}: step ${i + 1} must be an object`);
    }
    const s = step as Record<string, unknown>;
    if (typeof s.peer !== "string" || !s.peer) {
      throw new Error(`${source}: step ${i + 1} missing 'peer' (string)`);
    }
    if (typeof s.task !== "string" || !s.task) {
      throw new Error(`${source}: step ${i + 1} missing 'task' (string)`);
    }
  }
}
