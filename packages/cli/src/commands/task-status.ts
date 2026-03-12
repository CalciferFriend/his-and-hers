/**
 * commands/task-status.ts — `hh task-status [task-id]`
 *
 * Show the status of pending/completed tasks.
 *
 * Usage:
 *   hh task-status                — list all recent tasks
 *   hh task-status <id-or-prefix> — show one task in detail
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { loadTaskState, listTaskStates, type TaskStatus } from "../state/tasks.ts";

const STATUS_COLORS: Record<TaskStatus, (s: string) => string> = {
  pending:   (s) => pc.yellow(s),
  running:   (s) => pc.cyan(s),
  completed: (s) => pc.green(s),
  failed:    (s) => pc.red(s),
  timeout:   (s) => pc.dim(s),
};

export async function taskStatus(idPrefix?: string) {
  if (idPrefix) {
    // Show a single task — try exact match first, then prefix match
    let task = await loadTaskState(idPrefix);

    if (!task) {
      // Try prefix match against all tasks
      const all = await listTaskStates();
      task = all.find((t) => t.id.startsWith(idPrefix)) ?? null;
    }

    if (!task) {
      p.log.error(`No task found matching: ${idPrefix}`);
      process.exitCode = 1;
      return;
    }

    p.intro(pc.bgCyan(pc.black(" hh task-status ")));

    const colorFn = STATUS_COLORS[task.status];
    p.log.info(`${pc.bold("Task ID:")}   ${task.id}`);
    p.log.info(`${pc.bold("Status:")}    ${colorFn(task.status)}`);
    p.log.info(`${pc.bold("Objective:")} ${task.objective}`);
    p.log.info(`${pc.bold("From:")}      ${task.from} → ${task.to}`);
    p.log.info(`${pc.bold("Created:")}   ${formatDateTime(task.created_at)}`);
    p.log.info(`${pc.bold("Updated:")}   ${formatDateTime(task.updated_at)}`);

    if (task.routing_hint) {
      p.log.info(`${pc.bold("Routing:")}   ${task.routing_hint}`);
    }

    if (task.result) {
      p.log.info("");
      p.log.info(pc.bold("Result:"));
      p.log.info(`  Success: ${task.result.success ? pc.green("yes") : pc.red("no")}`);
      if (task.result.error) {
        p.log.info(`  Error:   ${pc.red(task.result.error)}`);
      }
      p.log.info(`  Output:  ${task.result.output.slice(0, 300)}${task.result.output.length > 300 ? "…" : ""}`);
      if (task.result.artifacts.length > 0) {
        p.log.info(`  Artifacts: ${task.result.artifacts.join(", ")}`);
      }
      if (task.result.tokens_used) {
        p.log.info(`  Tokens:  ${task.result.tokens_used.toLocaleString()}`);
      }
      if (task.result.duration_ms) {
        p.log.info(`  Duration: ${(task.result.duration_ms / 1000).toFixed(1)}s`);
      }
    } else if (task.status === "pending" || task.status === "running") {
      p.log.info("");
      p.log.info(pc.dim("Result not yet available. Run with --wait or check back later."));
    }

    p.outro("");
  } else {
    // List all tasks
    const tasks = await listTaskStates();

    if (tasks.length === 0) {
      p.log.info("No tasks found. Send one with: hh send \"<task>\"");
      return;
    }

    p.intro(pc.bgCyan(pc.black(" hh task-status ")));
    p.log.info(`${pc.bold("Recent tasks:")} (${tasks.length} total)\n`);

    for (const task of tasks.slice(0, 20)) {
      const colorFn = STATUS_COLORS[task.status];
      const shortId = pc.dim(task.id.slice(0, 8));
      const statusStr = colorFn(task.status.padEnd(9));
      const age = formatAge(task.created_at);
      const obj = task.objective.slice(0, 60) + (task.objective.length > 60 ? "…" : "");
      p.log.info(`  ${shortId}  ${statusStr}  ${pc.dim(age)}  ${obj}`);
    }

    if (tasks.length > 20) {
      p.log.info(pc.dim(`  … and ${tasks.length - 20} more`));
    }

    p.log.info("");
    p.log.info(pc.dim("  Use: hh task-status <id-prefix> for details"));
    p.outro("");
  }
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

function formatAge(iso: string): string {
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 120) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${(secs / 3600).toFixed(1)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}
