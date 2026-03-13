/**
 * result.test.ts — unit tests for `hh result`
 *
 * Mocks filesystem state helpers and core utilities to keep tests isolated.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockLoadTaskState, mockUpdateTaskState } = vi.hoisted(() => ({
  mockLoadTaskState: vi.fn(),
  mockUpdateTaskState: vi.fn(),
}));

const { mockLoadConfig } = vi.hoisted(() => ({
  mockLoadConfig: vi.fn(),
}));

const { mockEstimateCost, mockSummarizeTask, mockAppendContextEntry, mockDeliverResultWebhook } =
  vi.hoisted(() => ({
    mockEstimateCost: vi.fn(),
    mockSummarizeTask: vi.fn(),
    mockAppendContextEntry: vi.fn(),
    mockDeliverResultWebhook: vi.fn(),
  }));

vi.mock("../state/tasks.ts", () => ({
  loadTaskState: mockLoadTaskState,
  updateTaskState: mockUpdateTaskState,
}));

vi.mock("../config/store.ts", () => ({
  loadConfig: mockLoadConfig,
}));

vi.mock("@his-and-hers/core", () => ({
  estimateCost: mockEstimateCost,
  summarizeTask: mockSummarizeTask,
  appendContextEntry: mockAppendContextEntry,
  deliverResultWebhook: mockDeliverResultWebhook,
}));

vi.mock("@clack/prompts", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), step: vi.fn() },
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
}));

import { result } from "./result.ts";
import type { TaskState } from "../state/tasks.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<TaskState> = {}): TaskState {
  return {
    id: "task-0001-0000-0000-0000-000000000001",
    from: "glados",
    to: "calcifer",
    objective: "Generate a cat image",
    constraints: [],
    status: "pending",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    result: null,
    ...overrides,
  };
}

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    this_node: {
      name: "glados",
      gateway: { gateway_token: "test-token-abc", port: 18790 },
      provider: { kind: "anthropic", model: "claude-haiku-20240307" },
    },
    peer_node: { name: "calcifer", tailscale_ip: "100.1.2.3" },
    ...overrides,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resetExitCode() {
  process.exitCode = undefined;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("hh result — task not found", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetExitCode();
    mockLoadTaskState.mockResolvedValue(null);
    mockLoadConfig.mockResolvedValue(makeConfig());
  });

  it("sets exitCode 1 if task does not exist", async () => {
    await result("nonexistent-id", "done", {});
    expect(process.exitCode).toBe(1);
    expect(mockUpdateTaskState).not.toHaveBeenCalled();
  });
});

describe("hh result — basic completion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetExitCode();
    mockLoadTaskState.mockResolvedValue(makeTask());
    mockLoadConfig.mockResolvedValue(makeConfig());
    mockUpdateTaskState.mockResolvedValue(makeTask({ status: "completed" }));
    mockEstimateCost.mockReturnValue(null);
    mockSummarizeTask.mockReturnValue("Task completed successfully.");
    mockAppendContextEntry.mockResolvedValue(undefined);
  });

  it("marks task as completed with plain output", async () => {
    await result("task-0001-0000-0000-0000-000000000001", "Image saved to /tmp/cat.png", {});
    expect(mockUpdateTaskState).toHaveBeenCalledWith(
      "task-0001-0000-0000-0000-000000000001",
      expect.objectContaining({
        status: "completed",
        result: expect.objectContaining({
          output: "Image saved to /tmp/cat.png",
          success: true,
        }),
      }),
    );
    expect(process.exitCode).not.toBe(1);
  });

  it("marks task as failed when --fail is passed", async () => {
    mockUpdateTaskState.mockResolvedValue(makeTask({ status: "failed" }));
    await result("task-0001-0000-0000-0000-000000000001", "Ollama model not available", {
      fail: true,
    });
    expect(mockUpdateTaskState).toHaveBeenCalledWith(
      "task-0001-0000-0000-0000-000000000001",
      expect.objectContaining({
        status: "failed",
        result: expect.objectContaining({
          success: false,
          error: "Ollama model not available",
        }),
      }),
    );
  });

  it("uses (no output) as fallback when output is undefined", async () => {
    await result("task-0001-0000-0000-0000-000000000001", undefined, {});
    expect(mockUpdateTaskState).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        result: expect.objectContaining({ output: "(no output)" }),
      }),
    );
  });

  it("stores artifacts when provided", async () => {
    await result("task-0001-0000-0000-0000-000000000001", "done", {
      artifacts: ["/tmp/img.png", "/tmp/log.txt"],
    });
    expect(mockUpdateTaskState).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        result: expect.objectContaining({
          artifacts: ["/tmp/img.png", "/tmp/log.txt"],
        }),
      }),
    );
  });
});

describe("hh result — token / cost handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetExitCode();
    mockLoadTaskState.mockResolvedValue(makeTask());
    mockLoadConfig.mockResolvedValue(makeConfig());
    mockUpdateTaskState.mockResolvedValue(makeTask({ status: "completed" }));
    mockSummarizeTask.mockReturnValue("Task done.");
    mockAppendContextEntry.mockResolvedValue(undefined);
  });

  it("stores token count when --tokens is provided", async () => {
    mockEstimateCost.mockReturnValue(null);
    await result("task-0001-0000-0000-0000-000000000001", "done", { tokens: "1234" });
    expect(mockUpdateTaskState).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        result: expect.objectContaining({ tokens_used: 1234 }),
      }),
    );
  });

  it("auto-computes cost_usd if estimateCost returns a value", async () => {
    mockEstimateCost.mockReturnValue(0.00025);
    await result("task-0001-0000-0000-0000-000000000001", "done", { tokens: "500" });
    expect(mockEstimateCost).toHaveBeenCalledWith(500, expect.stringContaining("anthropic"));
    expect(mockUpdateTaskState).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        result: expect.objectContaining({ cost_usd: 0.00025 }),
      }),
    );
  });

  it("does not set cost_usd when estimateCost returns null", async () => {
    mockEstimateCost.mockReturnValue(null);
    await result("task-0001-0000-0000-0000-000000000001", "done", { tokens: "100" });
    const call = mockUpdateTaskState.mock.calls[0][1];
    expect(call.result.cost_usd).toBeUndefined();
  });

  it("stores duration_ms when --duration-ms is provided", async () => {
    mockEstimateCost.mockReturnValue(null);
    await result("task-0001-0000-0000-0000-000000000001", "done", { durationMs: "3500" });
    expect(mockUpdateTaskState).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        result: expect.objectContaining({ duration_ms: 3500 }),
      }),
    );
  });
});

describe("hh result — JSON payload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetExitCode();
    mockLoadTaskState.mockResolvedValue(makeTask());
    mockLoadConfig.mockResolvedValue(makeConfig());
    mockUpdateTaskState.mockResolvedValue(makeTask({ status: "completed" }));
    mockSummarizeTask.mockReturnValue("Done.");
    mockAppendContextEntry.mockResolvedValue(undefined);
    mockEstimateCost.mockReturnValue(null);
  });

  it("parses valid JSON payload and stores it", async () => {
    const payload = JSON.stringify({
      output: "result text",
      success: true,
      error: undefined,
      artifacts: ["/out.png"],
      tokens_used: 800,
    });
    await result("task-0001-0000-0000-0000-000000000001", undefined, { json: payload });
    expect(mockUpdateTaskState).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        result: expect.objectContaining({
          output: "result text",
          artifacts: ["/out.png"],
          tokens_used: 800,
        }),
      }),
    );
  });

  it("sets exitCode 1 on invalid JSON", async () => {
    await result("task-0001-0000-0000-0000-000000000001", undefined, { json: "not-json{{{" });
    expect(process.exitCode).toBe(1);
    expect(mockUpdateTaskState).not.toHaveBeenCalled();
  });
});

describe("hh result — already completed/failed tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetExitCode();
    mockLoadConfig.mockResolvedValue(makeConfig());
    mockUpdateTaskState.mockResolvedValue(makeTask({ status: "completed" }));
    mockSummarizeTask.mockReturnValue("Done.");
    mockAppendContextEntry.mockResolvedValue(undefined);
    mockEstimateCost.mockReturnValue(null);
  });

  it("warns but still proceeds for already-completed task", async () => {
    mockLoadTaskState.mockResolvedValue(makeTask({ status: "completed" }));
    const clack = await import("@clack/prompts");
    await result("task-0001-0000-0000-0000-000000000001", "re-run output", {});
    expect(clack.log.warn).toHaveBeenCalled();
    // Still calls update (re-set is allowed for debugging)
    expect(mockUpdateTaskState).toHaveBeenCalled();
  });
});

describe("hh result — webhook delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetExitCode();
    mockLoadTaskState.mockResolvedValue(makeTask());
    mockLoadConfig.mockResolvedValue(makeConfig());
    mockUpdateTaskState.mockResolvedValue(makeTask({ status: "completed" }));
    mockSummarizeTask.mockReturnValue("Done.");
    mockAppendContextEntry.mockResolvedValue(undefined);
    mockEstimateCost.mockReturnValue(null);
  });

  it("calls deliverResultWebhook when --webhook-url is provided and delivery succeeds", async () => {
    mockDeliverResultWebhook.mockResolvedValue({ ok: true });
    await result("task-0001-0000-0000-0000-000000000001", "done", {
      webhookUrl: "http://100.1.2.3:38791/result",
    });
    expect(mockDeliverResultWebhook).toHaveBeenCalledWith(
      "http://100.1.2.3:38791/result",
      "test-token-abc",
      expect.objectContaining({ task_id: "task-0001-0000-0000-0000-000000000001" }),
    );
  });

  it("handles webhook delivery failure gracefully (no exitCode 1)", async () => {
    mockDeliverResultWebhook.mockResolvedValue({ ok: false, error: "connection refused" });
    await result("task-0001-0000-0000-0000-000000000001", "done", {
      webhookUrl: "http://100.1.2.3:38791/result",
    });
    expect(process.exitCode).not.toBe(1);
  });

  it("skips webhook delivery when no gateway_token in config", async () => {
    mockLoadConfig.mockResolvedValue({
      ...makeConfig(),
      this_node: {
        ...makeConfig().this_node,
        gateway: { gateway_token: "", port: 18790 },
      },
    });
    await result("task-0001-0000-0000-0000-000000000001", "done", {
      webhookUrl: "http://100.1.2.3:38791/result",
    });
    expect(mockDeliverResultWebhook).not.toHaveBeenCalled();
  });
});

describe("hh result — context summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetExitCode();
    mockLoadTaskState.mockResolvedValue(makeTask());
    mockLoadConfig.mockResolvedValue(makeConfig());
    mockUpdateTaskState.mockResolvedValue(makeTask({ status: "completed", objective: "Generate a cat image" }));
    mockEstimateCost.mockReturnValue(null);
  });

  it("generates and appends context summary on completion", async () => {
    mockSummarizeTask.mockReturnValue("Generated cat image, saved to /tmp/cat.png.");
    mockAppendContextEntry.mockResolvedValue(undefined);

    await result("task-0001-0000-0000-0000-000000000001", "Image saved to /tmp/cat.png", {});

    expect(mockSummarizeTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task_id: "task-0001-0000-0000-0000-000000000001",
        objective: "Generate a cat image",
      }),
    );
    expect(mockAppendContextEntry).toHaveBeenCalledWith(
      "calcifer", // peer_node.name from config
      expect.objectContaining({
        task_id: "task-0001-0000-0000-0000-000000000001",
        summary: "Generated cat image, saved to /tmp/cat.png.",
      }),
    );
  });

  it("does not throw if appendContextEntry rejects (best-effort)", async () => {
    mockSummarizeTask.mockReturnValue("Done.");
    mockAppendContextEntry.mockRejectedValue(new Error("disk full"));

    // Should not throw
    await expect(
      result("task-0001-0000-0000-0000-000000000001", "done", {}),
    ).resolves.not.toThrow();
  });
});
