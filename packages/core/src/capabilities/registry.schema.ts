/**
 * capabilities/registry.schema.ts
 *
 * Zod schema for TJCapabilityReport — what a Jerry node advertises about
 * itself so Tom can make informed routing decisions.
 *
 * Jerry writes this to ~/.tom-and-jerry/capabilities.json via `tj capabilities --advertise`.
 * Tom fetches it from the peer gateway at /capabilities or via SSH.
 */

import { z } from "zod";

export const TJGPUInfo = z.object({
  available: z.boolean(),
  /** VRAM in gigabytes, if detectable */
  vram_gb: z.number().nonnegative().optional(),
  /** Human-readable GPU name, e.g. "NVIDIA RTX 3070 Ti" */
  name: z.string().optional(),
  /** Detected driver/backend: cuda, rocm, metal, none */
  backend: z.enum(["cuda", "rocm", "metal", "none"]).optional(),
});
export type TJGPUInfo = z.infer<typeof TJGPUInfo>;

export const TJOllamaInfo = z.object({
  running: z.boolean(),
  /** Base URL of Ollama server */
  base_url: z.string().default("http://localhost:11434"),
  /** List of downloaded model IDs, e.g. ["llama3.2", "codellama:7b"] */
  models: z.array(z.string()).default([]),
});
export type TJOllamaInfo = z.infer<typeof TJOllamaInfo>;

/**
 * Skill tags Jerry can advertise. Tom uses these for routing hints.
 *
 * Well-known tags:
 *   - "image-gen"      → Stable Diffusion, ComfyUI, etc.
 *   - "transcription"  → Whisper or similar
 *   - "code-exec"      → sandboxed code execution
 *   - "ollama"         → local LLM inference via Ollama
 *   - "lmstudio"       → local LLM inference via LM Studio
 *   - "gpu-inference"  → generic GPU-accelerated inference
 *   - "video-gen"      → video generation (Wan, CogVideo, etc.)
 *   - "tts"            → local text-to-speech
 *   - "latent-comm"    → supports Vision Wormhole / LatentMAS latent communication
 */
export const TJSkillTag = z.enum([
  "image-gen",
  "transcription",
  "code-exec",
  "ollama",
  "lmstudio",
  "gpu-inference",
  "video-gen",
  "tts",
  "web-scrape",
  "browser-automation",
  "latent-comm",
]);
export type TJSkillTag = z.infer<typeof TJSkillTag>;

export const TJCapabilityReport = z.object({
  /** Schema version — for forward compat */
  version: z.string().default("0.1.0"),
  /** Node name (matches TJConfig.this_node.name) */
  node: z.string(),
  /** ISO datetime when this report was generated */
  reported_at: z.string().datetime().default(() => new Date().toISOString()),
  /** Platform Jerry is running on */
  platform: z.enum(["windows", "linux", "macos"]).default("linux"),
  /** GPU status */
  gpu: TJGPUInfo.default({ available: false }),
  /** Ollama status */
  ollama: TJOllamaInfo.default({ running: false, models: [] }),
  /**
   * Skill tags this node can handle.
   * Populated automatically based on detected software, or manually set.
   */
  skills: z.array(TJSkillTag).default([]),
  /** Free-form additional notes (e.g. "RTX 3070 Ti, 12GB VRAM, fast inference") */
  notes: z.string().optional(),
  /** Whether WOL is available (can be woken remotely) */
  wol_enabled: z.boolean().default(false),
  /**
   * Vision Wormhole codec IDs this node supports, e.g. `["vw-qwen3vl2b-v1"]`.
   * Empty = no latent send support.
   */
  latent_codecs: z.array(z.string()).default([]),
  /**
   * Model IDs for LatentMAS KV cache path, e.g. `["llama-3.1-70b"]`.
   * Empty = no KV-cache latent support.
   */
  kv_compatible_models: z.array(z.string()).default([]),
  /**
   * Shorthand: true if node supports any latent path (Vision Wormhole or LatentMAS).
   * Set this to true when latent_codecs or kv_compatible_models are non-empty.
   */
  latent_support: z.boolean().default(false),
  /**
   * Peer-set field: Tom stamps this when he receives the report so he knows
   * when he last fetched fresh capability data from Jerry.
   */
  fetched_at: z.string().datetime().optional(),
});
export type TJCapabilityReport = z.infer<typeof TJCapabilityReport>;

/** Minimal capability report when peer is unreachable or hasn't advertised. */
export const UNKNOWN_CAPABILITIES: TJCapabilityReport = TJCapabilityReport.parse({
  version: "0.1.0",
  node: "unknown",
  reported_at: new Date(0).toISOString(),
  platform: "linux",
  gpu: { available: false },
  ollama: { running: false, models: [] },
  skills: [],
  wol_enabled: false,
});
