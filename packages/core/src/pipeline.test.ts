/**
 * core/pipeline.test.ts — Unit tests for pipeline utilities
 *
 * Phase 7e — Calcifer ✅ (2026-03-15)
 */

import { describe, it, expect } from "vitest";
import {
  interpolatePipelineTask,
  parsePipelineSpec,
  parsePipelineFile,
  type PipelineStepResult,
} from "./pipeline.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResult(
  idx: number,
  output?: string,
  error?: string,
): PipelineStepResult {
  return {
    stepIndex: idx,
    label: `step${idx + 1}`,
    peer: "glados",
    task_id: `t-${idx}`,
    status: output ? "completed" : error ? "failed" : "timeout",
    output,
    error,
  };
}

// ─── interpolatePipelineTask ──────────────────────────────────────────────────

describe("interpolatePipelineTask", () => {
  it("returns template unchanged when no placeholders", () => {
    const results: PipelineStepResult[] = [];
    expect(interpolatePipelineTask("do something", results)).toBe("do something");
  });

  it("replaces {{previous.output}} with last completed step output", () => {
    const results = [makeResult(0, "hello world")];
    const out = interpolatePipelineTask("use this: {{previous.output}}", results);
    expect(out).toBe("use this: hello world");
  });

  it("{{previous.output}} resolves to empty string when no results", () => {
    const out = interpolatePipelineTask("{{previous.output}}", []);
    expect(out).toBe("");
  });

  it("{{previous.output}} skips failed steps without output", () => {
    const results = [makeResult(0, "step0 output"), makeResult(1, undefined, "boom")];
    const out = interpolatePipelineTask("{{previous.output}}", results);
    // last step with output is index 0
    expect(out).toBe("step0 output");
  });

  it("replaces {{previous.error}}", () => {
    const results = [makeResult(0, undefined, "timeout error")];
    const out = interpolatePipelineTask("retry: {{previous.error}}", results);
    expect(out).toBe("retry: timeout error");
  });

  it("replaces {{steps.1.output}} with index 0 result (1-based)", () => {
    const results = [makeResult(0, "first"), makeResult(1, "second")];
    const out = interpolatePipelineTask("{{steps.1.output}} and {{steps.2.output}}", results);
    expect(out).toBe("first and second");
  });

  it("{{steps.N.output}} returns empty string for out-of-range index", () => {
    const results = [makeResult(0, "only")];
    const out = interpolatePipelineTask("{{steps.5.output}}", results);
    expect(out).toBe("");
  });

  it("replaces {{steps.N.error}}", () => {
    const results = [makeResult(0, undefined, "err-msg")];
    const out = interpolatePipelineTask("{{steps.1.error}}", results);
    expect(out).toBe("err-msg");
  });

  it("handles multiple placeholders in one template", () => {
    const results = [makeResult(0, "A"), makeResult(1, "B")];
    const out = interpolatePipelineTask(
      "first={{steps.1.output}}, second={{steps.2.output}}, last={{previous.output}}",
      results,
    );
    expect(out).toBe("first=A, second=B, last=B");
  });

  it("replaces all occurrences of the same placeholder", () => {
    const results = [makeResult(0, "X")];
    const out = interpolatePipelineTask(
      "{{previous.output}} and again {{previous.output}}",
      results,
    );
    expect(out).toBe("X and again X");
  });
});

// ─── parsePipelineSpec ────────────────────────────────────────────────────────

describe("parsePipelineSpec", () => {
  it("parses a single step", () => {
    const steps = parsePipelineSpec("glados:write unit tests");
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ peer: "glados", task: "write unit tests" });
  });

  it("parses multiple steps separated by ->", () => {
    const steps = parsePipelineSpec("h2:generate code -> h3:review code -> h4:deploy");
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatchObject({ peer: "h2", task: "generate code" });
    expect(steps[1]).toMatchObject({ peer: "h3", task: "review code" });
    expect(steps[2]).toMatchObject({ peer: "h4", task: "deploy" });
  });

  it("handles extra whitespace around ->", () => {
    const steps = parsePipelineSpec("h1:task one   ->   h2:task two");
    expect(steps).toHaveLength(2);
    expect(steps[0].peer).toBe("h1");
    expect(steps[1].peer).toBe("h2");
  });

  it("throws for empty spec", () => {
    expect(() => parsePipelineSpec("")).toThrow("at least one step");
  });

  it("throws for step missing colon", () => {
    expect(() => parsePipelineSpec("glados write unit tests")).toThrow("peer:task");
  });

  it("throws for step with empty peer", () => {
    expect(() => parsePipelineSpec(":some task")).toThrow("peer name is empty");
  });

  it("throws for step with empty task", () => {
    expect(() => parsePipelineSpec("glados:")).toThrow("task text is empty");
  });

  it("preserves task text containing colons", () => {
    // Only the FIRST colon is the peer:task separator
    const steps = parsePipelineSpec("glados:run this: npm test");
    expect(steps[0].task).toBe("run this: npm test");
  });

  it("preserves {{previous.output}} placeholder in task text", () => {
    const steps = parsePipelineSpec("h2:review: {{previous.output}}");
    expect(steps[0].task).toContain("{{previous.output}}");
  });
});

// ─── parsePipelineFile ────────────────────────────────────────────────────────

describe("parsePipelineFile", () => {
  const validJson = JSON.stringify({
    name: "My Pipeline",
    steps: [
      { peer: "glados", task: "step one" },
      { peer: "piper", task: "step two", timeout: 60, continueOnError: true },
    ],
  });

  it("parses a valid JSON pipeline file", () => {
    const def = parsePipelineFile(validJson, "pipeline.json");
    expect(def.name).toBe("My Pipeline");
    expect(def.steps).toHaveLength(2);
    expect(def.steps[1].continueOnError).toBe(true);
    expect(def.steps[1].timeout).toBe(60);
  });

  it("throws for invalid JSON", () => {
    expect(() => parsePipelineFile("{bad json", "pipeline.json")).toThrow("Failed to parse");
  });

  it("throws when steps is missing", () => {
    expect(() =>
      parsePipelineFile(JSON.stringify({ name: "bad" }), "pipeline.json"),
    ).toThrow("'steps' must be a non-empty array");
  });

  it("throws when steps is empty", () => {
    expect(() =>
      parsePipelineFile(JSON.stringify({ steps: [] }), "pipeline.json"),
    ).toThrow("'steps' must be a non-empty array");
  });

  it("throws for step missing peer", () => {
    expect(() =>
      parsePipelineFile(
        JSON.stringify({ steps: [{ task: "do thing" }] }),
        "pipeline.json",
      ),
    ).toThrow("missing 'peer'");
  });

  it("throws for step missing task", () => {
    expect(() =>
      parsePipelineFile(
        JSON.stringify({ steps: [{ peer: "glados" }] }),
        "pipeline.json",
      ),
    ).toThrow("missing 'task'");
  });

  it("throws for YAML files (not yet supported)", () => {
    expect(() =>
      parsePipelineFile("name: My Pipeline\nsteps:\n  - peer: glados", "pipeline.yaml"),
    ).toThrow("YAML pipeline files are not yet supported");
  });

  it("parses optional description field", () => {
    const def = parsePipelineFile(
      JSON.stringify({ description: "test pipe", steps: [{ peer: "glados", task: "go" }] }),
      "pipeline.json",
    );
    expect(def.description).toBe("test pipe");
  });
});
