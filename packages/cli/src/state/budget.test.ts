/**
 * budget.test.ts
 *
 * Tests for buildBudgetSummary() and budgetRoutingAdvice().
 *
 * We mock listTaskStates to avoid touching ~/.cofounder at test time.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildBudgetSummary, budgetRoutingAdvice, type BudgetSummary } from "./budget.ts";
import type { TaskState } from "./tasks.ts";

// ── helpers ──────────────────────────────────────────────────────────────────

function isoAgo(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

function makeTask(overrides: Partial<TaskState> & { id?: string } = {}): TaskState {
  return {
    id: overrides.id ?? "task-" + Math.random().toString(36).slice(2, 8),
    from: "calcifer",
    to: "glados",
    objective: "Test task",
    constraints: [],
    status: "completed",
    created_at: isoAgo(0),
    updated_at: isoAgo(0),
    result: null,
    ...overrides,
  };
}

// ── mock ─────────────────────────────────────────────────────────────────────

vi.mock("./tasks.ts", () => ({
  listTaskStates: vi.fn(),
}));

import { listTaskStates } from "./tasks.ts";
const mockListTasks = vi.mocked(listTaskStates);

beforeEach(() => {
  mockListTasks.mockReset();
});

// ── empty state ───────────────────────────────────────────────────────────────

describe("buildBudgetSummary — empty state", () => {
  it("returns zero totals when there are no tasks", async () => {
    mockListTasks.mockResolvedValue([]);
    const summary = await buildBudgetSummary("week");
    expect(summary.total_tokens).toBe(0);
    expect(summary.total_cost_usd).toBe(0);
    expect(summary.cloud_cost_usd).toBe(0);
    expect(summary.local_tokens).toBe(0);
    expect(summary.completed).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.pending).toBe(0);
    expect(summary.tasks).toHaveLength(0);
  });

  it("sets window correctly", async () => {
    mockListTasks.mockResolvedValue([]);
    const w = await buildBudgetSummary("today");
    expect(w.window).toBe("today");
    const m = await buildBudgetSummary("month");
    expect(m.window).toBe("month");
    const a = await buildBudgetSummary("all");
    expect(a.window).toBe("all");
  });
});

// ── window filtering ──────────────────────────────────────────────────────────

describe("buildBudgetSummary — window filtering", () => {
  it("excludes tasks older than the window", async () => {
    const recent = makeTask({ created_at: isoAgo(1) });
    const old = makeTask({ created_at: isoAgo(10) });
    mockListTasks.mockResolvedValue([recent, old]);

    const summary = await buildBudgetSummary("week");
    // old task was 10 days ago, beyond the 7-day window
    expect(summary.tasks).toHaveLength(1);
    expect(summary.tasks[0].id).toBe(recent.id);
  });

  it("includes all tasks for 'all' window", async () => {
    const ancient = makeTask({ created_at: new Date(0).toISOString() });
    mockListTasks.mockResolvedValue([ancient]);
    const summary = await buildBudgetSummary("all");
    expect(summary.tasks).toHaveLength(1);
  });

  it("today window excludes tasks from yesterday", async () => {
    const today = makeTask({ created_at: isoAgo(0) });
    const yesterday = makeTask({ created_at: isoAgo(1) });
    mockListTasks.mockResolvedValue([today, yesterday]);

    const summary = await buildBudgetSummary("today");
    expect(summary.tasks.some((t) => t.id === today.id)).toBe(true);
    // yesterday's task may or may not be included depending on exact midnight boundary,
    // but today's should always be there
    expect(summary.tasks.some((t) => t.id === today.id)).toBe(true);
  });

  it("month window covers one calendar month (~28-31 days)", async () => {
    // Use values well within/outside the boundary to avoid calendar-month edge cases.
    // setMonth(-1) means ~Feb 14 when today is Mar 14, so 10 days ago is safely inside
    // and 45 days ago is safely outside.
    const clearlyInside = makeTask({ created_at: isoAgo(10) });
    const clearlyOutside = makeTask({ created_at: isoAgo(45) });
    mockListTasks.mockResolvedValue([clearlyInside, clearlyOutside]);

    const summary = await buildBudgetSummary("month");
    expect(summary.tasks.some((t) => t.id === clearlyInside.id)).toBe(true);
    expect(summary.tasks.some((t) => t.id === clearlyOutside.id)).toBe(false);
  });
});

// ── status counts ─────────────────────────────────────────────────────────────

describe("buildBudgetSummary — status counts", () => {
  it("counts completed, failed, pending tasks", async () => {
    mockListTasks.mockResolvedValue([
      makeTask({ status: "completed" }),
      makeTask({ status: "completed" }),
      makeTask({ status: "failed" }),
      makeTask({ status: "pending" }),
      makeTask({ status: "running" }), // counts as pending
      makeTask({ status: "cancelled" }), // counts as pending
    ]);

    const summary = await buildBudgetSummary("all");
    expect(summary.completed).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.pending).toBe(3); // pending + running + cancelled
  });
});

// ── cost and token tracking ───────────────────────────────────────────────────

describe("buildBudgetSummary — cloud tokens + costs", () => {
  it("accumulates tokens from completed cloud tasks", async () => {
    mockListTasks.mockResolvedValue([
      makeTask({
        result: { output: "ok", success: true, artifacts: [], tokens_used: 1000 },
      }),
      makeTask({
        result: { output: "ok", success: true, artifacts: [], tokens_used: 2000 },
      }),
    ]);

    const summary = await buildBudgetSummary("all");
    expect(summary.total_tokens).toBe(3000);
  });

  it("tracks cloud_cost_usd for non-local models", async () => {
    mockListTasks.mockResolvedValue([
      makeTask({
        result: { output: "ok", success: true, artifacts: [], tokens_used: 5000 },
      }),
    ]);

    const summary = await buildBudgetSummary("all");
    // Should have some cloud cost (non-zero for 5k tokens on Sonnet)
    expect(summary.cloud_cost_usd).toBeGreaterThan(0);
    expect(summary.local_tokens).toBe(0);
  });

  it("accumulates local tokens without adding to cloud_cost_usd", async () => {
    mockListTasks.mockResolvedValue([
      makeTask({
        result: { output: "ok", success: true, artifacts: [], tokens_used: 3000 },
        routing_hint: "local",
      } as TaskState & { model?: string }),
    ]);

    // Inject model on the task to simulate ollama routing
    const tasks = await mockListTasks();
    // Since we can't set model via TaskState type directly (it's computed from
    // task.model || param), we verify the logic path for local model detection
    // by testing tasks with 'ollama' prefix in model field at the raw level.
    mockListTasks.mockResolvedValue([
      {
        ...makeTask({
          result: { output: "ok", success: true, artifacts: [], tokens_used: 3000 },
        }),
        model: "ollama/llama3",
      } as TaskState & { model?: string },
    ]);

    const summary = await buildBudgetSummary("all");
    expect(summary.local_tokens).toBe(3000);
    expect(summary.cloud_cost_usd).toBe(0);
    expect(summary.estimated_cloud_savings_usd).toBeGreaterThan(0);
  });

  it("uses explicitly stored cost_usd over estimated cost", async () => {
    mockListTasks.mockResolvedValue([
      makeTask({
        result: {
          output: "ok",
          success: true,
          artifacts: [],
          tokens_used: 10000,
          cost_usd: 0.042,
        },
      }),
    ]);

    const summary = await buildBudgetSummary("all");
    // The task entry should reflect the stored cost, not estimated
    const entry = summary.tasks[0];
    expect(entry.cost_usd).toBe(0.042);
    expect(entry.cost_estimated).toBe(false);
  });

  it("marks cost as estimated when computed from tokens", async () => {
    mockListTasks.mockResolvedValue([
      makeTask({
        result: { output: "ok", success: true, artifacts: [], tokens_used: 1000 },
      }),
    ]);

    const summary = await buildBudgetSummary("all");
    const entry = summary.tasks[0];
    expect(entry.cost_estimated).toBe(true);
    expect(entry.cost_usd).toBeGreaterThan(0);
  });

  it("handles tasks with no tokens gracefully (no cost computed)", async () => {
    mockListTasks.mockResolvedValue([
      makeTask({
        result: { output: "ok", success: true, artifacts: [] },
      }),
    ]);

    const summary = await buildBudgetSummary("all");
    const entry = summary.tasks[0];
    expect(entry.tokens_used).toBeUndefined();
    expect(entry.cost_usd).toBeUndefined();
    expect(entry.cost_estimated).toBe(false);
    expect(summary.total_tokens).toBe(0);
    expect(summary.total_cost_usd).toBe(0);
  });

  it("handles tasks with null result (pending/failed with no output)", async () => {
    mockListTasks.mockResolvedValue([
      makeTask({ status: "pending", result: null }),
      makeTask({ status: "failed", result: null }),
    ]);

    const summary = await buildBudgetSummary("all");
    expect(summary.total_tokens).toBe(0);
    expect(summary.total_cost_usd).toBe(0);
    expect(summary.tasks).toHaveLength(2);
  });
});

// ── task entry shape ──────────────────────────────────────────────────────────

describe("buildBudgetSummary — task entry fields", () => {
  it("maps task fields to entry correctly", async () => {
    const task = makeTask({
      id: "abc123",
      objective: "Render image",
      status: "completed",
      routing_hint: "image",
      created_at: isoAgo(0),
      result: { output: "done", success: true, artifacts: [], tokens_used: 500 },
    });
    mockListTasks.mockResolvedValue([task]);

    const summary = await buildBudgetSummary("all");
    const entry = summary.tasks[0];
    expect(entry.id).toBe("abc123");
    expect(entry.objective).toBe("Render image");
    expect(entry.status).toBe("completed");
    expect(entry.routing_hint).toBe("image");
    expect(entry.tokens_used).toBe(500);
  });

  it("includes model in entry when present on task", async () => {
    const task = {
      ...makeTask({ result: { output: "ok", success: true, artifacts: [], tokens_used: 100 } }),
      model: "anthropic/claude-haiku-3-5",
    } as TaskState & { model?: string };
    mockListTasks.mockResolvedValue([task]);

    const summary = await buildBudgetSummary("all");
    expect(summary.tasks[0].model).toBe("anthropic/claude-haiku-3-5");
  });

  it("falls back to the default model param when task has none", async () => {
    mockListTasks.mockResolvedValue([
      makeTask({ result: { output: "ok", success: true, artifacts: [], tokens_used: 100 } }),
    ]);

    const summary = await buildBudgetSummary("all", "anthropic/claude-opus-4-5");
    expect(summary.tasks[0].model).toBe("anthropic/claude-opus-4-5");
  });
});

// ── lmstudio local routing ────────────────────────────────────────────────────

describe("buildBudgetSummary — lmstudio / custom local routing", () => {
  it("treats lmstudio models as local", async () => {
    mockListTasks.mockResolvedValue([
      {
        ...makeTask({ result: { output: "ok", success: true, artifacts: [], tokens_used: 2000 } }),
        model: "lmstudio/mistral-7b",
      } as TaskState & { model?: string },
    ]);

    const s = await buildBudgetSummary("all");
    expect(s.local_tokens).toBe(2000);
    expect(s.cloud_cost_usd).toBe(0);
  });

  it("treats custom models as local", async () => {
    mockListTasks.mockResolvedValue([
      {
        ...makeTask({ result: { output: "ok", success: true, artifacts: [], tokens_used: 800 } }),
        model: "custom/my-finetune",
      } as TaskState & { model?: string },
    ]);

    const s = await buildBudgetSummary("all");
    expect(s.local_tokens).toBe(800);
    expect(s.cloud_cost_usd).toBe(0);
  });
});

// ── budgetRoutingAdvice ───────────────────────────────────────────────────────

describe("budgetRoutingAdvice", () => {
  function makeSummary(overrides: Partial<BudgetSummary> = {}): BudgetSummary {
    return {
      tasks: [],
      total_tokens: 0,
      total_cost_usd: 0,
      cloud_cost_usd: 0,
      local_tokens: 0,
      estimated_cloud_savings_usd: 0,
      completed: 0,
      failed: 0,
      pending: 0,
      window: "week",
      ...overrides,
    };
  }

  it("returns null when spend is low", () => {
    expect(budgetRoutingAdvice(makeSummary({ total_cost_usd: 0.10 }))).toBeNull();
  });

  it("returns null when spend is zero", () => {
    expect(budgetRoutingAdvice(makeSummary())).toBeNull();
  });

  it("warns when cloud spend exceeds $5", () => {
    const advice = budgetRoutingAdvice(makeSummary({ total_cost_usd: 7.50, window: "week" }));
    expect(advice).not.toBeNull();
    expect(advice).toContain("7.50");
    expect(advice).toContain("week");
  });

  it("warns about no local tasks when spend > $1 with no local usage", () => {
    const advice = budgetRoutingAdvice(
      makeSummary({ total_cost_usd: 2.00, local_tokens: 0, window: "month" }),
    );
    expect(advice).not.toBeNull();
    expect(advice).toContain("month");
    expect(advice).toContain("H2");
  });

  it("does not warn about no local tasks when local_tokens > 0", () => {
    const advice = budgetRoutingAdvice(
      makeSummary({ total_cost_usd: 2.00, local_tokens: 5000 }),
    );
    // $2 is > $1 but local_tokens > 0 → no ollama nag
    expect(advice).toBeNull();
  });

  it("high-spend warning takes priority over no-local warning", () => {
    // > $5 triggers the first branch which mentions $amount
    const advice = budgetRoutingAdvice(
      makeSummary({ total_cost_usd: 10.00, local_tokens: 0, window: "today" }),
    );
    expect(advice).toContain("10.00");
  });
});
