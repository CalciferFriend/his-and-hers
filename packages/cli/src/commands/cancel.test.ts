/**
 * cancel.test.ts — unit tests for `cofounder cancel`
 *
 * Covers: single cancel, prefix resolution, terminal-state guard, --force,
 * --all-pending, missing ID error, --json output, and task-not-found paths.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockLoadTaskState, mockListTaskStates, mockUpdateTaskState } = vi.hoisted(() => ({
  mockLoadTaskState: vi.fn(),
  mockListTaskStates: vi.fn(),
  mockUpdateTaskState: vi.fn(),
}));

vi.mock("../state/tasks.ts", () => ({
  loadTaskState: mockLoadTaskState,
  listTaskStates: mockListTaskStates,
  updateTaskState: mockUpdateTaskState,
}));

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), step: vi.fn() },
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

import type { TaskState } from "../state/tasks.ts";
import { cancel } from "./cancel.ts";

const PENDING_TASK: TaskState = {
  id: "aabbccddeeff",
  from: "calcifer",
  to: "glados",
  objective: "Summarise the quarterly report",
  constraints: ["max 200 words"],
  status: "pending",
  created_at: "2026-03-13T12:00:00Z",
  updated_at: "2026-03-13T12:00:00Z",
  result: null,
};

const RUNNING_TASK: TaskState = { ...PENDING_TASK, id: "11223344aabb", status: "running" };
const COMPLETED_TASK: TaskState = {
  ...PENDING_TASK,
  id: "99887766ccdd",
  status: "completed",
  result: { output: "done", success: true, artifacts: [] },
};
const FAILED_TASK: TaskState = { ...PENDING_TASK, id: "deadbeef1234", status: "failed", result: { output: "", success: false, artifacts: [] } };
const TIMEOUT_TASK: TaskState = { ...PENDING_TASK, id: "cafecafe5678", status: "timeout", result: null };

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadTaskState.mockResolvedValue(null);
  mockListTaskStates.mockResolvedValue([]);
  mockUpdateTaskState.mockImplementation(async (id, patch) => ({
    ...PENDING_TASK,
    id,
    ...patch,
    updated_at: new Date().toISOString(),
  }));
  process.exitCode = undefined;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cofounder cancel — single task (pending)", () => {
  it("cancels a pending task by exact ID", async () => {
    mockLoadTaskState.mockResolvedValue(PENDING_TASK);
    await cancel(PENDING_TASK.id);
    expect(mockUpdateTaskState).toHaveBeenCalledWith(
      PENDING_TASK.id,
      expect.objectContaining({ status: "cancelled" }),
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("cancels a running task by exact ID", async () => {
    mockLoadTaskState.mockResolvedValue(RUNNING_TASK);
    await cancel(RUNNING_TASK.id);
    expect(mockUpdateTaskState).toHaveBeenCalledWith(
      RUNNING_TASK.id,
      expect.objectContaining({ status: "cancelled" }),
    );
  });

  it("resolves by ID prefix when exact match returns null", async () => {
    mockLoadTaskState.mockResolvedValue(null);
    mockListTaskStates.mockResolvedValue([PENDING_TASK]);
    await cancel("aabb"); // prefix of "aabbccddeeff"
    expect(mockUpdateTaskState).toHaveBeenCalledWith(
      PENDING_TASK.id,
      expect.objectContaining({ status: "cancelled" }),
    );
  });

  it("sets exitCode 1 and does not call updateTaskState when task not found", async () => {
    mockLoadTaskState.mockResolvedValue(null);
    mockListTaskStates.mockResolvedValue([]);
    await cancel("notexist");
    expect(mockUpdateTaskState).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});

describe("cofounder cancel — terminal state guard", () => {
  it.each([
    ["completed", COMPLETED_TASK],
    ["failed", FAILED_TASK],
    ["timeout", TIMEOUT_TASK],
  ])("sets exitCode 1 and skips update for status=%s without --force", async (_status, task) => {
    mockLoadTaskState.mockResolvedValue(task);
    await cancel(task.id);
    expect(mockUpdateTaskState).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("allows cancelling a completed task with --force", async () => {
    mockLoadTaskState.mockResolvedValue(COMPLETED_TASK);
    await cancel(COMPLETED_TASK.id, { force: true });
    expect(mockUpdateTaskState).toHaveBeenCalledWith(
      COMPLETED_TASK.id,
      expect.objectContaining({ status: "cancelled" }),
    );
    expect(process.exitCode).toBeUndefined();
  });
});

describe("cofounder cancel — missing ID", () => {
  it("sets exitCode 1 when no ID and --all-pending not set", async () => {
    await cancel(undefined);
    expect(mockUpdateTaskState).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});

describe("cofounder cancel — --all-pending", () => {
  it("cancels all pending tasks", async () => {
    const t1 = { ...PENDING_TASK, id: "id000001" };
    const t2 = { ...PENDING_TASK, id: "id000002" };
    mockListTaskStates.mockResolvedValue([t1, t2, COMPLETED_TASK]); // completed ignored
    await cancel(undefined, { allPending: true });
    expect(mockUpdateTaskState).toHaveBeenCalledTimes(2);
    expect(mockUpdateTaskState).toHaveBeenCalledWith("id000001", expect.objectContaining({ status: "cancelled" }));
    expect(mockUpdateTaskState).toHaveBeenCalledWith("id000002", expect.objectContaining({ status: "cancelled" }));
    expect(process.exitCode).toBeUndefined();
  });

  it("sets exitCode 1 and skips update when no pending tasks", async () => {
    mockListTaskStates.mockResolvedValue([COMPLETED_TASK]);
    await cancel(undefined, { allPending: true });
    expect(mockUpdateTaskState).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});

describe("cofounder cancel — --json output", () => {
  it("prints JSON on successful cancel", async () => {
    mockLoadTaskState.mockResolvedValue(PENDING_TASK);
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await cancel(PENDING_TASK.id, { json: true });
    const written = spy.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(written);
    expect(parsed).toMatchObject({ id: PENDING_TASK.id, status: "cancelled" });
    spy.mockRestore();
  });

  it("prints JSON error when task not found", async () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await cancel("nope", { json: true });
    const written = spy.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(written);
    expect(parsed).toHaveProperty("error");
    spy.mockRestore();
  });

  it("prints JSON result for --all-pending cancel", async () => {
    const t1 = { ...PENDING_TASK, id: "jsonpend1" };
    mockListTaskStates.mockResolvedValue([t1]);
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await cancel(undefined, { allPending: true, json: true });
    const written = spy.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(written);
    expect(parsed.cancelled).toHaveLength(1);
    expect(parsed.cancelled[0]).toMatchObject({ id: "jsonpend1" });
    spy.mockRestore();
  });
});
