/**
 * commands/budget.ts — `hh budget`
 *
 * Show token usage and cost spend across recent tasks.
 * Helps users understand cloud costs and potential local savings.
 *
 * Usage:
 *   hh budget               → this week's summary
 *   hh budget --today       → today only
 *   hh budget --month       → last 30 days
 *   hh budget --all         → all time
 *   hh budget --tasks       → per-task breakdown table
 *   hh budget --json        → raw JSON output
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { buildBudgetSummary, type BudgetSummary } from "../state/budget.ts";
import { formatCost, formatTokens } from "@his-and-hers/core";

export interface BudgetOptions {
  today?: boolean;
  month?: boolean;
  all?: boolean;
  tasks?: boolean;
  json?: boolean;
}

export async function budget(opts: BudgetOptions = {}) {
  const window: BudgetSummary["window"] = opts.today
    ? "today"
    : opts.month
      ? "month"
      : opts.all
        ? "all"
        : "week";

  const summary = await buildBudgetSummary(window);

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const windowLabel = {
    today: "Today",
    week: "This week",
    month: "This month",
    all: "All time",
  }[window];

  p.intro(pc.bgMagenta(pc.white(` hh budget — ${windowLabel} `)));

  // ── Overview ─────────────────────────────────────────────────────────────

  const totalTasks = summary.completed + summary.failed + summary.pending;
  if (totalTasks === 0) {
    p.log.info("No tasks found in this time window.");
    p.log.info(pc.dim("Send a task with `hh send` to start tracking usage."));
    p.outro("Nothing to show.");
    return;
  }

  // Task counts
  p.log.info(
    `Tasks: ${pc.bold(String(totalTasks))} total ` +
    `(${pc.green(String(summary.completed))} completed, ` +
    `${pc.red(String(summary.failed))} failed, ` +
    `${pc.yellow(String(summary.pending))} pending)`,
  );

  p.log.message("");

  // ── Token & Cost breakdown ────────────────────────────────────────────────

  if (summary.total_tokens > 0) {
    const cloudTokens = summary.total_tokens - summary.local_tokens;

    p.log.info(pc.bold("Token usage:"));
    p.log.info(
      `  Total:   ${pc.cyan(formatTokens(summary.total_tokens))} tokens`,
    );
    if (cloudTokens > 0) {
      p.log.info(
        `  Cloud:   ${pc.yellow(formatTokens(cloudTokens))} tokens  →  ${pc.yellow(formatCost(summary.cloud_cost_usd))}`,
      );
    }
    if (summary.local_tokens > 0) {
      p.log.info(
        `  Local:   ${pc.green(formatTokens(summary.local_tokens))} tokens  →  ${pc.green("$0.00 (H2 GPU)")}`,
      );
    }

    p.log.message("");
    p.log.info(pc.bold("Cost:"));
    p.log.info(`  Cloud spend:     ${pc.yellow(formatCost(summary.cloud_cost_usd))}`);

    if (summary.estimated_cloud_savings_usd > 0) {
      p.log.info(
        `  Local savings:   ${pc.green(`~${formatCost(summary.estimated_cloud_savings_usd)}`)} ${pc.dim("(est. vs Sonnet pricing)")}`,
      );
    }

    const net = summary.total_cost_usd;
    p.log.info(
      `  Net spend:       ${net > 0 ? pc.yellow(formatCost(net)) : pc.green("$0.00")}`,
    );
  } else {
    p.log.info(pc.dim("No token data recorded — tasks may predate budget tracking."));
    p.log.info(pc.dim("Pass --tokens <n> to `hh result` to start tracking."));
  }

  // ── Routing advice ────────────────────────────────────────────────────────

  if (summary.total_cost_usd > 1.0) {
    p.log.message("");
    p.log.warn(
      `Cloud spend is ${formatCost(summary.cloud_cost_usd)} ${windowLabel.toLowerCase()}. ` +
      `Route heavy tasks to H2: ${pc.cyan("hh send --caps-route <task>")}`,
    );
  }

  if (summary.local_tokens === 0 && summary.total_tokens > 0) {
    p.log.message("");
    p.log.info(
      pc.dim("💡 All tasks ran on cloud. If H2 has Ollama installed, run `hh capabilities fetch` to enable local routing."),
    );
  }

  // ── Per-task breakdown ────────────────────────────────────────────────────

  if (opts.tasks && summary.tasks.length > 0) {
    p.log.message("");
    p.log.info(pc.bold("Per-task breakdown:"));

    const rows = summary.tasks
      .filter((t) => t.status === "completed" || t.status === "failed")
      .slice(0, 20); // cap at 20 rows

    for (const t of rows) {
      const shortId = pc.dim(t.id.slice(0, 8));
      const obj = t.objective.length > 40
        ? t.objective.slice(0, 39) + "…"
        : t.objective.padEnd(40);
      const toks = t.tokens_used ? formatTokens(t.tokens_used).padStart(6) : "   n/a";
      const cost = t.cost_usd !== undefined
        ? (t.cost_estimated ? pc.dim(`~${formatCost(t.cost_usd)}`) : formatCost(t.cost_usd)).padStart(12)
        : pc.dim("        n/a");
      const status = t.status === "completed" ? pc.green("✓") : pc.red("✗");

      p.log.info(`  ${status} ${shortId}  ${pc.italic(obj)}  ${toks} tok  ${cost}`);
    }

    if (summary.tasks.length > 20) {
      p.log.info(pc.dim(`  … and ${summary.tasks.length - 20} more`));
    }
  } else if (!opts.tasks) {
    p.log.message("");
    p.log.info(pc.dim("Add --tasks for a per-task breakdown."));
  }

  p.outro("Budget check complete.");
}
