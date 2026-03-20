/**
 * commands/cancel.ts — `cofounder cancel <task-id>`
 *
 * Mark a pending or running task as cancelled.  Useful when you sent the
 * wrong task, a task is stuck pending because H2 never woke, or you want
 * to clean up the queue before a replay.
 *
 * Only pending and running tasks can be cancelled — completed/failed/timeout
 * tasks are already terminal and cannot be mutated.
 *
 * Usage:
 *   cofounder cancel abc123             # cancel by ID prefix
 *   cofounder cancel abc123 --force     # cancel even if already in a terminal state
 *   cofounder cancel abc123 --json      # machine-readable output
 *   cofounder cancel --all-pending      # cancel every pending task at once
 *
 * Exit codes:
 *   0  — cancelled successfully (or --all-pending with ≥1 task cancelled)
 *   1  — task not found, already terminal (without --force), or no tasks
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { loadTaskState, listTaskStates, updateTaskState, type TaskState } from "../state/tasks.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CancelOptions {
  /** Skip the terminal-state guard and forcibly cancel regardless of status */
  force?: boolean;
  /** Cancel all pending tasks at once */
  allPending?: boolean;
  /** Machine-readable JSON output */
  json?: boolean;
}

/** Statuses that are not yet terminal and can be cancelled */
const CANCELLABLE = new Set(["pending", "running"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function taskLine(task: TaskState): string {
  const age = new Date(task.created_at).toLocaleString();
  return `${pc.dim(task.id.slice(0, 8))} [${pc.yellow(task.status)}] → ${pc.bold(task.to)}  ${pc.dim(age)}`;
}

async function resolveTask(idOrPrefix: string): Promise<TaskState | null> {
  const exact = await loadTaskState(idOrPrefix);
  if (exact) return exact;

  const all = await listTaskStates();
  return all.find((t) => t.id.startsWith(idOrPrefix)) ?? null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function cancel(idOrPrefix: string | undefined, opts: CancelOptions = {}) {
  // ── Cancel all pending tasks ─────────────────────────────────────────────
  if (opts.allPending) {
    const all = await listTaskStates();
    const pending = all.filter((t) => t.status === "pending");

    if (pending.length === 0) {
      if (opts.json) {
        process.stdout.write(JSON.stringify({ cancelled: [], message: "No pending tasks found." }) + "\n");
      } else {
        p.log.info("No pending tasks to cancel.");
      }
      process.exitCode = 1;
      return;
    }

    const results: { id: string; objective: string }[] = [];

    for (const task of pending) {
      await updateTaskState(task.id, {
        status: "cancelled",
        result: {
          output: "",
          success: false,
          error: "Cancelled by user (--all-pending)",
          artifacts: [],
        },
      });
      results.push({ id: task.id, objective: task.objective });
    }

    if (opts.json) {
      process.stdout.write(JSON.stringify({ cancelled: results }) + "\n");
    } else {
      p.intro(pc.bgRed(pc.white(" cofounder cancel ")));
      p.note(
        results.map((r) => `${pc.dim(r.id.slice(0, 8))}  ${pc.italic(r.objective.slice(0, 60))}`).join("\n"),
        `Cancelled ${results.length} pending task${results.length === 1 ? "" : "s"}`,
      );
      p.outro(pc.red(`${results.length} task${results.length === 1 ? "" : "s"} cancelled.`));
    }
    return;
  }

  // ── Single task cancel ───────────────────────────────────────────────────
  if (!idOrPrefix) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ error: "No task ID provided and --all-pending not set." }) + "\n");
    } else {
      p.log.error("Provide a task ID or use --all-pending.\n  Usage: cofounder cancel <id>  |  cofounder cancel --all-pending");
    }
    process.exitCode = 1;
    return;
  }

  const task = await resolveTask(idOrPrefix);

  if (!task) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ error: `No task found matching "${idOrPrefix}".` }) + "\n");
    } else {
      p.log.error(
        `No task found matching ${pc.bold(idOrPrefix)}.\n` +
          "  Use `cofounder logs` to list recent tasks.",
      );
    }
    process.exitCode = 1;
    return;
  }

  // Guard: already terminal?
  if (!CANCELLABLE.has(task.status) && !opts.force) {
    if (opts.json) {
      process.stdout.write(
        JSON.stringify({
          error: `Task ${task.id} is already in terminal state "${task.status}". Use --force to override.`,
          id: task.id,
          status: task.status,
        }) + "\n",
      );
    } else {
      p.log.warn(
        `Task ${pc.bold(task.id.slice(0, 8))} is already ${pc.bold(task.status)} — cannot cancel a terminal task.\n` +
          `  Use ${pc.cyan("--force")} to override, or ${pc.cyan("cofounder replay")} to re-send.`,
      );
    }
    process.exitCode = 1;
    return;
  }

  if (!opts.json) {
    p.intro(pc.bgRed(pc.white(" cofounder cancel ")));
    p.log.info(`Task:      ${taskLine(task)}`);
    p.log.info(`Objective: ${pc.italic(task.objective)}`);
  }

  const updated = await updateTaskState(task.id, {
    status: "cancelled",
    result: {
      output: "",
      success: false,
      error: "Cancelled by user",
      artifacts: [],
    },
  });

  if (opts.json) {
    process.stdout.write(
      JSON.stringify({
        id: updated.id,
        status: updated.status,
        objective: updated.objective,
        cancelled_at: updated.updated_at,
      }) + "\n",
    );
  } else {
    p.outro(pc.red(`Task ${pc.bold(updated.id.slice(0, 8))} cancelled.`));
  }
}
