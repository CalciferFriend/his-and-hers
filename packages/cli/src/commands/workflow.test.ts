/**
 * commands/workflow.test.ts
 *
 * Tests for the `cofounder workflow` command handlers.
 * Core store is fully mocked; tests exercise the CLI presentation layer.
 *
 * Phase 8a — Calcifer
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { workflowAdd, workflowList, workflowShow, workflowRemove, workflowRun } from "./workflow.ts";

// ─── Mock @cofounder/core ──────────────────────────────────────────────────

vi.mock("@cofounder/core", async () => {
  const actual = await vi.importActual<typeof import("@cofounder/core")>("@cofounder/core");
  return {
    ...actual,
    // Store operations — overridden per test
    loadWorkflows: vi.fn(),
    addWorkflow: vi.fn(),
    removeWorkflow: vi.fn(),
    findWorkflow: vi.fn(),
    recordWorkflowRun: vi.fn().mockResolvedValue(undefined),
    workflowToPipelineDefinition: vi.fn(),
  };
});

// ─── Mock pipeline command ────────────────────────────────────────────────────

vi.mock("./pipeline.ts", () => ({
  pipeline: vi.fn().mockResolvedValue(undefined),
}));

// ─── Mock @clack/prompts ──────────────────────────────────────────────────────

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  confirm: vi.fn().mockResolvedValue(true),
  isCancel: vi.fn().mockReturnValue(false),
}));

import * as core from "@cofounder/core";
import * as p from "@clack/prompts";
import { pipeline as mockPipeline } from "./pipeline.ts";

const mockLoadWorkflows = vi.mocked(core.loadWorkflows);
const mockAddWorkflow = vi.mocked(core.addWorkflow);
const mockRemoveWorkflow = vi.mocked(core.removeWorkflow);
const mockFindWorkflow = vi.mocked(core.findWorkflow);
const mockWorkflowToDefinition = vi.mocked(core.workflowToPipelineDefinition);
const mockPipelineRun = vi.mocked(mockPipeline);

// ─── Fixtures ────────────────────────────────────────────────────────────────

const WF_A = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  name: "code-review",
  spec: "glados:write tests -> piper:review {{previous.output}}",
  steps: [
    { peer: "glados", task: "write tests for the feature" },
    { peer: "piper", task: "review {{previous.output}}" },
  ],
  created_at: "2026-03-15T00:00:00.000Z",
  run_count: 0,
};

const WF_B = {
  id: "bbbbbbbb-0000-0000-0000-000000000002",
  name: "daily-brief",
  description: "Morning summary pipeline",
  steps: [{ peer: "glados", task: "summarise overnight logs" }],
  created_at: "2026-03-15T01:00:00.000Z",
  run_count: 5,
  last_run_at: "2026-03-15T08:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = undefined;
  // Suppress console output during tests
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ─── workflowAdd ──────────────────────────────────────────────────────────────

describe("workflowAdd", () => {
  it("saves a workflow from an inline spec", async () => {
    mockAddWorkflow.mockResolvedValue(WF_A as any);
    await workflowAdd({
      name: "code-review",
      spec: "glados:write tests -> piper:review {{previous.output}}",
    });
    expect(mockAddWorkflow).toHaveBeenCalledOnce();
    const call = mockAddWorkflow.mock.calls[0][0];
    expect(call.name).toBe("code-review");
    expect(call.spec).toBe("glados:write tests -> piper:review {{previous.output}}");
    expect(call.steps).toHaveLength(2);
    expect(p.log.success).toHaveBeenCalled();
  });

  it("rejects an invalid name", async () => {
    await workflowAdd({ name: "bad name!", spec: "glados:task" });
    expect(mockAddWorkflow).not.toHaveBeenCalled();
    expect(p.log.error).toHaveBeenCalled();
  });

  it("rejects when neither spec nor file is provided", async () => {
    await workflowAdd({ name: "test" });
    expect(mockAddWorkflow).not.toHaveBeenCalled();
    expect(p.log.error).toHaveBeenCalled();
  });

  it("rejects when both spec and file are provided", async () => {
    await workflowAdd({ name: "test", spec: "glados:task", file: "some.json" });
    expect(mockAddWorkflow).not.toHaveBeenCalled();
    expect(p.log.error).toHaveBeenCalled();
  });

  it("reports error when addWorkflow throws (duplicate)", async () => {
    mockAddWorkflow.mockRejectedValue(new Error("already exists"));
    await workflowAdd({ name: "code-review", spec: "glados:task" });
    expect(p.log.error).toHaveBeenCalledWith(expect.stringContaining("already exists"));
  });

  it("reports error on invalid inline spec", async () => {
    await workflowAdd({ name: "bad", spec: "no-colon-separator" });
    expect(mockAddWorkflow).not.toHaveBeenCalled();
    expect(p.log.error).toHaveBeenCalled();
  });
});

// ─── workflowList ─────────────────────────────────────────────────────────────

describe("workflowList", () => {
  it("prints a message when no workflows exist", async () => {
    mockLoadWorkflows.mockResolvedValue([]);
    await workflowList({});
    expect(p.log.info).toHaveBeenCalled();
  });

  it("prints workflow names when present", async () => {
    mockLoadWorkflows.mockResolvedValue([WF_A, WF_B] as any);
    await workflowList({});
    // console.log should have been called with the list content
    expect(console.log).toHaveBeenCalled();
  });

  it("outputs JSON when --json", async () => {
    mockLoadWorkflows.mockResolvedValue([WF_A] as any);
    await workflowList({ json: true });
    const output = (console.log as any).mock.calls.flat().join("\n");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("code-review");
  });
});

// ─── workflowShow ─────────────────────────────────────────────────────────────

describe("workflowShow", () => {
  it("shows workflow details", async () => {
    mockFindWorkflow.mockResolvedValue(WF_A as any);
    await workflowShow("code-review", {});
    expect(console.log).toHaveBeenCalled();
  });

  it("sets exitCode on not found", async () => {
    mockFindWorkflow.mockResolvedValue(null);
    await workflowShow("ghost", {});
    expect(process.exitCode).toBe(1);
  });

  it("outputs JSON when --json", async () => {
    mockFindWorkflow.mockResolvedValue(WF_B as any);
    await workflowShow("daily-brief", { json: true });
    const output = (console.log as any).mock.calls.flat().join("\n");
    const parsed = JSON.parse(output);
    expect(parsed.name).toBe("daily-brief");
  });
});

// ─── workflowRemove ───────────────────────────────────────────────────────────

describe("workflowRemove", () => {
  it("removes with --force (no confirmation prompt)", async () => {
    mockFindWorkflow.mockResolvedValue(WF_A as any);
    mockRemoveWorkflow.mockResolvedValue(WF_A as any);
    await workflowRemove("code-review", { force: true });
    expect(p.confirm).not.toHaveBeenCalled();
    expect(mockRemoveWorkflow).toHaveBeenCalledWith("code-review");
    expect(p.log.success).toHaveBeenCalled();
  });

  it("prompts for confirmation without --force", async () => {
    mockFindWorkflow.mockResolvedValue(WF_A as any);
    mockRemoveWorkflow.mockResolvedValue(WF_A as any);
    vi.mocked(p.confirm).mockResolvedValue(true);
    await workflowRemove("code-review", {});
    expect(p.confirm).toHaveBeenCalled();
    expect(mockRemoveWorkflow).toHaveBeenCalled();
  });

  it("cancels when user declines confirmation", async () => {
    mockFindWorkflow.mockResolvedValue(WF_A as any);
    vi.mocked(p.confirm).mockResolvedValue(false);
    await workflowRemove("code-review", {});
    expect(mockRemoveWorkflow).not.toHaveBeenCalled();
  });

  it("sets exitCode when workflow not found", async () => {
    mockFindWorkflow.mockResolvedValue(null);
    await workflowRemove("ghost", { force: true });
    expect(process.exitCode).toBe(1);
  });

  it("outputs JSON on success", async () => {
    mockFindWorkflow.mockResolvedValue(WF_A as any);
    mockRemoveWorkflow.mockResolvedValue(WF_A as any);
    await workflowRemove("code-review", { force: true, json: true });
    const output = (console.log as any).mock.calls.flat().join("\n");
    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(true);
    expect(parsed.removed).toBe("code-review");
  });

  it("outputs JSON error when not found", async () => {
    mockFindWorkflow.mockResolvedValue(null);
    await workflowRemove("ghost", { force: true, json: true });
    const output = (console.log as any).mock.calls.flat().join("\n");
    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(false);
  });
});

// ─── workflowRun ──────────────────────────────────────────────────────────────

describe("workflowRun", () => {
  it("delegates to pipeline command", async () => {
    mockFindWorkflow.mockResolvedValue(WF_A as any);
    mockWorkflowToDefinition.mockReturnValue({
      name: "code-review",
      steps: WF_A.steps,
    });
    await workflowRun("code-review", {});
    expect(mockPipelineRun).toHaveBeenCalled();
    expect(core.recordWorkflowRun).toHaveBeenCalledWith("code-review");
  });

  it("passes timeout override to pipeline", async () => {
    mockFindWorkflow.mockResolvedValue(WF_A as any);
    mockWorkflowToDefinition.mockReturnValue({ name: "code-review", steps: WF_A.steps });
    await workflowRun("code-review", { timeout: "90" });
    const pipelineCall = mockPipelineRun.mock.calls[0];
    // The second argument contains our options
    expect(pipelineCall[1]).toMatchObject({ timeout: "90" });
  });

  it("uses workflow default timeout when no override", async () => {
    const wfWithTimeout = { ...WF_A, timeout: 45 };
    mockFindWorkflow.mockResolvedValue(wfWithTimeout as any);
    mockWorkflowToDefinition.mockReturnValue({ name: "code-review", steps: WF_A.steps });
    await workflowRun("code-review", {});
    const pipelineCall = mockPipelineRun.mock.calls[0];
    expect(pipelineCall[1]).toMatchObject({ timeout: "45" });
  });

  it("sets exitCode when workflow not found", async () => {
    mockFindWorkflow.mockResolvedValue(null);
    await workflowRun("ghost", {});
    expect(process.exitCode).toBe(1);
    expect(mockPipelineRun).not.toHaveBeenCalled();
  });

  it("records run even when pipeline succeeds", async () => {
    mockFindWorkflow.mockResolvedValue(WF_A as any);
    mockWorkflowToDefinition.mockReturnValue({ name: "code-review", steps: WF_A.steps });
    mockPipelineRun.mockResolvedValueOnce(undefined);
    await workflowRun("code-review", {});
    expect(core.recordWorkflowRun).toHaveBeenCalledWith("code-review");
  });
});
