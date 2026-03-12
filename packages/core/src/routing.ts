/**
 * routing.ts
 *
 * Routing decisions for task delegation between H1 (cloud) and H2 (local).
 *
 * Two-tier approach:
 *   1. **Capability-aware routing** — when a HHCapabilityReport for the peer
 *      is available, route based on actual advertised skills and models.
 *   2. **Heuristic routing** — keyword-pattern fallback when no capability
 *      data is on hand (e.g. first-run, peer never advertised).
 *
 * Phase 3 will add cost/latency estimation once token budgets are tracked.
 */

import type { HHCapabilityReport } from "./capabilities/registry.schema.ts";

export type RoutingHint = "local" | "h2-local" | "h2-latent" | "cloud";

export interface RoutingDecision {
  hint: RoutingHint;
  reason: string;
  /** Specific Ollama model to use on H2, if applicable */
  suggested_model?: string;
  /**
   * Phase 6: Vision Wormhole codec ID to use for latent send.
   * Only set when hint === "h2-latent".
   * Example: "vw-qwen3vl2b-v1"
   */
  latent_codec?: string;
  /**
   * Phase 6: Canonical codec ID for the chosen latent path.
   * Alias for latent_codec when using Vision Wormhole; kv_model when using LatentMAS.
   * Only set when hint === "h2-latent".
   */
  codec_id?: string;
  /**
   * Phase 6: KV-compatible model ID for LatentMAS path.
   * Only set when hint === "h2-latent" and both peers share the same model family.
   * Example: "llama3.2"
   */
  kv_model?: string;
}

// ─── Keyword heuristics (fallback) ──────────────────────────────────────────

/** Patterns that suggest a task needs local GPU resources on H2. */
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
    return { hint: "h2-local", reason: "keyword match: GPU/local-model task pattern" };
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
 *   - Task mentions image/art/diffusion AND peer has "image-gen" skill → h2-local
 *   - Task mentions transcription AND peer has "transcription" skill → h2-local
 *   - Task is LLM-heavy AND peer has Ollama running with models → h2-local
 *   - Task is heavy (heuristic) AND peer has GPU → h2-local
 *   - Otherwise → cloud
 */
function capabilityRouting(
  task: string,
  peer: HHCapabilityReport,
): RoutingDecision {
  const lower = task.toLowerCase();

  // Latent communication — Vision Wormhole path (Phase 6)
  if (peer.latent_support && peer.latent_codecs.length > 0) {
    if (lower.split(" ").length > 5) {
      return {
        hint: "h2-latent",
        reason: `peer supports latent comm (codec: ${peer.latent_codecs[0]})`,
        codec_id: peer.latent_codecs[0],
        latent_codec: peer.latent_codecs[0],
      };
    }
  }

  // Image generation
  if (
    peer.skills.includes("image-gen") &&
    /\b(image|photo|picture|art|draw|paint|generat|diffus|stable)\b/.test(lower)
  ) {
    return {
      hint: "h2-local",
      reason: `peer has image-gen skill (GPU: ${peer.gpu.name ?? "available"})`,
    };
  }

  // Video generation
  if (
    peer.skills.includes("video-gen") &&
    /\b(video|animation|clip|render)\b/.test(lower)
  ) {
    return {
      hint: "h2-local",
      reason: `peer has video-gen skill`,
    };
  }

  // Transcription
  if (
    peer.skills.includes("transcription") &&
    /\b(transcri(be|pt)|audio|speech|whisper|mp3|wav)\b/.test(lower)
  ) {
    return {
      hint: "h2-local",
      reason: "peer has transcription skill (Whisper detected)",
    };
  }

  // Local LLM via Ollama
  if (peer.ollama.running && peer.ollama.models.length > 0) {
    if (/\b(ollama|local\s+model|llama|mistral|codellama|qwen|deepseek)\b/.test(lower)) {
      const suggested = peer.ollama.models[0];
      return {
        hint: "h2-local",
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
        hint: "h2-local",
        reason: `heavy task → routing to local GPU (${peer.gpu.name ?? "available"})`,
        suggested_model: suggested,
      };
    }
  }

  // Phase 6: Latent routing — prefer Vision Wormhole when peer has a matching codec
  // and the task is complex enough to benefit from latent state transfer.
  // Only activates when H1 also has a matching codec (checked by caller via --latent flag).
  if (
    peer.latent_codecs &&
    peer.latent_codecs.length > 0 &&
    isLatentWorthy(task)
  ) {
    const codec = peer.latent_codecs[0];
    return {
      hint: "h2-latent",
      reason: `peer supports Vision Wormhole (codec: ${codec}) — latent send preferred`,
      latent_codec: codec,
      codec_id: codec,
    };
  }

  // Phase 6: KV-cache path (LatentMAS) — same model family, same weights
  if (
    peer.kv_compatible_models &&
    peer.kv_compatible_models.length > 0 &&
    isLatentWorthy(task)
  ) {
    const model = peer.kv_compatible_models[0];
    return {
      hint: "h2-latent",
      reason: `peer shares KV-compatible model (${model}) — LatentMAS path available`,
      kv_model: model,
      codec_id: model,
    };
  }

  // Heuristic fallback within capability context
  const heuristic = heuristicRouting(task);
  if (heuristic.hint === "h2-local" && peer.gpu.available) {
    return { ...heuristic, reason: `${heuristic.reason} (peer GPU confirmed)` };
  }

  return { hint: "cloud", reason: "peer capabilities checked, task best handled by cloud" };
}

