/**
 * commands/logs.ts — `hh logs`
 *
 * Pretty-print the full task history with filtering and formatting options.
 * Complements `hh task-status` (single-task inspect) with a log-style view
 * of all tasks across time.
 *
 * Usage:
 *   hh logs                          # all tasks, newest-first
 *   hh logs --limit 20               # last 20 tasks
 *   hh logs --status completed       # filter by status
 *   hh logs --status failed          # show failures only
 *   hh logs --peer glados            # filter by peer
 *   hh logs --since 24h              # last 24 hours (also: 7d, 1h, 30m)
 *   hh logs --output                 # include result output text
 *   hh logs --json                   # raw JSON array
 *   hh logs --follow                 # live tail (poll every 2s)
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { listTaskStates, type TaskState, type TaskStatus } from "../state/tasks.ts";

export interface LogsOptions {
  limit?: string;
  status?: string;
  peer?: string;
  since?: string;
  output?: boolean;
  json?: boolean;
  follow?: boolean;
}

// ─── Duration parser ──────────────────────────────────────────────────────────

function parseDuration(s: string): number | null {
  const match = s.match(/^(\d+(?:\.\d+)?)(s|m|h|d)$/i);
  if (!match) return null;
  const n = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * (multipliers[unit] ?? 1000);
}

// ─── Formatting helpers ────────────────────────────────────────────────────────

function statusBadge(status: TaskStatus): string {
  switch (status) {
    case "completed": return pc.green("✓ done   ");
    case "failed":    return pc.red("✗ failed ");
    case "pending":   return pc.yellow("⏳ pending");
    case "running":   return pc.cyan("⚡ running");
    case "timeout":   return pc.magenta("⏱ timeout");
    default:          return pc.dim("? unknown");
  }
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return pc.dim("unknown");
  // Show relative time if recent, absolute if older
  const ageMs = Date.now() - d.getTime();
  if (ageMs < 60_000)      return pc.dim(`${Math.round(ageMs / 1000)}s ago`);
  if (ageMs < 3_600_000)   return pc.dim(`${Math.round(ageMs / 60_000)}m ago`);
  if (ageMs < 86_400_000)  return pc.dim(`${Math.round(ageMs / 3_600_000)}h ago`);
  return pc.dim(d.toLocaleDateString());
}

function fmtDuration(ms?: number): string {
  if (!ms) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

function fmtCost(usd?: number): string {
  if (usd === undefined || usd === null) return "";
  if (usd === 0) return pc.dim("$0 (local)");
  return pc.dim(`$${usd.toFixed(4)}`);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

// ─── Core render ─────────────────────────────────────────────────────────────

function renderTask(task: TaskState, showOutput: boolean): void {
  const shortId = pc.dim(task.id.slice(0, 8));
  const badge = statusBadge(task.status);
  const time = fmtTime(task.created_at);
  const peer = pc.blue(task.to);
  const objective = pc.bold(truncate(task.objective, 72));
  const routing = task.routing_hint ? pc.dim(` [${task.routing_hint}]`) : "";

  console.log(`  ${badge}  ${shortId}  ${time}  → ${peer}${routing}`);
  console.log(`           ${objective}`);

  if (task.result) {
    const extras: string[] = [];
    if (task.result.tokens_used) extras.push(`${task.result.tokens_used.toLocaleString()} tok`);
    if (task.result.duration_ms) extras.push(fmtDuration(task.result.duration_ms));
    if (task.result.cost_usd !== undefined) extras.push(fmtCost(task.result.cost_usd));
    if (task.result.artifacts?.length) extras.push(`${task.result.artifacts.length} artifact(s)`);

    if (extras.length > 0) {
      console.log(`           ${pc.dim(extras.join("  ·  "))}`);
    }

    if (task.status === "failed" && task.result.error) {
      console.log(`           ${pc.red("Error: ")}${pc.dim(truncate(task.result.error, 80))}`);
    }

    if (showOutput && task.result.output) {
      const lines = task.result.output.split("\n").slice(0, 6);
      for (const line of lines) {
        console.log(`           ${pc.dim("│")} ${pc.dim(truncate(line, 76))}`);
      }
      if (task.result.output.split("\n").length > 6) {
        console.log(`           ${pc.dim("│")} ${pc.dim("(truncated…)")}`);
      }
    }
  }

  console.log("");
}

// ─── Filter + sort ───────────────────────────────────────────────────────────

function applyFilters(
  tasks: TaskState[],
  opts: LogsOptions,
): TaskState[] {
  let result = [...tasks];

  // Status filter
  if (opts.status) {
    result = result.filter(t => t.status === opts.status);
  }

  // Peer filter (case-insensitive substring)
  if (opts.peer) {
    const needle = opts.peer.toLowerCase();
    result = result.filter(t =>
      t.to.toLowerCase().includes(needle) ||
      t.from.toLowerCase().includes(needle),
    );
  }

  // Since filter
  if (opts.since) {
    const durationMs = parseDuration(opts.since);
    if (durationMs !== null) {
      const cutoff = Date.now() - durationMs;
      result = result.filter(t => new Date(t.created_at).getTime() >= cutoff);
    }
  }

  // Sort newest-first
  result.sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  // Limit
  const limit = opts.limit ? parseInt(opts.limit, 10) : 50;
  if (!isNaN(limit) && limit > 0) {
    result = result.slice(0, limit);
  }

  return result;
}

// ─── Summary footer ───────────────────────────────────────────────────────────

function renderSummary(tasks: TaskState[]): void {
  const counts: Record<string, number> = {};
  let totalCost = 0;
  let totalTokens = 0;

  for (const t of tasks) {
    counts[t.status] = (counts[t.status] ?? 0) + 1;
    if (t.result?.cost_usd) totalCost += t.result.cost_usd;
    if (t.result?.tokens_used) totalTokens += t.result.tokens_used;
  }

  const parts = Object.entries(counts).map(([s, n]) => {
    const badge = statusBadge(s as TaskStatus).trim();
    return `${badge} ${n}`;
  });

  const footer = [
    `${tasks.length} task(s)`,
    ...parts,
    totalTokens > 0 ? `${totalTokens.toLocaleString()} tokens` : "",
    totalCost > 0 ? `$${totalCost.toFixed(4)} spent` : "",
  ].filter(Boolean).join(pc.dim("  ·  "));

  console.log(pc.dim("─".repeat(72)));
  console.log(`  ${footer}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function renderOnce(opts: LogsOptions): Promise<TaskState[]> {
  const all = await listTaskStates();
  const filtered = applyFilters(all, opts);

  if (filtered.length === 0) {
    p.log.info("No tasks found matching the given filters.");
    if (all.length === 0) {
      p.log.info('Run `hh send "<task>"` to delegate work to your H2 node.');
    }
    return filtered;
  }

  if (!opts.json) {
    // Build a label for the heading
    const parts: string[] = [];
    if (opts.since) parts.push(`last ${opts.since}`);
    if (opts.status) parts.push(`status=${opts.status}`);
    if (opts.peer) parts.push(`peer=${opts.peer}`);
    const label = parts.length > 0 ? ` (${parts.join(", ")})` : "";
    p.intro(pc.bgBlue(pc.white(` hh logs${label} `)));
    console.log("");
  }

  if (opts.json) {
    console.log(JSON.stringify(filtered, null, 2));
    return filtered;
  }

  for (const task of filtered) {
    renderTask(task, opts.output ?? false);
  }

  renderSummary(filtered);

  if (!opts.follow) {
    p.outro("");
  }

  return filtered;
}

export async function logs(opts: LogsOptions = {}): Promise<void> {
  if (opts.follow) {
    p.intro(pc.bgBlue(pc.white(" hh logs --follow ")));
    console.log(pc.dim("  Polling for new tasks every 2s — Ctrl-C to exit\n"));

    let knownIds = new Set<string>();

    // Initial render (last 20)
    const initial = await listTaskStates();
    const filtered = applyFilters(initial, { ...opts, follow: false });
    for (const task of filtered.slice(0, 20)) {
      renderTask(task, opts.output ?? false);
      knownIds.add(task.id);
    }

    // Poll loop
    while (true) {
      await new Promise(r => setTimeout(r, 2000));
      const current = await listTaskStates();
      const updated = applyFilters(current, { ...opts, follow: false });

      for (const task of updated) {
        // Print new tasks
        if (!knownIds.has(task.id)) {
          console.log(pc.green("  ── new task ──────────────────────────────────────"));
          renderTask(task, opts.output ?? false);
          knownIds.add(task.id);
          continue;
        }
        // Print status changes (pending → completed/failed etc)
        const prev = filtered.find(t => t.id === task.id);
        if (prev && prev.status !== task.status) {
          console.log(pc.cyan(`  ── updated: ${task.id.slice(0, 8)} ${prev.status} → ${task.status} ──`));
          renderTask(task, opts.output ?? false);
        }
      }
    }
  } else {
    await renderOnce(opts);
  }
}
