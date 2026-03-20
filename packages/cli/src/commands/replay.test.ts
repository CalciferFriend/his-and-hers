/**
 * replay.test.ts — unit tests for `cofounder replay`
 *
 * Tests the resolveTask helper (via spying on state), dry-run flow, peer
 * override logic, and error paths. The actual `send()` call is mocked so
 * these tests stay fast and side-effect-free.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks (vi.hoisted ensures vars are available when factories run)
// ---------------------------------------------------------------------------

const { mockLoadConfig, mockLoadTaskState, mockListTaskStates, mockSend } = vi.hoisted(() => ({
  mockLoadConfig: vi.fn(),
  mockLoadTaskState: vi.fn(),
  mockListTaskStates: vi.fn(),
  mockSend: vi.fn(),
}));

vi.mock("../config/store.ts", () => ({ loadConfig: mockLoadConfig }));
vi.mock("../state/tasks.ts", () => ({
  loadTaskState: mockLoadTaskState,
  listTaskStates: mockListTaskStates,
}));
vi.mock("./send.ts", () => ({ send: mockSend }));

// Silence @clack/prompts output during tests
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), step: vi.fn() },
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

import type { TaskState } from "../state/tasks.ts";
import { replay } from "./replay.ts";

const TASK: TaskState = {
  id: "abc123def456",
  from: "calcifer",
  to: "glados",
  objective: "Summarise the quarterly report",
  constraints: ["max 200 words", "bullet points"],
  status: "failed",
  created_at: "2026-03-13T12:00:00Z",
  updated_at: "2026-03-13T12:05:00Z",
  result: null,
};

const CONFIG = { this_node: { name: "calcifer" }, peer_node: { name: "glados" } };

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadConfig.mockResolvedValue(CONFIG);
  mockLoadTaskState.mockResolvedValue(null); // default: not found by exact
  mockListTaskStates.mockResolvedValue([]);
  mockSend.mockResolvedValue(undefined);
  // Suppress process.exitCode side-effects
  process.exitCode = undefined;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cofounder replay — no config", () => {
  it("prints error and sets exitCode when config missing", async () => {
    mockLoadConfig.mockResolvedValue(null);
    await replay("abc123");
    expect(process.exitCode).toBe(1);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("cofounder replay — task not found", () => {
  it("prints error and sets exitCode when task ID not found", async () => {
    mockLoadTaskState.mockResolvedValue(null);
    mockListTaskStates.mockResolvedValue([]);
    await replay("notexist");
    expect(process.exitCode).toBe(1);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("cofounder replay — exact match", () => {
  it("calls send() with the original objective when task found by exact ID", async () => {
    mockLoadTaskState.mockResolvedValue(TASK);
    await replay("abc123def456");
    expect(mockSend).toHaveBeenCalledOnce();
    const [taskText, sendOpts] = mockSend.mock.calls[0] as [string, Record<string, unknown>];
    expect(taskText).toContain("Summarise the quarterly report");
    expect(sendOpts.peer).toBe("glados");
    expect(sendOpts.force).toBe(true);
  });

  it("appends constraints to the task text", async () => {
    mockLoadTaskState.mockResolvedValue(TASK);
    await replay("abc123def456");
    const [taskText] = mockSend.mock.calls[0] as [string, Record<string, unknown>];
    expect(taskText).toContain("max 200 words");
    expect(taskText).toContain("bullet points");
  });
});

describe("cofounder replay — prefix match", () => {
  it("falls back to prefix scan when exact match returns null", async () => {
    mockLoadTaskState.mockResolvedValue(null);
    mockListTaskStates.mockResolvedValue([TASK]);
    await replay("abc123");
    expect(mockListTaskStates).toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it("returns not-found error when prefix doesn't match any task", async () => {
    mockLoadTaskState.mockResolvedValue(null);
    mockListTaskStates.mockResolvedValue([TASK]);
    await replay("zzzzzz");
    expect(process.exitCode).toBe(1);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("cofounder replay — peer override", () => {
  it("passes overridden peer to send()", async () => {
    mockLoadTaskState.mockResolvedValue(TASK);
    await replay("abc123def456", { peer: "gpu-rig" });
    const [, sendOpts] = mockSend.mock.calls[0] as [string, Record<string, unknown>];
    expect(sendOpts.peer).toBe("gpu-rig");
  });
});

describe("cofounder replay — --wait flag", () => {
  it("passes wait=true to send()", async () => {
    mockLoadTaskState.mockResolvedValue(TASK);
    await replay("abc123def456", { wait: true, waitTimeoutSeconds: "120" });
    const [, sendOpts] = mockSend.mock.calls[0] as [string, Record<string, unknown>];
    expect(sendOpts.wait).toBe(true);
    expect(sendOpts.waitTimeoutSeconds).toBe("120");
  });
});

describe("cofounder replay — dry-run", () => {
  it("does not call send() when --dry-run is set", async () => {
    mockLoadTaskState.mockResolvedValue(TASK);
    await replay("abc123def456", { dryRun: true });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("outputs JSON plan when --dry-run --json is set", async () => {
    mockLoadTaskState.mockResolvedValue(TASK);
    const written: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      if (typeof chunk === "string") written.push(chunk);
      return true;
    });

    await replay("abc123def456", { dryRun: true, json: true });

    process.stdout.write = origWrite;

    expect(written.length).toBeGreaterThan(0);
    const plan = JSON.parse(written.join("")) as {
      action: string;
      original_task_id: string;
      objective: string;
      to: string;
    };
    expect(plan.action).toBe("replay");
    expect(plan.original_task_id).toBe(TASK.id);
    expect(plan.objective).toBe(TASK.objective);
    expect(plan.to).toBe("glados");
  });

  it("includes peer override in dry-run JSON", async () => {
    mockLoadTaskState.mockResolvedValue(TASK);
    const written: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      if (typeof chunk === "string") written.push(chunk);
      return true;
    });

    await replay("abc123def456", { dryRun: true, json: true, peer: "gpu-rig" });

    const plan = JSON.parse(written.join("")) as { to: string };
    expect(plan.to).toBe("gpu-rig");
  });
});

describe("cofounder replay — notify passthrough", () => {
  it("passes notify URL to send()", async () => {
    mockLoadTaskState.mockResolvedValue(TASK);
    await replay("abc123def456", { notify: "https://discord.com/api/webhooks/123/abc" });
    const [, sendOpts] = mockSend.mock.calls[0] as [string, Record<string, unknown>];
    expect(sendOpts.notify).toBe("https://discord.com/api/webhooks/123/abc");
  });
});

describe("cofounder replay — task with no constraints", () => {
  it("sends just the objective when constraints array is empty", async () => {
    const simpleTask: TaskState = { ...TASK, constraints: [] };
    mockLoadTaskState.mockResolvedValue(simpleTask);
    await replay("abc123def456");
    const [taskText] = mockSend.mock.calls[0] as [string, Record<string, unknown>];
    // No Constraints: section appended
    expect(taskText).not.toContain("Constraints:");
    expect(taskText).toBe("Summarise the quarterly report");
  });
});
