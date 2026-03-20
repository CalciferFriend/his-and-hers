/**
 * commands/replay.ts — `cofounder replay <task-id>`
 *
 * Re-send a previously dispatched task with the same objective and constraints.
 * Useful when a task fails, times out, or you want to try a different peer
 * without re-typing the full task description.
 *
 * The original task state is left untouched — a brand new task ID is created
 * so the replay shows up as its own entry in `cofounder logs`.
 *
 * Usage:
 *   cofounder replay abc123             # replay by ID prefix
 *   cofounder replay abc123 --peer gpu  # override the target peer
 *   cofounder replay abc123 --wait      # block until result arrives
 *   cofounder replay abc123 --dry-run   # show what would be sent without sending
 *
 * The command accepts the same --wait / --no-webhook / --notify flags as
 * `cofounder send`, so you can pipe the result through the same webhook integrations.
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { loadConfig } from "../config/store.ts";
import { loadTaskState, listTaskStates, type TaskState } from "../state/tasks.ts";
import { send, type SendOptions } from "./send.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReplayOptions {
  /** Override the target peer by name */
  peer?: string;
  /** Block until the result arrives (same as cofounder send --wait) */
  wait?: boolean;
  /** Max seconds to wait for result when --wait is set */
  waitTimeoutSeconds?: string;
  /** Disable the result webhook server (polling only) */
  noWebhook?: boolean;
  /** Webhook URL for task completion notification */
  notify?: string;
  /** Print what would be sent without actually sending */
  dryRun?: boolean;
  /** Output as JSON (dry-run only) */
  json?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a task ID or prefix to a TaskState.
 * Tries exact match first, then prefix match across all stored tasks.
 */
async function resolveTask(idOrPrefix: string): Promise<TaskState | null> {
  // Try exact match first (cheap)
  const exact = await loadTaskState(idOrPrefix);
  if (exact) return exact;

  // Fall back to prefix match (full scan)
  const all = await listTaskStates();
  return all.find((t) => t.id.startsWith(idOrPrefix)) ?? null;
}

/** Format task metadata for display. */
function taskLine(task: TaskState): string {
  const statusColor =
    task.status === "completed"
      ? pc.green(task.status)
      : task.status === "failed" || task.status === "timeout"
        ? pc.red(task.status)
        : task.status === "running"
          ? pc.yellow(task.status)
          : pc.dim(task.status);

  const age = new Date(task.created_at).toLocaleString();
  return `${pc.dim(task.id.slice(0, 8))} [${statusColor}] → ${pc.bold(task.to)}  ${pc.dim(age)}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function replay(idOrPrefix: string, opts: ReplayOptions = {}) {
  const config = await loadConfig();

  if (!config) {
    p.log.error("No configuration found. Run `cofounder onboard` first.");
    process.exitCode = 1;
    return;
  }

  // Resolve task
  const task = await resolveTask(idOrPrefix);
  if (!task) {
    p.log.error(
      `No task found matching ${pc.bold(idOrPrefix)}.\n` +
        "  Use `cofounder logs` to list recent tasks.",
    );
    process.exitCode = 1;
    return;
  }

  const targetPeer = opts.peer ?? task.to;

  // Show a summary of the original task
  p.intro(`${pc.bold("Replaying task")} → ${pc.bold(targetPeer)}`);
  p.log.info(`Original: ${taskLine(task)}`);
  p.log.info(`Objective: ${pc.italic(task.objective)}`);

  if (task.constraints && task.constraints.length > 0) {
    p.log.info(`Constraints: ${task.constraints.map((c) => pc.dim(c)).join(", ")}`);
  }

  if (opts.peer && opts.peer !== task.to) {
    p.log.info(`${pc.cyan("Peer override:")} ${task.to} → ${opts.peer}`);
  }

  // Dry-run: show what would be sent and exit
  if (opts.dryRun) {
    const plan = {
      action: "replay",
      original_task_id: task.id,
      original_status: task.status,
      objective: task.objective,
      constraints: task.constraints,
      to: targetPeer,
      wait: opts.wait ?? false,
      notify: opts.notify ?? null,
    };

    if (opts.json) {
      process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
    } else {
      p.log.info(pc.yellow("Dry run — no message sent."));
      p.log.info(`Would send: ${pc.italic(task.objective)}`);
      p.log.info(`To peer:   ${targetPeer}`);
      p.log.info(`Wait:      ${opts.wait ? "yes" : "no"}`);
      if (opts.notify) p.log.info(`Notify:    ${opts.notify}`);
    }
    p.outro("Dry run complete.");
    return;
  }

  // Build the task string from objective + constraints
  // Constraints are re-attached as a parenthetical so they travel in the
  // message text, just as they would have in the original cofounder send.
  let taskText = task.objective;
  if (task.constraints && task.constraints.length > 0) {
    taskText += `\n\nConstraints:\n${task.constraints.map((c) => `- ${c}`).join("\n")}`;
  }

  // Delegate to send() — this creates a fresh task state with a new ID
  const sendOpts: SendOptions = {
    peer: targetPeer,
    wait: opts.wait,
    waitTimeoutSeconds: opts.waitTimeoutSeconds,
    noWebhook: opts.noWebhook,
    notify: opts.notify,
    // Don't apply cron retry guard for manual replays
    force: true,
  };

  await send(taskText, sendOpts);
}
