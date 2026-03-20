/**
 * core/budget.ts — Per-peer cost caps and budget enforcement
 *
 * Enables setting daily/monthly USD limits per peer with warn or block actions.
 * Integrates with cofounder send to check budget before dispatching.
 */

import { z } from "zod";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { listTaskStates } from "../../sdk/src/state.ts";

function getBudgetPath() {
  return join(homedir(), ".cofounder", "budget.json");
}

export const BudgetConfig = z.object({
  peer: z.string().min(1),
  daily_usd: z.number().positive().optional(),
  monthly_usd: z.number().positive().optional(),
  action: z.enum(["warn", "block"]).default("warn"),
});

export type BudgetConfig = z.infer<typeof BudgetConfig>;

const BudgetRegistry = z.array(BudgetConfig);
type BudgetRegistry = z.infer<typeof BudgetRegistry>;

export interface CheckBudgetResult {
  allowed: boolean;
  reason?: string;
  spent_today: number;
  spent_month: number;
  limit: number;
  limit_type: "daily" | "monthly" | "none";
}

/**
 * Load all budget rules from disk.
 */
export async function loadBudgets(): Promise<BudgetRegistry> {
  if (!existsSync(getBudgetPath())) {
    return [];
  }
  try {
    const raw = await readFile(getBudgetPath(), "utf-8");
    return BudgetRegistry.parse(JSON.parse(raw));
  } catch {
    return [];
  }
}

/**
 * Save budget rules to disk.
 */
export async function saveBudgets(budgets: BudgetRegistry): Promise<void> {
  const budgetPath = getBudgetPath();
  await mkdir(join(homedir(), ".cofounder"), { recursive: true });
  await writeFile(budgetPath, JSON.stringify(budgets, null, 2), "utf-8");
}

/**
 * Add or update a budget rule for a peer.
 */
export async function addBudget(budget: BudgetConfig): Promise<void> {
  const budgets = await loadBudgets();
  const existing = budgets.findIndex((b) => b.peer === budget.peer);
  if (existing >= 0) {
    budgets[existing] = budget;
  } else {
    budgets.push(budget);
  }
  await saveBudgets(budgets);
}

/**
 * Remove a budget rule for a peer.
 */
export async function removeBudget(peer: string): Promise<boolean> {
  const budgets = await loadBudgets();
  const filtered = budgets.filter((b) => b.peer !== peer);
  if (filtered.length === budgets.length) {
    return false; // Not found
  }
  await saveBudgets(filtered);
  return true;
}

/**
 * Check if a task can be sent to a peer based on budget limits.
 * Returns { allowed: true } if OK, or { allowed: false, reason } if blocked.
 * For warn action, returns allowed=true but includes warning reason.
 */
export async function checkBudget(
  peer: string,
  estimatedCost: number = 0,
): Promise<CheckBudgetResult> {
  const budgets = await loadBudgets();
  const budget = budgets.find((b) => b.peer === peer);

  if (!budget) {
    return {
      allowed: true,
      spent_today: 0,
      spent_month: 0,
      limit: 0,
      limit_type: "none",
    };
  }

  // Calculate current spend
  const tasks = await listTaskStates();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const spent_today = tasks
    .filter((t) => t.to === peer && new Date(t.created_at).getTime() >= todayStart)
    .reduce((sum, t) => sum + (t.result?.cost_usd ?? 0), 0);

  const spent_month = tasks
    .filter((t) => t.to === peer && new Date(t.created_at).getTime() >= monthStart)
    .reduce((sum, t) => sum + (t.result?.cost_usd ?? 0), 0);

  // Check daily limit
  if (budget.daily_usd !== undefined) {
    const newTotal = spent_today + estimatedCost;
    if (newTotal > budget.daily_usd) {
      const reason = `Daily budget exceeded for ${peer}: $${newTotal.toFixed(2)} > $${budget.daily_usd.toFixed(2)}`;
      return {
        allowed: budget.action === "warn",
        reason,
        spent_today,
        spent_month,
        limit: budget.daily_usd,
        limit_type: "daily",
      };
    }
    // Warn threshold (>80%)
    if (newTotal > budget.daily_usd * 0.8) {
      return {
        allowed: true,
        reason: `Daily budget warning for ${peer}: $${newTotal.toFixed(2)} / $${budget.daily_usd.toFixed(2)} (${((newTotal / budget.daily_usd) * 100).toFixed(0)}%)`,
        spent_today,
        spent_month,
        limit: budget.daily_usd,
        limit_type: "daily",
      };
    }
  }

  // Check monthly limit
  if (budget.monthly_usd !== undefined) {
    const newTotal = spent_month + estimatedCost;
    if (newTotal > budget.monthly_usd) {
      const reason = `Monthly budget exceeded for ${peer}: $${newTotal.toFixed(2)} > $${budget.monthly_usd.toFixed(2)}`;
      return {
        allowed: budget.action === "warn",
        reason,
        spent_today,
        spent_month,
        limit: budget.monthly_usd,
        limit_type: "monthly",
      };
    }
    // Warn threshold (>80%)
    if (newTotal > budget.monthly_usd * 0.8) {
      return {
        allowed: true,
        reason: `Monthly budget warning for ${peer}: $${newTotal.toFixed(2)} / $${budget.monthly_usd.toFixed(2)} (${((newTotal / budget.monthly_usd) * 100).toFixed(0)}%)`,
        spent_today,
        spent_month,
        limit: budget.monthly_usd,
        limit_type: "monthly",
      };
    }
  }

  // All good
  return {
    allowed: true,
    spent_today,
    spent_month,
    limit: budget.daily_usd ?? budget.monthly_usd ?? 0,
    limit_type: budget.daily_usd ? "daily" : budget.monthly_usd ? "monthly" : "none",
  };
}
