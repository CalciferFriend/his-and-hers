/**
 * routing.ts
 *
 * Lightweight heuristics for deciding whether a task should be sent to the
 * cloud (Tom's provider) or routed to the local peer (Jerry / GPU executor).
 *
 * These are intentionally simple keyword-based rules. Phase 3 will add proper
 * cost/latency estimation once we have token budgets and a Jerry capability
 * registry.
 */

export type RoutingHint = "local" | "jerry-local" | "cloud";

/** Patterns that suggest a task needs local GPU resources on Jerry. */
const JERRY_PATTERNS: RegExp[] = [
  /\bimage\b/i,
  /\bdiffus/i,
  /\bstable[- ]diffusion\b/i,
  /\bgenerate\b.*\b(image|photo|picture|art)\b/i,
  /\bollama\b/i,
  /\bllama\b/i,
  /\bllm\b/i,
  /\blocal\s+model\b/i,
  /\bgpu\b/i,
  /\bvideo\b/i,
  /\brender\b/i,
  /\bwhisper\b/i,
  /\btranscri(be|pt)\b/i,
];

/** Patterns that are fine for cloud (cheap, fast, no GPU needed). */
const CLOUD_PATTERNS: RegExp[] = [
  /\bsearch\b/i,
  /\bsummar(ize|y)\b/i,
  /\bweather\b/i,
  /\bcalendar\b/i,
  /\bemail\b/i,
  /\bremind(er)?\b/i,
  /\bweb\b/i,
  /\blookup\b/i,
];

/**
 * Returns a routing hint for a given task string.
 *
 * - `"jerry-local"` → send to Jerry for GPU/local model execution
 * - `"cloud"`        → handle locally (Tom's cloud API)
 * - `"local"`        → handle inline, no peer needed
 */
export function suggestRouting(task: string): RoutingHint {
  if (JERRY_PATTERNS.some((re) => re.test(task))) return "jerry-local";
  if (CLOUD_PATTERNS.some((re) => re.test(task))) return "cloud";
  return "cloud"; // default: cloud unless explicitly heavy
}
