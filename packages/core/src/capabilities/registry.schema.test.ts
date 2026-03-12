import { describe, it, expect } from "vitest";
import { TJCapabilityReport, UNKNOWN_CAPABILITIES } from "./registry.schema.ts";
import { routeTask } from "../routing.ts";

describe("TJCapabilityReport schema", () => {
  it("parses a minimal report with defaults", () => {
    const report = TJCapabilityReport.parse({
      node: "GLaDOS",
      platform: "windows",
    });
    expect(report.node).toBe("GLaDOS");
    expect(report.gpu.available).toBe(false);
    expect(report.ollama.running).toBe(false);
    expect(report.skills).toEqual([]);
    expect(report.wol_enabled).toBe(false);
    expect(report.version).toBe("0.1.0");
  });

  it("parses a full GPU report", () => {
    const report = TJCapabilityReport.parse({
      node: "GLaDOS",
      platform: "windows",
      gpu: {
        available: true,
        name: "NVIDIA RTX 3070 Ti",
        vram_gb: 8,
        backend: "cuda",
      },
      ollama: {
        running: true,
        base_url: "http://localhost:11434",
        models: ["llama3.2", "codellama:7b"],
      },
      skills: ["ollama", "gpu-inference", "image-gen"],
      wol_enabled: true,
    });

    expect(report.gpu.available).toBe(true);
    expect(report.gpu.vram_gb).toBe(8);
    expect(report.ollama.models).toContain("llama3.2");
    expect(report.skills).toContain("image-gen");
    expect(report.wol_enabled).toBe(true);
  });

  it("UNKNOWN_CAPABILITIES is a valid report", () => {
    expect(UNKNOWN_CAPABILITIES.node).toBe("unknown");
    expect(UNKNOWN_CAPABILITIES.gpu.available).toBe(false);
  });
});

describe("latent fields", () => {
  it("parses with latent_codecs populated", () => {
    const report = TJCapabilityReport.parse({
      node: "GLaDOS",
      latent_codecs: ["vw-qwen3vl2b-v1", "vw-llama3-v1"],
      latent_support: true,
    });
    expect(report.latent_codecs).toEqual(["vw-qwen3vl2b-v1", "vw-llama3-v1"]);
  });

  it("parses with kv_compatible_models populated", () => {
    const report = TJCapabilityReport.parse({
      node: "GLaDOS",
      kv_compatible_models: ["llama-3.1-70b", "qwen2.5-72b"],
      latent_support: true,
    });
    expect(report.kv_compatible_models).toEqual(["llama-3.1-70b", "qwen2.5-72b"]);
  });

  it("latent_support defaults to false", () => {
    const report = TJCapabilityReport.parse({ node: "GLaDOS" });
    expect(report.latent_support).toBe(false);
  });

  it("latent_support can be set to true", () => {
    const report = TJCapabilityReport.parse({
      node: "GLaDOS",
      latent_support: true,
      latent_codecs: ["vw-qwen3vl2b-v1"],
    });
    expect(report.latent_support).toBe(true);
  });

  it('"latent-comm" is a valid TJSkillTag', () => {
    const report = TJCapabilityReport.parse({
      node: "GLaDOS",
      skills: ["latent-comm"],
    });
    expect(report.skills).toContain("latent-comm");
  });

  it("UNKNOWN_CAPABILITIES has latent_support false and empty arrays", () => {
    expect(UNKNOWN_CAPABILITIES.latent_support).toBe(false);
    expect(UNKNOWN_CAPABILITIES.latent_codecs).toEqual([]);
    expect(UNKNOWN_CAPABILITIES.kv_compatible_models).toEqual([]);
  });
});

describe("capability-aware routing", () => {
  const peerWithGPU = TJCapabilityReport.parse({
    node: "GLaDOS",
    platform: "windows",
    gpu: { available: true, name: "RTX 3070 Ti", vram_gb: 8, backend: "cuda" },
    ollama: {
      running: true,
      base_url: "http://localhost:11434",
      models: ["llama3.2", "codellama:7b"],
    },
    skills: ["ollama", "gpu-inference", "image-gen", "transcription"],
    wol_enabled: true,
  });

  const peerNoGPU = TJCapabilityReport.parse({
    node: "WeakBox",
    platform: "linux",
  });

  it("routes image task to jerry when peer has image-gen skill", () => {
    const d = routeTask("generate an image of a sunset", peerWithGPU);
    expect(d.hint).toBe("jerry-local");
    expect(d.reason).toContain("image-gen");
  });

  it("routes transcription to jerry when peer has transcription skill", () => {
    const d = routeTask("transcribe this audio file", peerWithGPU);
    expect(d.hint).toBe("jerry-local");
    expect(d.reason).toContain("transcription");
  });

  it("routes ollama task to jerry with model suggestion", () => {
    const d = routeTask("run llama and summarize this", peerWithGPU);
    expect(d.hint).toBe("jerry-local");
    expect(d.suggested_model).toBe("llama3.2");
  });

  it("falls back to cloud for lightweight task even with GPU peer", () => {
    const d = routeTask("what's the weather today?", peerWithGPU);
    expect(d.hint).toBe("cloud");
  });

  it("routes image to cloud when peer has no image-gen skill", () => {
    const d = routeTask("generate an image of a cat", peerNoGPU);
    // Heuristic fallback: jerry-local by keyword BUT peer has no GPU
    // so falls back to cloud
    expect(d.hint).toBe("cloud");
  });

  it("uses heuristics when no peer capabilities are provided", () => {
    const d = routeTask("render a video", null);
    expect(d.hint).toBe("jerry-local");
    expect(d.reason).toContain("keyword");
  });

  it("defaults to cloud for unknown tasks without peer caps", () => {
    const d = routeTask("help me write a haiku", null);
    expect(d.hint).toBe("cloud");
  });
});

