/**
 * budget.test.ts — Phase 11b budget cap tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadBudgets,
  saveBudgets,
  addBudget,
  removeBudget,
  checkBudget,
  type BudgetConfig,
} from "./budget.ts";
import type { TaskState } from "../../sdk/src/state.ts";

const testDir = join(tmpdir(), `cofounder-budget-test-${process.pid}`);

// Mock the homedir to use our test directory
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: () => testDir,
  };
});

// Mock listTaskStates
vi.mock("../../sdk/src/state.ts", () => ({
  listTaskStates: vi.fn(async () => [] as TaskState[]),
}));

import { listTaskStates } from "../../sdk/src/state.ts";

beforeEach(async () => {
  await mkdir(testDir, { recursive: true });
  vi.clearAllMocks();
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("loadBudgets", () => {
  it("returns empty array if no file exists", async () => {
    const budgets = await loadBudgets();
    expect(budgets).toEqual([]);
  });

  it("loads valid budgets from disk", async () => {
    const testBudgets: BudgetConfig[] = [
      { peer: "glados", daily_usd: 10, action: "warn" },
      { peer: "piper", monthly_usd: 100, action: "block" },
    ];
    await saveBudgets(testBudgets);

    const loaded = await loadBudgets();
    expect(loaded).toEqual(testBudgets);
  });

  it("returns empty array on malformed JSON", async () => {
    const path = join(testDir, ".cofounder", "budget.json");
    await mkdir(join(testDir, ".cofounder"), { recursive: true });
    await writeFile(path, "invalid json", "utf-8");

    const budgets = await loadBudgets();
    expect(budgets).toEqual([]);
  });
});

describe("saveBudgets", () => {
  it("writes budgets to disk with correct schema", async () => {
    const budgets: BudgetConfig[] = [
      { peer: "glados", daily_usd: 5, action: "warn" },
    ];
    await saveBudgets(budgets);

    const loaded = await loadBudgets();
    expect(loaded).toEqual(budgets);
  });

  it("creates directory if it doesn't exist", async () => {
    const budgets: BudgetConfig[] = [
      { peer: "test", daily_usd: 1, action: "block" },
    ];
    await saveBudgets(budgets);

    const loaded = await loadBudgets();
    expect(loaded).toEqual(budgets);
  });
});

describe("addBudget", () => {
  it("adds a new budget rule", async () => {
    const budget: BudgetConfig = {
      peer: "glados",
      daily_usd: 10,
      action: "warn",
    };
    await addBudget(budget);

    const loaded = await loadBudgets();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(budget);
  });

  it("updates existing budget rule for same peer", async () => {
    const budget1: BudgetConfig = {
      peer: "glados",
      daily_usd: 10,
      action: "warn",
    };
    const budget2: BudgetConfig = {
      peer: "glados",
      daily_usd: 20,
      monthly_usd: 100,
      action: "block",
    };

    await addBudget(budget1);
    await addBudget(budget2);

    const loaded = await loadBudgets();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(budget2);
  });

  it("allows multiple budgets for different peers", async () => {
    const budget1: BudgetConfig = { peer: "glados", daily_usd: 10, action: "warn" };
    const budget2: BudgetConfig = { peer: "piper", monthly_usd: 50, action: "block" };

    await addBudget(budget1);
    await addBudget(budget2);

    const loaded = await loadBudgets();
    expect(loaded).toHaveLength(2);
  });
});

describe("removeBudget", () => {
  it("removes a budget rule by peer name", async () => {
    const budget: BudgetConfig = { peer: "glados", daily_usd: 10, action: "warn" };
    await addBudget(budget);

    const removed = await removeBudget("glados");
    expect(removed).toBe(true);

    const loaded = await loadBudgets();
    expect(loaded).toHaveLength(0);
  });

  it("returns false if budget not found", async () => {
    const removed = await removeBudget("nonexistent");
    expect(removed).toBe(false);
  });

  it("only removes the specified budget", async () => {
    const budget1: BudgetConfig = { peer: "glados", daily_usd: 10, action: "warn" };
    const budget2: BudgetConfig = { peer: "piper", daily_usd: 20, action: "warn" };

    await addBudget(budget1);
    await addBudget(budget2);

    await removeBudget("glados");

    const loaded = await loadBudgets();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].peer).toBe("piper");
  });
});

describe("checkBudget", () => {
  it("allows task if no budget configured", async () => {
    const result = await checkBudget("glados", 5);
    expect(result.allowed).toBe(true);
    expect(result.limit_type).toBe("none");
  });

  it("allows task under daily limit", async () => {
    await addBudget({ peer: "glados", daily_usd: 10, action: "warn" });

    vi.mocked(listTaskStates).mockResolvedValue([
      {
        id: "task1",
        from: "h1",
        to: "glados",
        objective: "test",
        constraints: [],
        status: "completed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        result: { output: "", success: true, artifacts: [], cost_usd: 3 },
      },
    ]);

    const result = await checkBudget("glados", 2);
    expect(result.allowed).toBe(true);
    expect(result.spent_today).toBe(3);
    expect(result.limit_type).toBe("daily");
  });

  it("warns when approaching daily limit (>80%)", async () => {
    await addBudget({ peer: "glados", daily_usd: 10, action: "warn" });

    vi.mocked(listTaskStates).mockResolvedValue([
      {
        id: "task1",
        from: "h1",
        to: "glados",
        objective: "test",
        constraints: [],
        status: "completed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        result: { output: "", success: true, artifacts: [], cost_usd: 7 },
      },
    ]);

    const result = await checkBudget("glados", 2);
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain("Daily budget warning");
    expect(result.reason).toContain("90%");
  });

  it("allows with warning when exceeding daily limit with warn action", async () => {
    await addBudget({ peer: "glados", daily_usd: 10, action: "warn" });

    vi.mocked(listTaskStates).mockResolvedValue([
      {
        id: "task1",
        from: "h1",
        to: "glados",
        objective: "test",
        constraints: [],
        status: "completed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        result: { output: "", success: true, artifacts: [], cost_usd: 9 },
      },
    ]);

    const result = await checkBudget("glados", 2);
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain("Daily budget exceeded");
  });

  it("blocks when exceeding daily limit with block action", async () => {
    await addBudget({ peer: "glados", daily_usd: 10, action: "block" });

    vi.mocked(listTaskStates).mockResolvedValue([
      {
        id: "task1",
        from: "h1",
        to: "glados",
        objective: "test",
        constraints: [],
        status: "completed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        result: { output: "", success: true, artifacts: [], cost_usd: 9 },
      },
    ]);

    const result = await checkBudget("glados", 2);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Daily budget exceeded");
  });

  it("allows task under monthly limit", async () => {
    await addBudget({ peer: "glados", monthly_usd: 100, action: "warn" });

    const now = new Date();
    vi.mocked(listTaskStates).mockResolvedValue([
      {
        id: "task1",
        from: "h1",
        to: "glados",
        objective: "test",
        constraints: [],
        status: "completed",
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        result: { output: "", success: true, artifacts: [], cost_usd: 30 },
      },
    ]);

    const result = await checkBudget("glados", 10);
    expect(result.allowed).toBe(true);
    expect(result.spent_month).toBe(30);
  });

  it("filters tasks by peer", async () => {
    await addBudget({ peer: "glados", daily_usd: 10, action: "warn" });

    const now = new Date();
    vi.mocked(listTaskStates).mockResolvedValue([
      {
        id: "task1",
        from: "h1",
        to: "glados",
        objective: "test",
        constraints: [],
        status: "completed",
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        result: { output: "", success: true, artifacts: [], cost_usd: 5 },
      },
      {
        id: "task2",
        from: "h1",
        to: "piper",
        objective: "test",
        constraints: [],
        status: "completed",
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        result: { output: "", success: true, artifacts: [], cost_usd: 10 },
      },
    ]);

    const result = await checkBudget("glados", 0);
    expect(result.spent_today).toBe(5);
    expect(result.spent_month).toBe(5);
  });

  it("filters tasks by time window", async () => {
    await addBudget({ peer: "glados", daily_usd: 10, action: "warn" });

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    vi.mocked(listTaskStates).mockResolvedValue([
      {
        id: "task1",
        from: "h1",
        to: "glados",
        objective: "test",
        constraints: [],
        status: "completed",
        created_at: yesterday.toISOString(),
        updated_at: yesterday.toISOString(),
        result: { output: "", success: true, artifacts: [], cost_usd: 10 },
      },
    ]);

    const result = await checkBudget("glados", 0);
    expect(result.spent_today).toBe(0);
    expect(result.spent_month).toBe(10);
  });
});
