/**
 * context/summarize.ts — Generate a concise context summary from a completed task.
 *
 * Produces a one-paragraph summary capturing:
 *   - Objective (truncated to MAX_OBJECTIVE_CHARS)
 *   - Outcome (success / failed)
 *   - Key output snippet (first MAX_OUTPUT_CHARS characters)
 *   - Artifacts (if any)
 *   - Error snippet (if failed)
 *
 * Design intent:
 *   Template-based for v1 — no external LLM call required, works offline.
 *   Replaceable with an LLM-backed summarizer once a provider is configured
 *   (pass the output through `provider.complete(prompt)` in a future iteration).
 *
 * The result is stored in context/store.ts and forwarded as
 * `HHTaskMessage.context_summary` on the next outbound message.
 */

const MAX_OBJECTIVE_CHARS = 120;
const MAX_OUTPUT_CHARS = 200;
const MAX_ERROR_CHARS = 100;

export interface SummarizeInput {
  task_id: string;
  objective: string;
  output: string;
  success: boolean;
  artifacts?: string[];
  error?: string;
  tokens_used?: number;
  duration_ms?: number;
}

/**
 * Build a compact, human-readable summary of a completed task.
 * Fits comfortably in one paragraph — suitable as `context_summary`.
 */
export function summarizeTask(input: SummarizeInput): string {
  const objective =
    input.objective.length > MAX_OBJECTIVE_CHARS
      ? input.objective.slice(0, MAX_OBJECTIVE_CHARS) + "…"
      : input.objective;

  const status = input.success ? "✓ completed" : "✗ failed";
  const parts: string[] = [`Task ${status}: "${objective}".`];

  if (!input.success && input.error) {
    const errSnippet = input.error.slice(0, MAX_ERROR_CHARS);
    parts.push(`Error: ${errSnippet}${input.error.length > MAX_ERROR_CHARS ? "…" : ""}.`);
  } else if (input.output && input.output !== "(no output)") {
    const snippet =
      input.output.length > MAX_OUTPUT_CHARS
        ? input.output.slice(0, MAX_OUTPUT_CHARS) + "…"
        : input.output;
    // Inline snippet — no newlines in a single-para summary
    parts.push(`Output: ${snippet.replace(/\n+/g, " ").trim()}`);
  }

  if (input.artifacts && input.artifacts.length > 0) {
    parts.push(`Artifacts: ${input.artifacts.join(", ")}.`);
  }

  if (input.tokens_used) {
    const tokStr = input.tokens_used >= 1000
      ? `${(input.tokens_used / 1000).toFixed(1)}k`
      : String(input.tokens_used);
    parts.push(`(${tokStr} tokens)`);
  }

  return parts.join(" ");
}

/**
 * Estimate whether a summary would benefit from LLM condensation.
 * Returns true when the raw output is long enough to warrant it.
 */
export function shouldCondenseWithLLM(rawOutput: string, threshold = 2000): boolean {
  return rawOutput.length > threshold;
}
