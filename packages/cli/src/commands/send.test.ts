/**
 * send.test.ts — Phase 12 integration tests for `cofounder send`
 *
 * Focuses on Phase 12 additions:
 *   12a. Budget gate: block/warn before dispatch
 *   12b. broadcastNotification wiring: task_sent, task_completed, task_failed
 *   12c. budget_warn broadcast on cap violations
 *
 * All network I/O (tailscale, gateway, wakeAgent) is mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any imports
// ---------------------------------------------------------------------------

const {
  mockPingPeer,
  mockCheckGatewayHealth,
  mockWakeAgent,
  mockCheckBudget,
  mockBroadcastNotification,
  mockDeliverNotification,
  mockSuggestRouting,
  mockCreateTaskMessage,
  mockLoadContextSummary,
  mockWithRetry,
  mockSetRetryState,
  mockClearRetryState,
  mockCronRetryDecisionAsync,
  mockLoadAttachments,
  mockAppendAuditEntry,
} = vi.hoisted(() => ({
  mockPingPeer: vi.fn(async () => true),
  mockCheckGatewayHealth: vi.fn(async () => true),
  mockWakeAgent: vi.fn(async () => ({ ok: true })),
  mockCheckBudget: vi.fn(async () => ({
    allowed: true,
    spent_today: 0,
    spent_month: 0,
    limit: 0,
    limit_type: "none" as const,
  })),
  mockBroadcastNotification: vi.fn(async () => undefined),
  mockDeliverNotification: vi.fn(async () => true),
  mockSuggestRouting: vi.fn(() => "h2-cloud"),
  mockCreateTaskMessage: vi.fn(() => ({
    id: "task-uuid-1234",
    from: "calcifer",
    to: "glados",
    type: "task",
    payload: { objective: "test task", constraints: [], attachments: [] },
  })),
  mockLoadContextSummary: vi.fn(async () => null),
  mockWithRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  mockSetRetryState: vi.fn(async () => undefined),
  mockClearRetryState: vi.fn(async () => undefined),
  mockCronRetryDecisionAsync: vi.fn(async () => "send" as const),
  mockLoadAttachments: vi.fn(async () => ({ attachments: [], warnings: [], errors: [] })),
  mockAppendAuditEntry: vi.fn(async () => undefined),
}));

vi.mock("@cofounder/core", () => ({
  pingPeer: mockPingPeer,
  checkGatewayHealth: mockCheckGatewayHealth,
  wakeAgent: mockWakeAgent,
  checkBudget: mockCheckBudget,
  broadcastNotification: mockBroadcastNotification,
  deliverNotification: mockDeliverNotification,
  suggestRouting: mockSuggestRouting,
  createTaskMessage: mockCreateTaskMessage,
  loadContextSummary: mockLoadContextSummary,
  withRetry: mockWithRetry,
  setRetryState: mockSetRetryState,
  clearRetryState: mockClearRetryState,
  cronRetryDecisionAsync: mockCronRetryDecisionAsync,
  loadAttachments: mockLoadAttachments,
  appendAuditEntry: mockAppendAuditEntry,
  formatAttachmentSummary: vi.fn(() => ""),
  wakeAndWait: vi.fn(async () => true),
  startResultServer: vi.fn(async () => null),
  startStreamServer: vi.fn(async () => null),
  loadPeerCapabilities: vi.fn(async () => null),
  routeTask: vi.fn(() => ({ hint: "h2-cloud" })),
}));

vi.mock("../config/store.ts", () => ({
  loadConfig: vi.fn(async () => ({
    this_node: { name: "calcifer", tailscale_ip: "100.1.1.1" },
    peer_node: {
      name: "glados",
      tailscale_ip: "100.2.2.2",
      gateway_port: 18789,
      gateway_token: "tok-test",
      wol_enabled: false,
      emoji: "🤖",
    },
    peer_nodes: [],
  })),
}));

vi.mock("../state/tasks.ts", () => ({
  createTaskState: vi.fn(async () => undefined),
  updateTaskState: vi.fn(async () => undefined),
  pollTaskCompletion: vi.fn(async () => null),
}));

vi.mock("../peers/select.ts", () => ({
  getPeer: vi.fn((config: { peer_node: unknown }) => config.peer_node),
  selectBestPeer: vi.fn(async (config: { peer_node: unknown }) => config.peer_node),
  formatPeerList: vi.fn(() => ""),
}));

vi.mock("@cofounder/core/notify/config", () => ({
  getActiveWebhooks: vi.fn(async () => []),
}));

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), step: vi.fn(), success: vi.fn() },
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { send } from "./send.ts";
import * as p from "@clack/prompts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBudgetResult(overrides: Partial<{
  allowed: boolean;
  reason: string;
  spent_today: number;
  spent_month: number;
  limit: number;
  limit_type: "daily" | "monthly" | "none";
}> = {}) {
  return {
    allowed: true,
    spent_today: 0,
    spent_month: 0,
    limit: 10,
    limit_type: "daily" as const,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default: budget passes, delivery succeeds
  mockCheckBudget.mockResolvedValue(makeBudgetResult());
  mockWakeAgent.mockResolvedValue({ ok: true });
  mockCronRetryDecisionAsync.mockResolvedValue("send" as const);
  mockPingPeer.mockResolvedValue(true);
  mockCheckGatewayHealth.mockResolvedValue(true);
  mockWithRetry.mockImplementation(async (fn: () => Promise<unknown>) => fn());
});

// ─── Phase 12a: Budget gate ────────────────────────────────────────────────

describe("Phase 12a — budget gate", () => {
  it("proceeds normally when no budget cap is configured", async () => {
    mockCheckBudget.mockResolvedValue(makeBudgetResult({ limit_type: "none" }));
    await send("summarise logs", {});
    expect(mockWakeAgent).toHaveBeenCalledOnce();
  });

  it("proceeds and shows warning when budget is at warn threshold (allowed=true, reason set)", async () => {
    mockCheckBudget.mockResolvedValue(
      makeBudgetResult({
        allowed: true,
        reason: "Daily budget warning for glados: $8.50 / $10.00 (85%)",
        spent_today: 8.5,
        limit: 10,
        limit_type: "daily",
      }),
    );
    await send("run test suite", {});
    expect(mockWakeAgent).toHaveBeenCalledOnce();
    // Should warn but not block
    expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining("Budget warning"));
  });

  it("fires budget_warn broadcast on warn threshold", async () => {
    mockCheckBudget.mockResolvedValue(
      makeBudgetResult({
        allowed: true,
        reason: "Daily budget warning for glados: $8.50 / $10.00 (85%)",
        spent_today: 8.5,
        limit: 10,
        limit_type: "daily",
      }),
    );
    await send("run test suite", {});
    expect(mockBroadcastNotification).toHaveBeenCalledWith(
      "budget_warn",
      expect.objectContaining({ peer: "glados", spent_today: 8.5 }),
    );
  });

  it("blocks send when budget is exceeded and action=block", async () => {
    mockCheckBudget.mockResolvedValue(
      makeBudgetResult({
        allowed: false,
        reason: "Daily budget exceeded for glados: $12.00 > $10.00",
        spent_today: 12,
        limit: 10,
        limit_type: "daily",
      }),
    );
    await send("expensive task", {});
    // wakeAgent must NOT be called — send is blocked
    expect(mockWakeAgent).not.toHaveBeenCalled();
    expect(p.log.error).toHaveBeenCalledWith(
      expect.stringContaining("Budget cap exceeded"),
    );
    expect(p.outro).toHaveBeenCalledWith("Send blocked by budget policy.");
  });

  it("fires budget_warn broadcast when send is blocked", async () => {
    mockCheckBudget.mockResolvedValue(
      makeBudgetResult({
        allowed: false,
        reason: "Daily budget exceeded for glados: $12.00 > $10.00",
        spent_today: 12,
        limit: 10,
        limit_type: "daily",
      }),
    );
    await send("expensive task", {});
    expect(mockBroadcastNotification).toHaveBeenCalledWith(
      "budget_warn",
      expect.objectContaining({ peer: "glados" }),
    );
  });

  it("proceeds even if checkBudget throws (fail-open)", async () => {
    mockCheckBudget.mockRejectedValue(new Error("budget store unavailable"));
    await send("fallback task", {});
    // Should deliver normally despite budget check failure
    expect(mockWakeAgent).toHaveBeenCalledOnce();
  });
});

// ─── Phase 12b: task_sent broadcast ───────────────────────────────────────

describe("Phase 12b — task_sent broadcast", () => {
  it("broadcasts task_sent event after successful delivery", async () => {
    await send("build a report", {});
    expect(mockBroadcastNotification).toHaveBeenCalledWith(
      "task_sent",
      expect.objectContaining({
        task_id: "task-uuid-1234",
        peer: "glados",
        objective: "build a report",
      }),
    );
  });

  it("includes timestamp in task_sent payload", async () => {
    await send("analyze logs", {});
    const call = mockBroadcastNotification.mock.calls.find(
      ([event]) => event === "task_sent",
    );
    expect(call).toBeDefined();
    expect(call![1]).toHaveProperty("timestamp");
    expect(typeof call![1].timestamp).toBe("string");
  });

  it("does NOT broadcast task_sent when delivery fails", async () => {
    mockWakeAgent.mockResolvedValue({ ok: false, error: "connection refused" });
    mockWithRetry.mockImplementation(async (fn: () => Promise<unknown>) => {
      const result = await fn() as { ok: boolean; error?: string };
      if (!result.ok) throw new Error(result.error);
      return result;
    });
    await send("failing task", {});
    const sentCalls = mockBroadcastNotification.mock.calls.filter(
      ([event]) => event === "task_sent",
    );
    expect(sentCalls).toHaveLength(0);
  });
});

// ─── Phase 12b: task_completed / task_failed via fireNotifications ──────────

describe("Phase 12b — task_completed / task_failed broadcast via --wait", () => {
  it("broadcasts task_completed when task succeeds (poll fallback path)", async () => {
    const { pollTaskCompletion } = await import("../state/tasks.ts");
    (pollTaskCompletion as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "task-uuid-1234",
      status: "completed",
      result: {
        output: "All tests passed",
        success: true,
        artifacts: [],
        tokens_used: 500,
        duration_ms: 3000,
        cost_usd: 0.002,
      },
    });

    await send("run tests", { wait: true, noWebhook: true });

    expect(mockBroadcastNotification).toHaveBeenCalledWith(
      "task_completed",
      expect.objectContaining({
        success: true,
        peer: "glados",
      }),
    );
  });

  it("broadcasts task_failed when task fails (poll fallback path)", async () => {
    const { pollTaskCompletion } = await import("../state/tasks.ts");
    (pollTaskCompletion as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "task-uuid-1234",
      status: "failed",
      result: {
        output: "Process crashed",
        error: "Exit code 1",
        success: false,
        artifacts: [],
      },
    });

    await send("flaky task", { wait: true, noWebhook: true });

    expect(mockBroadcastNotification).toHaveBeenCalledWith(
      "task_failed",
      expect.objectContaining({
        success: false,
        peer: "glados",
      }),
    );
  });

  it("does not broadcast task_completed when task times out", async () => {
    const { pollTaskCompletion } = await import("../state/tasks.ts");
    (pollTaskCompletion as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "timeout",
    });

    await send("slow task", { wait: true, noWebhook: true });

    const completedCalls = mockBroadcastNotification.mock.calls.filter(
      ([event]) => event === "task_completed" || event === "task_failed",
    );
    expect(completedCalls).toHaveLength(0);
  });
});

// ─── Regression: budget gate doesn't break normal flow ────────────────────

describe("Phase 12 — regression: existing behavior preserved", () => {
  it("still calls wakeAgent with task text when budget passes", async () => {
    await send("analyze quarterly results", {});
    expect(mockWakeAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringContaining("100.2.2.2"),
        token: "tok-test",
        text: expect.stringContaining("analyze quarterly results"),
      }),
    );
  });

  it("respects --force flag to bypass cron guard", async () => {
    mockCronRetryDecisionAsync.mockResolvedValue("skip" as const);
    await send("task", { force: true });
    expect(mockWakeAgent).toHaveBeenCalledOnce();
  });

  it("does not block when budget check returns null (missing store)", async () => {
    mockCheckBudget.mockResolvedValue(makeBudgetResult({ reason: undefined }));
    await send("clean task", {});
    expect(mockWakeAgent).toHaveBeenCalledOnce();
  });
});