describe("TJCapabilityReport latent fields (Phase 6)", () => {
  it("defaults latent_codecs and kv_compatible_models to empty arrays", () => {
    const report = TJCapabilityReport.parse({ node: "Jerry", platform: "windows" });
    expect(report.latent_codecs).toEqual([]);
    expect(report.kv_compatible_models).toEqual([]);
  });

  it("accepts latent_codecs and kv_compatible_models", () => {
    const report = TJCapabilityReport.parse({
      node: "Jerry",
      platform: "windows",
      latent_codecs: ["vw-qwen3vl2b-v1", "vw-llama3vl-v1"],
      kv_compatible_models: ["llama3.2", "qwen2.5-72b"],
    });
    expect(report.latent_codecs).toContain("vw-qwen3vl2b-v1");
    expect(report.kv_compatible_models).toContain("llama3.2");
  });

  it("UNKNOWN_CAPABILITIES has empty latent fields", () => {
    expect(UNKNOWN_CAPABILITIES.latent_codecs).toEqual([]);
    expect(UNKNOWN_CAPABILITIES.kv_compatible_models).toEqual([]);
  });
});

describe("latent routing (Phase 6)", () => {
  const peerWithVisionWormhole = TJCapabilityReport.parse({
    node: "GLaDOS",
    platform: "windows",
    gpu: { available: true, name: "RTX 3070 Ti", vram_gb: 8, backend: "cuda" },
    latent_codecs: ["vw-qwen3vl2b-v1"],
    kv_compatible_models: [],
  });

  const peerWithKVCache = TJCapabilityReport.parse({
    node: "GLaDOS",
    platform: "windows",
    gpu: { available: true, name: "RTX 3070 Ti", vram_gb: 8, backend: "cuda" },
    latent_codecs: [],
    kv_compatible_models: ["llama3.2", "codellama"],
  });

  const peerNoLatent = TJCapabilityReport.parse({
    node: "GLaDOS",
    platform: "windows",
    gpu: { available: true, name: "RTX 3070 Ti", vram_gb: 8, backend: "cuda" },
    ollama: { running: true, base_url: "http://localhost:11434", models: ["llama3.2"] },
    skills: ["ollama", "gpu-inference"],
  });

  it("routes complex reasoning tasks to jerry-latent via Vision Wormhole", () => {
    const d = routeTask("reason step by step through this complex math proof", peerWithVisionWormhole);
    expect(d.hint).toBe("jerry-latent");
    expect(d.latent_codec).toBe("vw-qwen3vl2b-v1");
    expect(d.reason).toContain("Vision Wormhole");
  });

  it("routes complex tasks to jerry-latent via KV cache path", () => {
    const d = routeTask("analyze and refactor this large codebase architecture", peerWithKVCache);
    expect(d.hint).toBe("jerry-latent");
    expect(d.kv_model).toBe("llama3.2");
    expect(d.reason).toContain("LatentMAS");
  });

  it("does NOT route trivial tasks to latent (too short / not latent-worthy)", () => {
    const d = routeTask("hi", peerWithVisionWormhole);
    // Too short — falls through to capability routing, peer has no image/ollama skill
    expect(d.hint).toBe("cloud");
  });

  it("does NOT route lightweight tasks to latent even with codec", () => {
    const d = routeTask("what's the weather", peerWithVisionWormhole);
    expect(d.hint).toBe("cloud");
  });

  it("falls back to text routing when peer has no latent capability", () => {
    const d = routeTask("reason step by step through this complex proof deduce the answer", peerNoLatent);
    // No latent caps — routes to ollama/cloud
    expect(d.hint).not.toBe("jerry-latent");
  });

  it("routes multi-step code generation to latent", () => {
    const d = routeTask("generate a complete module with classes for this complex design pattern", peerWithVisionWormhole);
    expect(d.hint).toBe("jerry-latent");
  });

  it("RoutingDecision has latent_codec field only on latent routes", () => {
    const latent = routeTask("reason step by step through this theorem and deduce the result", peerWithVisionWormhole);
    const text = routeTask("what's the weather today?", peerWithVisionWormhole);
    expect(latent.latent_codec).toBeDefined();
    expect(text.latent_codec).toBeUndefined();
  });
});
