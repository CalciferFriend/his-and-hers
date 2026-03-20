/**
 * commands/budget-caps.ts — Phase 11b budget cap commands
 *
 * Manage per-peer cost caps with warn/block actions.
 *
 * Usage:
 *   cofounder budget list [--json]
 *   cofounder budget set <peer> --daily <n> [--monthly <n>] [--action warn|block]
 *   cofounder budget show <peer> [--json]
 *   cofounder budget remove <peer> [--force]
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  loadBudgets,
  addBudget,
  removeBudget,
  checkBudget,
  type BudgetConfig
} from "@cofounder/core";

export interface BudgetListOptions {
  json?: boolean;
}

export interface BudgetSetOptions {
  daily?: string;
  monthly?: string;
  action?: "warn" | "block";
}

export interface BudgetShowOptions {
  json?: boolean;
}

export interface BudgetRemoveOptions {
  force?: boolean;
}

export async function budgetList(opts: BudgetListOptions = {}) {
  const budgets = await loadBudgets();

  if (opts.json) {
    console.log(JSON.stringify(budgets, null, 2));
    return;
  }

  if (budgets.length === 0) {
    p.intro(pc.bgMagenta(pc.white(" cofounder budget list ")));
    p.log.info("No budget caps configured.");
    p.log.message("");
    p.log.info(pc.dim("Add a cap with: cofounder budget set <peer> --daily <usd>"));
    p.outro("Done.");
    return;
  }

  p.intro(pc.bgMagenta(pc.white(" cofounder budget list ")));
  p.log.message("");

  for (const b of budgets) {
    const limits: string[] = [];
    if (b.daily_usd) limits.push(`$${b.daily_usd.toFixed(2)}/day`);
    if (b.monthly_usd) limits.push(`$${b.monthly_usd.toFixed(2)}/month`);
    const limitStr = limits.join(", ");

    const status = await checkBudget(b.peer, 0);
    const spentToday = status.spent_today > 0 ? `$${status.spent_today.toFixed(4)}` : "$0";
    const spentMonth = status.spent_month > 0 ? `$${status.spent_month.toFixed(4)}` : "$0";

    p.log.info(pc.bold(pc.cyan(b.peer)));
    p.log.info(`  Limits:  ${limitStr}`);
    p.log.info(`  Action:  ${b.action === "block" ? pc.red("block") : pc.yellow("warn")}`);
    p.log.info(`  Spent:   ${spentToday} today, ${spentMonth} this month`);
    p.log.message("");
  }

  p.outro("Done.");
}

export async function budgetSet(
  peer: string,
  opts: BudgetSetOptions
) {
  if (!opts.daily && !opts.monthly) {
    p.log.error("At least one of --daily or --monthly is required");
    process.exit(1);
  }

  const daily_usd = opts.daily ? parseFloat(opts.daily) : undefined;
  const monthly_usd = opts.monthly ? parseFloat(opts.monthly) : undefined;

  if (daily_usd !== undefined && (isNaN(daily_usd) || daily_usd <= 0)) {
    p.log.error("--daily must be a positive number");
    process.exit(1);
  }

  if (monthly_usd !== undefined && (isNaN(monthly_usd) || monthly_usd <= 0)) {
    p.log.error("--monthly must be a positive number");
    process.exit(1);
  }

  const budget: BudgetConfig = {
    peer,
    daily_usd,
    monthly_usd,
    action: opts.action || "warn",
  };

  await addBudget(budget);

  p.intro(pc.bgMagenta(pc.white(" cofounder budget set ")));
  p.log.success(`Budget cap set for ${pc.cyan(peer)}`);
  p.log.message("");

  if (daily_usd) p.log.info(`  Daily limit:   $${daily_usd.toFixed(2)}`);
  if (monthly_usd) p.log.info(`  Monthly limit: $${monthly_usd.toFixed(2)}`);
  p.log.info(`  Action:        ${budget.action === "block" ? pc.red("block") : pc.yellow("warn")}`);

  p.outro("Done.");
}

export async function budgetShow(peer: string, opts: BudgetShowOptions = {}) {
  const budgets = await loadBudgets();
  const budget = budgets.find((b) => b.peer === peer);

  if (!budget) {
    p.log.error(`No budget cap found for peer: ${peer}`);
    process.exit(1);
  }

  const status = await checkBudget(peer, 0);

  if (opts.json) {
    console.log(JSON.stringify({ budget, status }, null, 2));
    return;
  }

  p.intro(pc.bgMagenta(pc.white(` cofounder budget show — ${peer} `)));
  p.log.message("");

  if (budget.daily_usd) {
    p.log.info(`Daily limit:   $${budget.daily_usd.toFixed(2)}`);
    p.log.info(`  Spent today: $${status.spent_today.toFixed(4)}`);
    const pct = (status.spent_today / budget.daily_usd) * 100;
    p.log.info(`  Usage:       ${pct.toFixed(1)}%`);
    p.log.message("");
  }

  if (budget.monthly_usd) {
    p.log.info(`Monthly limit:   $${budget.monthly_usd.toFixed(2)}`);
    p.log.info(`  Spent this month: $${status.spent_month.toFixed(4)}`);
    const pct = (status.spent_month / budget.monthly_usd) * 100;
    p.log.info(`  Usage:           ${pct.toFixed(1)}%`);
    p.log.message("");
  }

  p.log.info(`Action: ${budget.action === "block" ? pc.red("block") : pc.yellow("warn")}`);

  if (status.reason) {
    p.log.message("");
    if (status.allowed) {
      p.log.warn(status.reason);
    } else {
      p.log.error(status.reason);
    }
  }

  p.outro("Done.");
}

export async function budgetRemove(peer: string, opts: BudgetRemoveOptions = {}) {
  const budgets = await loadBudgets();
  const exists = budgets.find((b) => b.peer === peer);

  if (!exists) {
    p.log.error(`No budget cap found for peer: ${peer}`);
    process.exit(1);
  }

  if (!opts.force) {
    const confirmed = await p.confirm({
      message: `Remove budget cap for ${peer}?`,
      initialValue: false,
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
  }

  const removed = await removeBudget(peer);

  if (!removed) {
    p.log.error("Failed to remove budget cap");
    process.exit(1);
  }

  p.outro(pc.green(`Budget cap removed for ${peer}`));
}
