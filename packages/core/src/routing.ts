/**
 * routing.ts
 *
 * Routing decisions for task delegation between Tom (cloud) and Jerry (local).
 *
 * Two-tier approach:
 *   1. **Capability-aware routing** — when a TJCapabilityReport for the peer
 *      is available, route based on actual advertised skills and models.
 *   2. **Heuristic routing** — keyword-pattern fallback when no capability
 *      data is on hand (e.g. first-run, peer never advertised).
 *
 * Phase 3 will add cost/latency estimation once token budgets are tracked.
 */

import type { TJCapabilityReport } from "./capabilities/registry.schema.ts";

export type RoutingHint = "local" | "jerry-local" | "cloud";

export interface RoutingDecision {
  hint: RoutingHint;
  reason: string;
  /** Specific Ollama model to use on Jerry, if applicable */
  suggested_model?: string;
}

// ─── Keyword heuristics (fallback) ──────────────────────────────────────────

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

function heuristicRouting(task: string): RoutingDecision {
  if (JERRY_PATTERNS.some((re) => re.test(task))) {
    return { hint: "jerry-local", reason: "keyword match: GPU/local-model task pattern" };
  }
  if (CLOUD_PATTERNS.some((re) => re.test(task))) {
    return { hint: "cloud", reason: "keyword match: lightweight cloud task pattern" };
  }
  return { hint: "cloud", reason: "default: no keyword match, using cloud" };
}

// ─── Capability-aware routing ────────────────────────────────────────────────

/**
 * Route using real peer capability data.
 *
 * Decision tree:
 *   - Task mentions image/art/diffusion AND peer has "image-gen" skill → jerry-local
 *   - Task mentions transcription AND peer has "transcription" skill → jerry-local
 *   - Task is LLM-heavy AND peer has Ollama running with models → jerry-local
 *   - Task is heavy (heuristic) AND peer has GPU → jerry-local
 *   - Otherwise → cloud
 */
function capabilityRouting(
  task: string,
  peer: TJCapabilityReport,
): RoutingDecision {
  const lower = task.toLowerCase();

  // Image generation
  if (
    peer.skills.includes("image-gen") &&
    /\b(image|photo|picture|art|draw|paint|generat|diffus|stable)\b/.test(lower)
  ) {
    return {
      hint: "jerry-local",
      reason: `peer has image-gen skill (GPU: ${peer.gpu.name ?? "available"})`,
    };
  }

  // Video generation
  if (
    peer.skills.includes("video-gen") &&
    /\b(video|animation|clip|render)\b/.test(lower)
  ) {
    return {
      hint: "jerry-local",
      reason: `peer has video-gen skill`,
    };
  }

  // Transcription
  if (
    peer.skills.includes("transcription") &&
    /\b(transcri(be|pt)|audio|speech|whisper|mp3|wav)\b/.test(lower)
  ) {
    return {
      hint: "jerry-local",
      reason: "peer has transcription skill (Whisper detected)",
    };
  }

  // Local LLM via Ollama
  if (peer.ollama.running && peer.ollama.models.length > 0) {
    if (/\b(ollama|local\s+model|llama|mistral|codellama|qwen|deepseek)\b/.test(lower)) {
      const suggested = peer.ollama.models[0];
      return {
        hint: "jerry-local",
        reason: `peer has Ollama running with ${peer.ollama.models.length} model(s)`,
        suggested_model: suggested,
      };
    }

    // Route heavy/open-ended LLM tasks to local if peer has GPU
    if (
      peer.gpu.available &&
      /\b(write|code|refactor|explain|analyse|analyze|summarize|translate|generate)\b/.test(lower) &&
      lower.split(" ").length > 8
    ) {
      const suggested = peer.ollama.models[0];
      return {
        hint: "jerry-local",
        reason: `heavy task → routing to local GPU (${peer.gpu.name ?? "available"})`,
        suggested_model: suggested,
      };
    }
  }

  // Heuristic fallback within capability context
  const heuristic = heuristicRouting(task);
  if (heuristic.hint === "jerry-local" && peer.gpu.available) {
    return { ...heuristic, reason: `${heuristic.reason} (peer GPU confirmed)` };
  }

  return { hint: "cloud", reason: "peer capabilities checked, task best handled by cloud" };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns a routing hint for a given task string.
 *
 * Pass `peerCapabilities` when available for accurate routing.
 * Falls back to keyword heuristics when capabilities are unknown.
 *
 * - `"jerry-local"` → send to Jerry for GPU/local model execution
 * - `"cloud"`        → handle locally (Tom's cloud API)
 * - `"local"`        → handle inline, no peer needed
 */
export function suggestRouting(
  task: string,
  peerCapabilities?: TJCapabilityReport | null,
): RoutingHint {
  return routeTask(task, peerCapabilities).hint;
}

/**
 * Full routing decision with reason and optional model suggestion.
 * Prefer this over `suggestRouting` when you need the reasoning.
 */
export function routeTask(
  task: string,
  peerCapabilities?: TJCapabilityReport | null,
): RoutingDecision {
  if (peerCapabilities && peerCapabilities.node !== "unknown") {
    return capabilityRouting(task, peerCapabilities);
  }
  return heuristicRouting(task);
}
