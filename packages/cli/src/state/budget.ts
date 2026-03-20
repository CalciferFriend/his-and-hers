/**
 * state/budget.ts
 *
 * Budget aggregation across completed task states.
 *
 * We don't maintain a separate budget database — we derive it on demand from
 * the task state files (already on disk). This keeps things simple: tasks
 * are the source of truth and budget is always fresh.
 *
 * For users who send many tasks per day, listing + parsing a few hundred
 * JSON files is still fast (<100ms). If perf becomes an issue we can add
 * a rolling summary file later.
 */

import { listTaskStates } from "./tasks.ts";
import type { TaskState } from "./tasks.ts";
import { estimateCost, getPricing } from "@cofounder/core";

export interface TaskBudgetEntry {
  id: string;
  objective: string;
  status: TaskState["status"];
  created_at: string;
  tokens_used?: number;
  cost_usd?: number;
  model?: string;
  routing_hint?: string;
  /** true when cost was explicitly provided, false when estimated */
  cost_estimated: boolean;
}

export interface BudgetSummary {
  /** All tasks in the window */
  tasks: TaskBudgetEntry[];
  /** Totals */
  total_tokens: number;
  total_cost_usd: number;
  /** Cost split: cloud vs local */
  cloud_cost_usd: number;
  local_tokens: number;
  /** How much we saved by routing locally (vs cloud pricing for those tokens) */
  estimated_cloud_savings_usd: number;
  /** Counts */
  completed: number;
  failed: number;
  pending: number;
  /** Window label */
  window: "today" | "week" | "month" | "all";
}

function windowStart(window: BudgetSummary["window"]): Date {
  const now = new Date();
  switch (window) {
    case "today": {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case "week": {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return d;
    }
    case "month": {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 1);
      return d;
    }
    case "all":
      return new Date(0);
  }
}

/**
 * Build a budget summary across all task state files for the given window.
 *
 * @param window  Time window to aggregate (default: week)
 * @param model   Model string used for cost estimation when not stored in task
 */
export async function buildBudgetSummary(
  window: BudgetSummary["window"] = "week",
  model = "anthropic/claude-sonnet-4-6",
): Promise<BudgetSummary> {
  const allTasks = await listTaskStates();
  const since = windowStart(window);

  const entries: TaskBudgetEntry[] = [];
  let total_tokens = 0;
  let total_cost_usd = 0;
  let cloud_cost_usd = 0;
  let local_tokens = 0;
  let estimated_cloud_savings_usd = 0;
  let completed = 0;
  let failed = 0;
  let pending = 0;

  // Cloud fallback pricing for savings calc (Sonnet rate)
  const cloudFallback = getPricing("anthropic/claude-sonnet-4-6")!;

  for (const task of allTasks) {
    const created = new Date(task.created_at);
    if (created < since) continue;

    const tokens = task.result?.tokens_used;
    const taskModel = (task as { model?: string }).model ?? model;
    const isLocal = taskModel.startsWith("ollama") || taskModel.startsWith("lmstudio") || taskModel.startsWith("custom");

    let cost_usd: number | undefined;
    let cost_estimated = false;

    if (tokens) {
      const computed = estimateCost(tokens, taskModel);
      if (computed !== null) {
        cost_usd = computed;
        cost_estimated = true; // estimated unless explicitly stored
      }
    }

    // Use explicitly stored cost if available (future: task.result.cost_usd)
    const explicitCost = (task.result as { cost_usd?: number } | null)?.cost_usd;
    if (explicitCost !== undefined) {
      cost_usd = explicitCost;
      cost_estimated = false;
    }

    const entry: TaskBudgetEntry = {
      id: task.id,
      objective: task.objective,
      status: task.status,
      created_at: task.created_at,
      tokens_used: tokens,
      cost_usd,
      model: taskModel,
      routing_hint: task.routing_hint,
      cost_estimated,
    };

    entries.push(entry);

    // Accumulate totals
    if (task.status === "completed") completed++;
    else if (task.status === "failed") failed++;
    else pending++;

    if (tokens) {
      total_tokens += tokens;
      if (isLocal) {
        local_tokens += tokens;
        // Savings: what cloud would have cost
        const cloudCost = (tokens / 1000) * cloudFallback.outputPer1k;
        estimated_cloud_savings_usd += cloudCost;
      } else {
        cloud_cost_usd += cost_usd ?? 0;
        total_cost_usd += cost_usd ?? 0;
      }
    }
  }

  return {
    tasks: entries,
    total_tokens,
    total_cost_usd,
    cloud_cost_usd,
    local_tokens,
    estimated_cloud_savings_usd,
    completed,
    failed,
    pending,
    window,
  };
}

/**
 * Return a simple routing recommendation based on current budget state.
 * Called by `cofounder send` to suggest local routing when cloud spend is high.
 */
export function budgetRoutingAdvice(summary: BudgetSummary): string | null {
  if (summary.total_cost_usd > 5.0) {
    return `Cloud spend is $${summary.total_cost_usd.toFixed(2)} this ${summary.window} — consider routing heavy tasks to H2 (local GPU)`;
  }
  if (summary.total_cost_usd > 1.0 && summary.local_tokens === 0) {
    return `No local tasks this ${summary.window} — cofounder send supports H2's Ollama for heavy workloads`;
  }
  return null;
}
