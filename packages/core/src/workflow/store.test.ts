/**
 * workflow/store.test.ts
 *
 * Unit tests for the workflow CRUD store.
 * All file I/O is mocked — no real disk writes.
 *
 * Phase 8a — Calcifer
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadWorkflows,
  saveWorkflows,
  addWorkflow,
  removeWorkflow,
  findWorkflow,
  recordWorkflowRun,
  workflowToPipelineDefinition,
  type HHWorkflow,
  type AddWorkflowInput,
} from "./store.ts";

// ─── Mock fs/promises ────────────────────────────────────────────────────────

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockExistsSync = vi.mocked(existsSync);

// ─── Fixtures ────────────────────────────────────────────────────────────────

const STEP_A = { peer: "glados", task: "write tests for {{feature}}" };
const STEP_B = { peer: "piper", task: "review {{previous.output}}" };

const WORKFLOW_A: HHWorkflow = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  name: "code-review",
  spec: "glados:write tests -> piper:review {{previous.output}}",
  steps: [STEP_A, STEP_B],
  created_at: "2026-03-15T00:00:00.000Z",
  run_count: 0,
};

const WORKFLOW_B: HHWorkflow = {
  id: "bbbbbbbb-0000-0000-0000-000000000002",
  name: "daily-brief",
  description: "Morning summary pipeline",
  steps: [{ peer: "glados", task: "summarise overnight logs" }],
  created_at: "2026-03-15T01:00:00.000Z",
  run_count: 3,
  last_run_at: "2026-03-15T08:00:00.000Z",
};

function seedStore(workflows: HHWorkflow[]): void {
  mockExistsSync.mockReturnValue(true);
  mockReadFile.mockResolvedValue(JSON.stringify(workflows) as any);
}

function emptyStore(): void {
  mockExistsSync.mockReturnValue(false);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── loadWorkflows ────────────────────────────────────────────────────────────

describe("loadWorkflows", () => {
  it("returns [] when the file does not exist", async () => {
    emptyStore();
    expect(await loadWorkflows()).toEqual([]);
  });

  it("returns [] when the file contains invalid JSON", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue("not-json" as any);
    expect(await loadWorkflows()).toEqual([]);
  });

  it("parses a valid workflow list", async () => {
    seedStore([WORKFLOW_A, WORKFLOW_B]);
    const result = await loadWorkflows();
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("code-review");
    expect(result[1].name).toBe("daily-brief");
  });

  it("defaults run_count to 0 when missing", async () => {
    const raw = { ...WORKFLOW_A } as any;
    delete raw.run_count;
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(JSON.stringify([raw]) as any);
    const [wf] = await loadWorkflows();
    expect(wf.run_count).toBe(0);
  });
});

// ─── addWorkflow ──────────────────────────────────────────────────────────────

describe("addWorkflow", () => {
  it("persists a new workflow and returns it", async () => {
    emptyStore();
    const input: AddWorkflowInput = {
      name: "code-review",
      steps: [STEP_A, STEP_B],
      spec: "glados:write tests -> piper:review",
      description: "Automated code review pipeline",
    };
    const wf = await addWorkflow(input);
    expect(wf.name).toBe("code-review");
    expect(wf.steps).toHaveLength(2);
    expect(wf.spec).toBe("glados:write tests -> piper:review");
    expect(wf.description).toBe("Automated code review pipeline");
    expect(wf.run_count).toBe(0);
    expect(wf.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(mockWriteFile).toHaveBeenCalledOnce();
  });

  it("throws on duplicate name (case-insensitive)", async () => {
    seedStore([WORKFLOW_A]);
    await expect(
      addWorkflow({ name: "Code-Review", steps: [STEP_A] }),
    ).rejects.toThrow(/already exists/);
  });

  it("stores optional timeout", async () => {
    emptyStore();
    const wf = await addWorkflow({ name: "w", steps: [STEP_A], timeout: 60 });
    expect(wf.timeout).toBe(60);
  });
});

// ─── removeWorkflow ───────────────────────────────────────────────────────────

describe("removeWorkflow", () => {
  it("removes by name and returns the workflow", async () => {
    seedStore([WORKFLOW_A, WORKFLOW_B]);
    const removed = await removeWorkflow("code-review");
    expect(removed).not.toBeNull();
    expect(removed!.name).toBe("code-review");
    const saved = JSON.parse((mockWriteFile.mock.calls[0][1] as string));
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe("daily-brief");
  });

  it("removes by full UUID", async () => {
    seedStore([WORKFLOW_A, WORKFLOW_B]);
    const removed = await removeWorkflow("aaaaaaaa-0000-0000-0000-000000000001");
    expect(removed!.name).toBe("code-review");
  });

  it("removes by UUID prefix", async () => {
    seedStore([WORKFLOW_A, WORKFLOW_B]);
    const removed = await removeWorkflow("aaaaaaaa");
    expect(removed!.name).toBe("code-review");
  });

  it("returns null when name not found", async () => {
    seedStore([WORKFLOW_A]);
    const removed = await removeWorkflow("nonexistent");
    expect(removed).toBeNull();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});

// ─── findWorkflow ─────────────────────────────────────────────────────────────

describe("findWorkflow", () => {
  it("finds by name (case-insensitive)", async () => {
    seedStore([WORKFLOW_A, WORKFLOW_B]);
    const wf = await findWorkflow("DAILY-BRIEF");
    expect(wf).not.toBeNull();
    expect(wf!.name).toBe("daily-brief");
  });

  it("finds by UUID prefix", async () => {
    seedStore([WORKFLOW_A, WORKFLOW_B]);
    const wf = await findWorkflow("bbbbbbbb");
    expect(wf!.name).toBe("daily-brief");
  });

  it("returns null when not found", async () => {
    seedStore([WORKFLOW_A]);
    expect(await findWorkflow("ghost")).toBeNull();
  });
});

// ─── recordWorkflowRun ────────────────────────────────────────────────────────

describe("recordWorkflowRun", () => {
  it("increments run_count and sets last_run_at", async () => {
    seedStore([WORKFLOW_A]);
    await recordWorkflowRun("code-review");
    const saved: HHWorkflow[] = JSON.parse((mockWriteFile.mock.calls[0][1] as string));
    expect(saved[0].run_count).toBe(1);
    expect(saved[0].last_run_at).toBeTruthy();
  });

  it("increments from existing run_count", async () => {
    seedStore([WORKFLOW_B]); // run_count: 3
    await recordWorkflowRun("daily-brief");
    const saved: HHWorkflow[] = JSON.parse((mockWriteFile.mock.calls[0][1] as string));
    expect(saved[0].run_count).toBe(4);
  });

  it("is a no-op when workflow not found", async () => {
    seedStore([WORKFLOW_A]);
    await recordWorkflowRun("ghost");
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});

// ─── workflowToPipelineDefinition ─────────────────────────────────────────────

describe("workflowToPipelineDefinition", () => {
  it("converts a workflow to a PipelineDefinition", () => {
    const def = workflowToPipelineDefinition(WORKFLOW_A);
    expect(def.name).toBe("code-review");
    expect(def.steps).toHaveLength(2);
    expect(def.steps[0].peer).toBe("glados");
    expect(def.steps[1].peer).toBe("piper");
  });

  it("includes description when present", () => {
    const def = workflowToPipelineDefinition(WORKFLOW_B);
    expect(def.description).toBe("Morning summary pipeline");
  });

  it("produces undefined description when absent", () => {
    const def = workflowToPipelineDefinition(WORKFLOW_A);
    expect(def.description).toBeUndefined();
  });
});

// ─── Schema validation ────────────────────────────────────────────────────────

describe("HHWorkflowSchema validation", () => {
  it("rejects a workflow with empty steps", async () => {
    const bad = [{ ...WORKFLOW_A, steps: "not-an-array" }];
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(JSON.stringify(bad) as any);
    // loadWorkflows returns [] on parse failure
    expect(await loadWorkflows()).toEqual([]);
  });

  it("accepts optional fields being absent", async () => {
    const minimal: HHWorkflow = {
      id: "cccccccc-0000-0000-0000-000000000003",
      name: "minimal",
      steps: [{ peer: "glados", task: "hello" }],
      created_at: "2026-03-15T00:00:00.000Z",
      run_count: 0,
    };
    seedStore([minimal]);
    const [wf] = await loadWorkflows();
    expect(wf.description).toBeUndefined();
    expect(wf.spec).toBeUndefined();
    expect(wf.timeout).toBeUndefined();
    expect(wf.last_run_at).toBeUndefined();
  });
});
