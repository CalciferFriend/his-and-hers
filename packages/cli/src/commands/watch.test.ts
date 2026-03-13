/**
 * watch.test.ts — unit tests for the `hh watch` task listener daemon
 *
 * Strategy: mock `listTaskStates` and `updateTaskState` to avoid touching the
 * filesystem, and use `--dry-run` / `--once` to keep tests synchronous.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Hoist mock fns so they're available before module evaluation ────────────

const { mockListTaskStates, mockUpdateTaskState } = vi.hoisted(() => ({
  mockListTaskStates: vi.fn(),
  mockUpdateTaskState: vi.fn(),
}));

vi.mock("../state/tasks.ts", () => ({
  listTaskStates: mockListTaskStates,
  updateTaskState: mockUpdateTaskState,
}));

// Suppress clack output in tests
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), step: vi.fn() },
}));

import { watch } from "./watch.ts";
import type { TaskState } from "../state/tasks.ts";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<TaskState> = {}): TaskState {
  return {
    id: "aaaabbbb-0000-0000-0000-000000000001",
    from: "calcifer",
    to: "glados",
    objective: "Generate a cat image",
    constraints: [],
    status: "pending",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    result: null,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("hh watch — dry-run mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateTaskState.mockResolvedValue({});
  });

  it("exits cleanly when no tasks are pending", async () => {
    mockListTaskStates.mockResolvedValue([]);
    await watch({ once: true, dryRun: true, json: true });
    expect(mockUpdateTaskState).not.toHaveBeenCalled();
  });

  it("detects a pending task without mutating state", async () => {
    mockListTaskStates.mockResolvedValue([makeTask()]);
    const lines: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });

    await watch({ once: true, dryRun: true, json: true });

    // Restore
    process.stdout.write = origWrite;

    expect(mockUpdateTaskState).not.toHaveBeenCalled();

    const events = lines
      .filter((l) => l.trim().startsWith("{"))
      .map((l) => JSON.parse(l.trim()));
    expect(events.some((e) => e.event === "task_detected")).toBe(true);
  });

  it("ignores completed tasks", async () => {
    mockListTaskStates.mockResolvedValue([makeTask({ status: "completed" })]);
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });

    await watch({ once: true, dryRun: true, json: true });

    const events = lines
      .filter((l) => l.trim().startsWith("{"))
      .map((l) => JSON.parse(l.trim()));
    expect(events.filter((e) => e.event === "task_detected")).toHaveLength(0);
  });

  it("ignores running tasks", async () => {
    mockListTaskStates.mockResolvedValue([makeTask({ status: "running" })]);
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });

    await watch({ once: true, dryRun: true, json: true });

    const events = lines
      .filter((l) => l.trim().startsWith("{"))
      .map((l) => JSON.parse(l.trim()));
    expect(events.filter((e) => e.event === "task_detected")).toHaveLength(0);
  });
});

describe("hh watch — no executor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateTaskState.mockResolvedValue({});
  });

  it("surfaces pending task but does not mark it running", async () => {
    mockListTaskStates.mockResolvedValue([makeTask()]);

    await watch({ once: true, json: true });

    // Without --exec, state should NOT be mutated
    expect(mockUpdateTaskState).not.toHaveBeenCalled();
  });

  it("surfaces multiple pending tasks", async () => {
    mockListTaskStates.mockResolvedValue([
      makeTask({ id: "aaaabbbb-0000-0000-0000-000000000001" }),
      makeTask({ id: "aaaabbbb-0000-0000-0000-000000000002" }),
    ]);
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });

    await watch({ once: true, json: true });

    const events = lines
      .filter((l) => l.trim().startsWith("{"))
      .map((l) => JSON.parse(l.trim()));
    expect(events.filter((e) => e.event === "task_detected")).toHaveLength(2);
  });
});

describe("hh watch — with executor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateTaskState.mockResolvedValue({});
  });

  it("marks task running then completed on success", async () => {
    mockListTaskStates.mockResolvedValue([makeTask()]);

    // `echo` exits 0 and writes to stdout — a perfect success executor
    await watch({ once: true, json: true, exec: "echo task-done" });

    // First call: mark running
    expect(mockUpdateTaskState).toHaveBeenNthCalledWith(1,
      "aaaabbbb-0000-0000-0000-000000000001",
      { status: "running" },
    );

    // Second call: mark completed
    const secondCall = mockUpdateTaskState.mock.calls[1];
    expect(secondCall[0]).toBe("aaaabbbb-0000-0000-0000-000000000001");
    expect(secondCall[1].status).toBe("completed");
    expect(secondCall[1].result?.success).toBe(true);
  });

  it("marks task failed when executor exits non-zero", async () => {
    mockListTaskStates.mockResolvedValue([makeTask()]);

    // `false` exits 1
    await watch({ once: true, json: true, exec: "false" });

    const lastCall = mockUpdateTaskState.mock.calls.at(-1);
    expect(lastCall?.[1]?.status).toBe("failed");
    expect(lastCall?.[1]?.result?.success).toBe(false);
  });

  it("reverts to pending if executor spawn fails", async () => {
    mockListTaskStates.mockResolvedValue([makeTask()]);

    // non-existent binary
    await watch({ once: true, json: true, exec: "this-binary-does-not-exist-hh" });

    // Should have tried to mark running, then reverted to pending
    const statuses = mockUpdateTaskState.mock.calls.map((c) => c[1]?.status ?? c[1]);
    expect(statuses).toContain("running");
    expect(statuses).toContain("pending");
  });

  it("emits task_completed JSON line on success", async () => {
    mockListTaskStates.mockResolvedValue([makeTask()]);
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });

    await watch({ once: true, json: true, exec: "echo great-output" });

    const events = lines
      .filter((l) => l.trim().startsWith("{"))
      .map((l) => JSON.parse(l.trim()));

    const completed = events.find((e) => e.event === "task_completed");
    expect(completed).toBeDefined();
    expect(completed?.output).toContain("great-output");
  });
});

describe("hh watch — WatchOptions defaults", () => {
  it("exits immediately on --once with empty task list", async () => {
    mockListTaskStates.mockResolvedValue([]);
    // Should not hang
    const start = Date.now();
    await watch({ once: true, json: true });
    expect(Date.now() - start).toBeLessThan(3000);
  });
});
