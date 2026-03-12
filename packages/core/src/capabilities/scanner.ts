/**
 * capabilities/scanner.ts
 *
 * Auto-detect local capabilities for a Jerry node.
 *
 * Runs a series of lightweight probes:
 *   - Platform detection
 *   - Ollama: check if running, list models
 *   - GPU: parse nvidia-smi / rocm-smi / system_profiler output
 *   - Skills: infer from detected software
 *
 * Each probe is best-effort — failures are silently swallowed with a
 * conservative "not available" result.
 */

import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { platform } from "node:os";
import type { TJCapabilityReport, TJGPUInfo, TJOllamaInfo, TJSkillTag } from "./registry.schema.ts";

const exec = promisify(execCb);

async function run(cmd: string, timeoutMs = 5000): Promise<string> {
  const { stdout } = await exec(cmd, { timeout: timeoutMs });
  return stdout.trim();
}

// ─── Platform ────────────────────────────────────────────────────────────────

function detectPlatform(): TJCapabilityReport["platform"] {
  const p = platform();
  if (p === "win32") return "windows";
  if (p === "darwin") return "macos";
  return "linux";
}

// ─── Ollama ──────────────────────────────────────────────────────────────────

async function probeOllama(baseUrl = "http://localhost:11434"): Promise<TJOllamaInfo> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { running: false, base_url: baseUrl, models: [] };
    const json = (await res.json()) as { models?: Array<{ name: string }> };
    const models = (json.models ?? []).map((m) => m.name);
    return { running: true, base_url: baseUrl, models };
  } catch {
    return { running: false, base_url: baseUrl, models: [] };
  }
}

// ─── GPU ─────────────────────────────────────────────────────────────────────

async function probeNvidiaGPU(): Promise<TJGPUInfo | null> {
  try {
    const out = await run(
      "nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits",
      4000,
    );
    const line = out.split("\n")[0]?.trim();
    if (!line) return null;

    const parts = line.split(",").map((s) => s.trim());
    const name = parts[0] ?? "NVIDIA GPU";
    const vramMib = parts[1] ? parseFloat(parts[1]) : undefined;
    const vram_gb = vramMib ? Math.round((vramMib / 1024) * 10) / 10 : undefined;

    return { available: true, name: `NVIDIA ${name}`, vram_gb, backend: "cuda" };
  } catch {
    return null;
  }
}

async function probeRocmGPU(): Promise<TJGPUInfo | null> {
  try {
    const out = await run("rocm-smi --showproductname --csv", 4000);
    if (!out.includes("GPU")) return null;
    const lines = out.split("\n").filter((l) => l.startsWith("card"));
    const name = lines[0]?.split(",")[1]?.trim() ?? "AMD GPU";
    return { available: true, name, backend: "rocm" };
  } catch {
    return null;
  }
}

async function probeAppleGPU(): Promise<TJGPUInfo | null> {
  if (platform() !== "darwin") return null;
  try {
    const out = await run(
      "system_profiler SPDisplaysDataType -json",
      5000,
    );
    const json = JSON.parse(out) as {
      SPDisplaysDataType?: Array<{ sppci_model?: string }>;
    };
    const gpu = json.SPDisplaysDataType?.[0];
    if (!gpu) return null;
    return {
      available: true,
      name: gpu.sppci_model ?? "Apple GPU",
      backend: "metal",
    };
  } catch {
    return null;
  }
}

async function probeGPU(): Promise<TJGPUInfo> {
  const nvidia = await probeNvidiaGPU();
  if (nvidia) return nvidia;

  const rocm = await probeRocmGPU();
  if (rocm) return rocm;

  const apple = await probeAppleGPU();
  if (apple) return apple;

  return { available: false, backend: "none" };
}

// ─── Skills inference ────────────────────────────────────────────────────────

