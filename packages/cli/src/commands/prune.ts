/**
 * commands/prune.ts — `cofounder prune`
 *
 * Clean up stale task state files, retry records, and schedule logs.
 * Keeps your ~/.cofounder directory tidy over time.
 *
 * Usage:
 *   cofounder prune                          # remove completed/failed tasks older than 30d (dry-run first)
 *   cofounder prune --older-than 7d          # prune tasks older than 7 days
 *   cofounder prune --status all             # prune all terminal statuses (completed, failed, timeout, cancelled)
 *   cofounder prune --status completed       # prune only completed tasks
 *   cofounder prune --include-retry          # also remove retry state files for pruned tasks
 *   cofounder prune --include-logs           # also truncate matching schedule log files
 *   cofounder prune --dry-run                # show what would be removed without deleting
 *   cofounder prune --json                   # output machine-readable JSON summary
 *   cofounder prune --force                  # skip confirmation prompt
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { readFile, readdir, unlink, stat, truncate } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TaskStatus } from "../state/tasks.ts";

export interface PruneOptions {
  olderThan?: string;
  status?: string;
  includeRetry?: boolean;
  includeLogs?: boolean;
  dryRun?: boolean;
  json?: boolean;
  force?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CF_DIR = join(homedir(), ".cofounder");
const TASKS_DIR = join(CF_DIR, "state", "tasks");
const RETRY_DIR = join(CF_DIR, "retry");
const LOGS_DIR = join(CF_DIR, "schedule-logs");

const TERMINAL_STATUSES: Set<TaskStatus> = new Set([
  "completed",
  "failed",
  "timeout",
  "cancelled",
]);

// ─── Duration parser ──────────────────────────────────────────────────────────

export function parseDuration(s: string): number | null {
  const match = s.match(/^(\d+(?:\.\d+)?)(s|m|h|d|w)$/i);
  if (!match) return null;
  const n = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };
  return n * (multipliers[unit] ?? 1_000);
}

// ─── Status set builder ───────────────────────────────────────────────────────

export function resolveTargetStatuses(status?: string): Set<TaskStatus> {
  if (!status || status === "all") return new Set(TERMINAL_STATUSES);
  const s = status as TaskStatus;
  if (TERMINAL_STATUSES.has(s)) return new Set([s]);
  return new Set(); // empty → nothing matches
}

// ─── File helpers ─────────────────────────────────────────────────────────────

async function safeReadJson<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function listFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  try {
    const entries = await readdir(dir);
    return entries;
  } catch {
    return [];
  }
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// ─── Prune result types ───────────────────────────────────────────────────────

export interface PrunedFile {
  path: string;
  type: "task" | "retry" | "log";
  taskId: string;
  status?: TaskStatus;
  age_days: number;
  bytes: number;
}

export interface PruneSummary {
  scanned: number;
  pruned: number;
  skipped: number;
  bytes_freed: number;
  files: PrunedFile[];
  dry_run: boolean;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function prune(opts: PruneOptions = {}): Promise<void> {
  const isDryRun = opts.dryRun ?? false;
  const isJson = opts.json ?? false;
  const maxAgeMs = parseDuration(opts.olderThan ?? "30d") ?? 30 * 86_400_000;
  const targetStatuses = resolveTargetStatuses(opts.status);
  const cutoff = Date.now() - maxAgeMs;

  if (!isJson) {
    p.intro(pc.bold("🔥 cofounder prune"));
    if (isDryRun) {
      p.note("Dry-run mode — no files will be deleted.", "dry-run");
    }
  }

  // ── Scan task files ──────────────────────────────────────────────────────────

  const taskFiles = await listFiles(TASKS_DIR);
  const candidates: PrunedFile[] = [];
  let scanned = 0;
  let skipped = 0;

  for (const fname of taskFiles) {
    if (!fname.endsWith(".json")) continue;
    const fullPath = join(TASKS_DIR, fname);
    const task = await safeReadJson<{ id: string; status: TaskStatus; updated_at: string }>(fullPath);
    if (!task) continue;

    scanned++;

    // Only prune terminal statuses
    if (!targetStatuses.has(task.status)) {
      skipped++;
      continue;
    }

    const updatedAt = new Date(task.updated_at).getTime();
    if (isNaN(updatedAt) || updatedAt > cutoff) {
      skipped++;
      continue;
    }

    const ageDays = (Date.now() - updatedAt) / 86_400_000;
    let bytes = 0;
    try {
      const s = await stat(fullPath);
      bytes = s.size;
    } catch {
      // ignore
    }

    candidates.push({
      path: fullPath,
      type: "task",
      taskId: task.id ?? fname.replace(".json", ""),
      status: task.status,
      age_days: Math.round(ageDays * 10) / 10,
      bytes,
    });

    // Matching retry file
    if (opts.includeRetry) {
      const retryPath = join(RETRY_DIR, `${task.id}.json`);
      if (existsSync(retryPath)) {
        let rBytes = 0;
        try {
          const rs = await stat(retryPath);
          rBytes = rs.size;
        } catch {
          // ignore
        }
        candidates.push({
          path: retryPath,
          type: "retry",
          taskId: task.id,
          status: task.status,
          age_days: ageDays,
          bytes: rBytes,
        });
      }
    }

    // Matching schedule log
    if (opts.includeLogs) {
      const logPath = join(LOGS_DIR, `${task.id}.log`);
      if (existsSync(logPath)) {
        let lBytes = 0;
        try {
          const ls = await stat(logPath);
          lBytes = ls.size;
        } catch {
          // ignore
        }
        candidates.push({
          path: logPath,
          type: "log",
          taskId: task.id,
          status: task.status,
          age_days: ageDays,
          bytes: lBytes,
        });
      }
    }
  }

  if (!isJson && candidates.length > 0) {
    // Preview table
    const maxRows = 20;
    const rows = candidates.slice(0, maxRows);
    const lines = rows.map((f) => {
      const badge =
        f.type === "task"
          ? pc.cyan("task ")
          : f.type === "retry"
            ? pc.yellow("retry")
            : pc.dim("log  ");
      const statusLabel = f.status ? pc.dim(f.status.padEnd(10)) : pc.dim("".padEnd(10));
      const age = pc.dim(`${f.age_days}d`);
      const size = pc.dim(fmtBytes(f.bytes));
      return `  ${badge}  ${statusLabel}  ${age.padEnd(8)}  ${size.padEnd(10)}  ${pc.dim(f.path.replace(homedir(), "~"))}`;
    });

    if (candidates.length > maxRows) {
      lines.push(pc.dim(`  … and ${candidates.length - maxRows} more`));
    }
    p.note(lines.join("\n"), `${candidates.length} file(s) eligible for removal`);
  }

  if (candidates.length === 0) {
    if (isJson) {
      const summary: PruneSummary = {
        scanned,
        pruned: 0,
        skipped,
        bytes_freed: 0,
        files: [],
        dry_run: isDryRun,
      };
      process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    } else {
      p.outro(pc.green("Nothing to prune — all clean! 🔥"));
    }
    return;
  }

  // ── Confirm ─────────────────────────────────────────────────────────────────

  if (!isDryRun && !opts.force && !isJson) {
    const totalBytes = candidates.reduce((s, f) => s + f.bytes, 0);
    const confirm = await p.confirm({
      message: `Delete ${candidates.length} file(s) and free ~${fmtBytes(totalBytes)}?`,
    });

    if (p.isCancel(confirm) || !confirm) {
      p.outro(pc.yellow("Cancelled. No files were removed."));
      return;
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────────

  let pruned = 0;
  let bytesFreed = 0;
  const prunedFiles: PrunedFile[] = [];

  for (const f of candidates) {
    if (!isDryRun) {
      try {
        await unlink(f.path);
        pruned++;
        bytesFreed += f.bytes;
        prunedFiles.push(f);
      } catch {
        // file already gone or permission error — skip silently
      }
    } else {
      pruned++;
      bytesFreed += f.bytes;
      prunedFiles.push(f);
    }
  }

  const summary: PruneSummary = {
    scanned,
    pruned,
    skipped,
    bytes_freed: bytesFreed,
    files: prunedFiles,
    dry_run: isDryRun,
  };

  if (isJson) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    return;
  }

  const freed = fmtBytes(bytesFreed);
  if (isDryRun) {
    p.outro(
      pc.yellow(
        `Dry-run complete. Would remove ${pruned} file(s) and free ~${freed}.\nRun without --dry-run to apply.`,
      ),
    );
  } else {
    p.outro(pc.green(`Pruned ${pruned} file(s) · freed ~${freed} 🔥`));
  }
}
