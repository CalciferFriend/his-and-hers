import { describe, it, expect } from "vitest";
import { routeTask } from "./routing.ts";
import { HHCapabilityReport, UNKNOWN_CAPABILITIES } from "./capabilities/registry.schema.ts";

const latentPeer = HHCapabilityReport.parse({
  node: "GLaDOS",
  platform: "linux",
  latent_support: true,
  latent_codecs: ["vw-qwen3vl2b-v1"],
  gpu: { available: true, name: "RTX 4090", vram_gb: 24, backend: "cuda" },
});

const noLatentPeer = HHCapabilityReport.parse({
  node: "WeakBox",
  platform: "linux",
  latent_support: false,
  latent_codecs: [],
});

describe("h2-latent routing", () => {
  it('routeTask() returns "h2-latent" when peer has latent_support=true, codecs set, and task > 5 words', () => {
    const decision = routeTask("please analyze this complex data structure thoroughly", latentPeer);
    expect(decision.hint).toBe("h2-latent");
  });

  it('routeTask() returns "cloud" when peer has no latent_support, even for long tasks', () => {
    const decision = routeTask("please analyze this complex data structure thoroughly", noLatentPeer);
    expect(decision.hint).toBe("cloud");
  });

  it("codec_id is set correctly in a latent RoutingDecision", () => {
    const decision = routeTask("can you please help me analyze this document carefully", latentPeer);
    expect(decision.hint).toBe("h2-latent");
    expect(decision.codec_id).toBe("vw-qwen3vl2b-v1");
  });

  it("heuristic routing (no peer capabilities) never returns h2-latent", () => {
    // Try various task types — none should return h2-latent
    const tasks = [
      "analyze this complex document and reason step by step about the findings",
      "prove this mathematical theorem using chain of thought",
      "generate code for a complex architecture with detailed explanation",
      "refactor this large module with comprehensive analysis",
      "transcribe this audio file",
    ];
    for (const task of tasks) {
      const decision = routeTask(task, null);
      expect(decision.hint).not.toBe("h2-latent");
    }
  });

  it("UNKNOWN_CAPABILITIES peer falls back to heuristic routing, not h2-latent", () => {
    // UNKNOWN_CAPABILITIES has node === "unknown", so routeTask uses heuristic
    const decision = routeTask("analyze this thoroughly with step by step reasoning", UNKNOWN_CAPABILITIES);
    expect(decision.hint).not.toBe("h2-latent");
    // Heuristic should use keyword matching
    expect(["cloud", "h2-local", "local"]).toContain(decision.hint);
  });
});