async function inferSkills(
  ollama: TJOllamaInfo,
  gpu: TJGPUInfo,
): Promise<TJSkillTag[]> {
  const skills = new Set<TJSkillTag>();

  if (ollama.running) {
    skills.add("ollama");
    if (gpu.available) skills.add("gpu-inference");
  }

  if (gpu.available) {
    // Check for Stable Diffusion via common ports/paths
    try {
      const sdRes = await fetch("http://localhost:7860/info", {
        signal: AbortSignal.timeout(2000),
      });
      if (sdRes.ok) skills.add("image-gen");
    } catch { /* not running */ }

    // Check for ComfyUI
    try {
      const comfyRes = await fetch("http://localhost:8188/system_stats", {
        signal: AbortSignal.timeout(2000),
      });
      if (comfyRes.ok) skills.add("image-gen");
    } catch { /* not running */ }
  }

  // Check for LM Studio
  try {
    const lmsRes = await fetch("http://localhost:1234/v1/models", {
      signal: AbortSignal.timeout(2000),
    });
    if (lmsRes.ok) skills.add("lmstudio");
  } catch { /* not running */ }

  // Check for Whisper.cpp or openai-whisper
  try {
    await run("which whisper 2>/dev/null || where whisper 2>nul", 2000);
    skills.add("transcription");
  } catch { /* not found */ }

  return Array.from(skills);
}

// ─── Latent capability detection (Phase 6) ───────────────────────────────────

/**
 * Detect Vision Wormhole codec files on disk.
 *
 * Convention: codecs live at ~/.his-and-hers/codecs/<id>.pt or <id>.gguf.
 * Codec filename must match the pattern: "vw-<arch>-v<n>" (e.g. vw-qwen3vl2b-v1).
 *
 * This is forward-looking: no production codecs exist yet (Phase 6 / experimental).
 * Returns an empty array until codec files are placed on disk.
 */
async function probeLatentCodecs(): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { homedir } = await import("node:os");
  const codecDir = join(homedir(), ".his-and-hers", "codecs");
  try {
    const files = await readdir(codecDir);
    const CODEC_RE = /^(vw-[\w]+-v\d+)\.(pt|gguf|bin|safetensors)$/;
    return files
      .map((f) => CODEC_RE.exec(f)?.[1])
      .filter((id): id is string => id !== undefined);
  } catch {
    // Directory doesn't exist yet — that's fine
    return [];
  }
}

/**
 * Detect Ollama models that are KV-cache compatible with known same-family peers.
 *
 * If Ollama is running, return a normalized list of model base IDs suitable for
 * LatentMAS (same model family, same weights). Strips tags/quantization suffixes
 * to produce a canonical ID (e.g. "llama3.2:latest" → "llama3.2").
 *
 * Tom uses this to know if he can do lossless KV-cache handoff instead of text.
 */
function inferKVCompatibleModels(ollama: TJOllamaInfo): string[] {
  if (!ollama.running || ollama.models.length === 0) return [];
  // Normalize: strip ":tag" suffix to get base model ID
  return ollama.models.map((m) => m.split(":")[0]).filter(Boolean);
}

// ─── Main export ─────────────────────────────────────────────────────────────

export interface ScanOptions {
  nodeName: string;
  wolEnabled?: boolean;
  ollamaBaseUrl?: string;
  notes?: string;
}

/**
 * Scan the local machine and return a TJCapabilityReport.
 * All probes are best-effort — never throws.
 */
export async function scanCapabilities(opts: ScanOptions): Promise<TJCapabilityReport> {
  const [ollama, gpu] = await Promise.all([
    probeOllama(opts.ollamaBaseUrl).catch(() => ({
      running: false,
      base_url: opts.ollamaBaseUrl ?? "http://localhost:11434",
      models: [] as string[],
    })),
    probeGPU().catch(() => ({ available: false, backend: "none" as const })),
  ]);

  const [skills, latent_codecs] = await Promise.all([
    inferSkills(ollama, gpu).catch(() => [] as TJSkillTag[]),
    probeLatentCodecs().catch(() => [] as string[]),
  ]);

  const kv_compatible_models = inferKVCompatibleModels(ollama);

  const latent_support = latent_codecs.length > 0 || kv_compatible_models.length > 0;

  return {
    version: "0.1.0",
    node: opts.nodeName,
    reported_at: new Date().toISOString(),
    platform: detectPlatform(),
    gpu,
    ollama,
    skills,
    notes: opts.notes,
    wol_enabled: opts.wolEnabled ?? false,
    latent_codecs,
    kv_compatible_models,
    latent_support,
  };
}
