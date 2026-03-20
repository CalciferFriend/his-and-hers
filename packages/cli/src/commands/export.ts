/**
 * commands/export.ts — `cofounder export`
 *
 * Export task history to a markdown, CSV, or JSON report.
 *
 * Useful for:
 *   - Sharing a summary of what your H2 node has been doing
 *   - Archiving completed task records
 *   - Feeding task history into external tools (spreadsheets, dashboards)
 *   - Review sessions: what did we delegate this week?
 *
 * Usage:
 *   cofounder export                          # markdown report to stdout
 *   cofounder export --format csv             # CSV table
 *   cofounder export --format json            # JSON array (same as cofounder logs --json but richer)
 *   cofounder export --since 7d               # last 7 days only
 *   cofounder export --status completed       # completed tasks only
 *   cofounder export --peer GLaDOS            # filter by peer name
 *   cofounder export --out report.md          # write to file
 *   cofounder export --no-output              # omit result text (shorter)
 */

import { writeFile } from "node:fs/promises";
import { listTaskStates, type TaskState, type TaskStatus } from "../state/tasks.ts";

export interface ExportOptions {
  format?: string;
  out?: string;
  since?: string;
  status?: string;
  peer?: string;
  /** When false (--no-output), omit result output text. Default: true (include it). */
  output?: boolean;
}

// ─── Duration parsing ─────────────────────────────────────────────────────────

/** Parse a duration string like "7d", "24h", "30m", "60s" → milliseconds. */
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
    w: 7 * 86_400_000,
  };
  return n * (multipliers[unit] ?? 0);
}

// ─── Filtering ────────────────────────────────────────────────────────────────

export function applyFilters(
  tasks: TaskState[],
  opts: Pick<ExportOptions, "since" | "status" | "peer">,
): TaskState[] {
  let result = tasks;

  if (opts.since) {
    const ms = parseDuration(opts.since);
    if (ms !== null) {
      const cutoff = Date.now() - ms;
      result = result.filter((t) => new Date(t.created_at).getTime() >= cutoff);
    }
  }

  if (opts.status) {
    const s = opts.status.toLowerCase() as TaskStatus;
    result = result.filter((t) => t.status === s);
  }

  if (opts.peer) {
    const p = opts.peer.toLowerCase();
    result = result.filter((t) => t.to.toLowerCase().includes(p));
  }

  return result;
}

// ─── Summary stats ────────────────────────────────────────────────────────────

export interface ExportSummary {
  total: number;
  byStatus: Record<string, number>;
  totalCostUsd: number;
  totalTokens: number;
  totalDurationMs: number;
  peers: string[];
  generatedAt: string;
}

export function buildSummary(tasks: TaskState[]): ExportSummary {
  const byStatus: Record<string, number> = {};
  let totalCostUsd = 0;
  let totalTokens = 0;
  let totalDurationMs = 0;
  const peersSet = new Set<string>();

  for (const t of tasks) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    peersSet.add(t.to);
    if (t.result) {
      totalCostUsd += t.result.cost_usd ?? 0;
      totalTokens += t.result.tokens_used ?? 0;
      totalDurationMs += t.result.duration_ms ?? 0;
    }
  }

  return {
    total: tasks.length,
    byStatus,
    totalCostUsd,
    totalTokens,
    totalDurationMs,
    peers: [...peersSet].sort(),
    generatedAt: new Date().toISOString(),
  };
}

// ─── Formatters ───────────────────────────────────────────────────────────────

const STATUS_ICON: Record<string, string> = {
  completed: "✓",
  failed: "✗",
  timeout: "⏱",
  cancelled: "⊘",
  pending: "⏳",
  running: "⚡",
};

function fmtDuration(ms?: number): string {
  if (!ms) return "—";
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1_000)}s`;
}

function fmtCost(usd?: number): string {
  if (usd === undefined || usd === null) return "—";
  if (usd === 0) return "$0 (local)";
  return `$${usd.toFixed(4)}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function truncate(s: string, maxLen = 500): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + `\n… (${s.length - maxLen} chars omitted)`;
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

