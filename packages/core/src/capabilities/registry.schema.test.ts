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