// ─── Latent worthiness heuristic ────────────────────────────────────────────

/**
 * Determines whether a task is complex enough to benefit from latent communication.
 *
 * Latent send has a fixed overhead (~5ms codec + transport). It only pays off
 * for multi-step reasoning, long-context tasks, or tasks where information density
 * matters (e.g. math proofs, code synthesis, chain-of-thought generation).
 *
 * Cheap single-step tasks (weather lookups, simple Q&A) should stay text.
 */
function isLatentWorthy(task: string): boolean {
  const lower = task.toLowerCase();
  const wordCount = task.split(/\s+/).length;

  // Length threshold — short queries aren't worth the codec overhead
  if (wordCount < 6) return false;

  const LATENT_PATTERNS: RegExp[] = [
    /\b(reason|think|step[ -]by[ -]step|chain[ -]of[ -]thought|explain)\b/i,
    /\b(proof|prove|verify|deduc(e|tion)|infer)\b/i,
    /\b(refactor|rewrite|architecture|design\s+pattern)\b/i,
    /\b(analyz[es]?|analys[ei]s|evaluate|assess)\b/i,
    /\b(generate|synthesize|create)\b.*\b(code|function|class|module)\b/i,
    /\b(math|calcul|equat|theorem|lemma|formula)\b/i,
    /\b(summarize|compress|distill)\b.*\b(long|document|paper|text)\b/i,
    /\b(multi[-\s]?step|complex|detailed|comprehensive)\b/i,
  ];

  return LATENT_PATTERNS.some((re) => re.test(lower));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns a routing hint for a given task string.
 *
 * Pass `peerCapabilities` when available for accurate routing.
 * Falls back to keyword heuristics when capabilities are unknown.
 *
 * - `"h2-local"` → send to H2 for GPU/local model execution
 * - `"cloud"`        → handle locally (H1's cloud API)
 * - `"local"`        → handle inline, no peer needed
 */
export function suggestRouting(
  task: string,
  peerCapabilities?: HHCapabilityReport | null,
): RoutingHint {
  return routeTask(task, peerCapabilities).hint;
}

/**
 * Full routing decision with reason and optional model suggestion.
 * Prefer this over `suggestRouting` when you need the reasoning.
 */
export function routeTask(
  task: string,
  peerCapabilities?: HHCapabilityReport | null,
): RoutingDecision {
  if (peerCapabilities && peerCapabilities.node !== "unknown") {
    return capabilityRouting(task, peerCapabilities);
  }
  return heuristicRouting(task);
}