export function renderMarkdown(tasks: TaskState[], summary: ExportSummary, includeOutput: boolean): string {
  const lines: string[] = [];

  lines.push("# cofounder Task Report");
  lines.push("");
  lines.push(`Generated: ${fmtDate(summary.generatedAt)}`);
  if (summary.peers.length) lines.push(`Peers: ${summary.peers.join(", ")}`);
  lines.push("");

  // ── Summary table
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total tasks | ${summary.total} |`);
  for (const [status, count] of Object.entries(summary.byStatus).sort()) {
    const icon = STATUS_ICON[status] ?? "?";
    lines.push(`| ${icon} ${status} | ${count} |`);
  }
  if (summary.totalCostUsd > 0) {
    lines.push(`| Total cost | $${summary.totalCostUsd.toFixed(4)} |`);
  }
  if (summary.totalTokens > 0) {
    lines.push(`| Total tokens | ${summary.totalTokens.toLocaleString()} |`);
  }
  if (summary.totalDurationMs > 0) {
    lines.push(`| Total compute time | ${fmtDuration(summary.totalDurationMs)} |`);
  }
  lines.push("");

  if (tasks.length === 0) {
    lines.push("_No tasks found matching the given filters._");
    return lines.join("\n");
  }

  // ── Per-task entries
  lines.push("## Tasks");
  lines.push("");

  for (const t of tasks) {
    const icon = STATUS_ICON[t.status] ?? "?";
    const shortId = t.id.slice(0, 8);
    lines.push(`### ${icon} \`${shortId}\` — ${t.objective}`);
    lines.push("");
    lines.push(`- **Peer:** ${t.to}`);
    lines.push(`- **Status:** ${t.status}`);
    lines.push(`- **Created:** ${fmtDate(t.created_at)}`);
    if (t.result) {
      if (t.result.duration_ms) lines.push(`- **Duration:** ${fmtDuration(t.result.duration_ms)}`);
      if (t.result.tokens_used) {
        const costStr = fmtCost(t.result.cost_usd);
        lines.push(`- **Tokens:** ${t.result.tokens_used.toLocaleString()} | **Cost:** ${costStr}`);
      }
      if (t.result.artifacts?.length) {
        lines.push(`- **Artifacts:** ${t.result.artifacts.join(", ")}`);
      }
      if (includeOutput && t.result.output) {
        lines.push("");
        lines.push("**Output:**");
        lines.push("");
        lines.push("```");
        lines.push(truncate(t.result.output.trim()));
        lines.push("```");
      }
      if (!t.result.success && t.result.error) {
        lines.push("");
        lines.push(`> ⚠️ **Error:** ${t.result.error}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ─── CSV renderer ─────────────────────────────────────────────────────────────

function csvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function renderCsv(tasks: TaskState[], includeOutput: boolean): string {
  const headers = [
    "id",
    "status",
    "peer",
    "objective",
    "created_at",
    "updated_at",
    "duration_ms",
    "tokens_used",
    "cost_usd",
    "success",
    "artifacts",
    ...(includeOutput ? ["output"] : []),
  ];

  const rows = tasks.map((t) => {
    const r = t.result;
    const cols = [
      t.id,
      t.status,
      t.to,
      t.objective,
      t.created_at,
      t.updated_at,
      r?.duration_ms != null ? String(r.duration_ms) : "",
      r?.tokens_used != null ? String(r.tokens_used) : "",
      r?.cost_usd != null ? String(r.cost_usd) : "",
      r ? String(r.success) : "",
      r?.artifacts?.join("|") ?? "",
      ...(includeOutput ? [r?.output ?? ""] : []),
    ];
    return cols.map(csvEscape).join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

// ─── JSON renderer ────────────────────────────────────────────────────────────

export function renderJson(tasks: TaskState[], summary: ExportSummary): string {
  return JSON.stringify({ summary, tasks }, null, 2);
}

// ─── Main export function ─────────────────────────────────────────────────────

export async function exportTasks(opts: ExportOptions): Promise<void> {
  const fmt = (opts.format ?? "markdown").toLowerCase();
  const includeOutput = opts.output !== false;

  if (!["markdown", "csv", "json"].includes(fmt)) {
    process.stderr.write(`cofounder export: unknown format "${opts.format}". Use: markdown | csv | json\n`);
    process.exit(1);
  }

  const allTasks = await listTaskStates();
  const tasks = applyFilters(allTasks, opts);
  const summary = buildSummary(tasks);

  let content: string;
  if (fmt === "csv") {
    content = renderCsv(tasks, includeOutput);
  } else if (fmt === "json") {
    content = renderJson(tasks, summary);
  } else {
    content = renderMarkdown(tasks, summary, includeOutput);
  }

  if (opts.out) {
    await writeFile(opts.out, content, "utf-8");
    process.stderr.write(`cofounder export: wrote ${tasks.length} task(s) to ${opts.out}\n`);
  } else {
    process.stdout.write(content + "\n");
  }
}
