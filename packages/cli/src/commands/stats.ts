/**
 * commands/stats.ts — `cofounder stats`
 *
 * Deep task analytics with charts, heatmaps, and peer breakdowns.
 *
 * Usage:
 *   cofounder stats                         → last 14 days summary
 *   cofounder stats --days 30               → last 30 days
 *   cofounder stats --peer glados           → filter to a specific peer
 *   cofounder stats --json                  → raw analytics object
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { listTaskStates, type TaskState } from "../state/tasks.ts";

export interface StatsOptions {
  days?: number;
  peer?: string;
  json?: boolean;
}

interface Analytics {
  window_days: number;
  total_tasks: number;
  completed: number;
  failed: number;
  pending: number;
  success_rate: number;
  tasks_per_day: { date: string; count: number }[];
  hourly_heatmap: number[];
  peer_breakdown: {
    peer: string;
    tasks_sent: number;
    success_rate: number;
    avg_duration_ms: number;
    avg_cost_usd: number;
  }[];
  top_task_types: { pattern: string; count: number }[];
}

export async function stats(opts: StatsOptions = {}) {
  const days = opts.days ?? 14;
  const peerFilter = opts.peer;

  // Load all task states
  let tasks = await listTaskStates();

  // Filter by time window
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  tasks = tasks.filter((t) => new Date(t.created_at).getTime() >= cutoff);

  // Filter by peer if specified
  if (peerFilter) {
    tasks = tasks.filter((t) => t.to.toLowerCase().includes(peerFilter.toLowerCase()));
  }

  if (tasks.length === 0) {
    if (opts.json) {
      console.log(JSON.stringify({ error: "No tasks found in this time window" }, null, 2));
      return;
    }
    p.intro(pc.bgMagenta(pc.white(` cofounder stats — last ${days} days `)));
    p.log.info("No tasks found in this time window.");
    p.outro("Nothing to show.");
    return;
  }

  // Build analytics
  const analytics = buildAnalytics(tasks, days);

  if (opts.json) {
    console.log(JSON.stringify(analytics, null, 2));
    return;
  }

  // ── Pretty output ────────────────────────────────────────────────────────

  p.intro(pc.bgMagenta(pc.white(` cofounder stats — last ${days} days `)));

  // ── Overview ─────────────────────────────────────────────────────────────
  p.log.info(pc.bold("Overview"));
  p.log.info(
    `  Total tasks:    ${pc.cyan(String(analytics.total_tasks))}`,
  );
  p.log.info(
    `  Completed:      ${pc.green(String(analytics.completed))}`,
  );
  p.log.info(
    `  Failed:         ${pc.red(String(analytics.failed))}`,
  );
  p.log.info(
    `  Pending:        ${pc.yellow(String(analytics.pending))}`,
  );
  p.log.info(
    `  Success rate:   ${analytics.success_rate >= 80 ? pc.green : analytics.success_rate >= 50 ? pc.yellow : pc.red}(${analytics.success_rate.toFixed(1)}%)`,
  );

  p.log.message("");

  // ── Tasks per day (ASCII bar chart) ──────────────────────────────────────
  p.log.info(pc.bold("Tasks per day"));
  renderBarChart(analytics.tasks_per_day);

  p.log.message("");

  // ── Hourly heatmap ───────────────────────────────────────────────────────
  p.log.info(pc.bold("Hourly heatmap (24h)"));
  renderHourlyHeatmap(analytics.hourly_heatmap);

  p.log.message("");

  // ── Peer breakdown ───────────────────────────────────────────────────────
  if (analytics.peer_breakdown.length > 0) {
    p.log.info(pc.bold("Peer breakdown"));
    for (const pb of analytics.peer_breakdown) {
      const successColor = pb.success_rate >= 80 ? pc.green : pb.success_rate >= 50 ? pc.yellow : pc.red;
      const avgDur = pb.avg_duration_ms > 0 ? `${(pb.avg_duration_ms / 1000).toFixed(1)}s` : "n/a";
      const avgCost = pb.avg_cost_usd > 0 ? `$${pb.avg_cost_usd.toFixed(3)}` : "$0.000";
      p.log.info(
        `  ${pc.cyan(pb.peer.padEnd(16))}  ${String(pb.tasks_sent).padStart(3)} tasks  ` +
        `${successColor(pb.success_rate.toFixed(1) + "%").padStart(6)}  ` +
        `avg ${avgDur.padStart(6)}  avg ${avgCost.padStart(7)}`,
      );
    }
    p.log.message("");
  }

  // ── Top task types ───────────────────────────────────────────────────────
  if (analytics.top_task_types.length > 0) {
    p.log.info(pc.bold("Top task types"));
    for (const tt of analytics.top_task_types.slice(0, 5)) {
      p.log.info(`  ${pc.dim(String(tt.count).padStart(3))}× ${pc.italic(tt.pattern)}`);
    }
  }

  p.outro("Analytics complete.");
}

// ─── Analytics Builder ───────────────────────────────────────────────────────

export function buildAnalytics(tasks: TaskState[], days: number): Analytics {
  const total_tasks = tasks.length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const failed = tasks.filter((t) => t.status === "failed" || t.status === "timeout").length;
  const pending = tasks.filter((t) => t.status === "pending" || t.status === "running").length;
  const success_rate = total_tasks > 0 ? (completed / (completed + failed)) * 100 : 0;

  // Tasks per day
  const tasks_per_day = buildTasksPerDay(tasks, days);

  // Hourly heatmap
  const hourly_heatmap = buildHourlyHeatmap(tasks);

  // Peer breakdown
  const peer_breakdown = buildPeerBreakdown(tasks);

  // Top task types
  const top_task_types = buildTopTaskTypes(tasks);

  return {
    window_days: days,
    total_tasks,
    completed,
    failed,
    pending,
    success_rate,
    tasks_per_day,
    hourly_heatmap,
    peer_breakdown,
    top_task_types,
  };
}

function buildTasksPerDay(tasks: TaskState[], days: number): { date: string; count: number }[] {
  const buckets = new Map<string, number>();
  const now = new Date();

  // Initialize all days
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, 0);
  }

  // Fill counts
  for (const t of tasks) {
    const key = new Date(t.created_at).toISOString().slice(0, 10);
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }

  return Array.from(buckets.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function buildHourlyHeatmap(tasks: TaskState[]): number[] {
  const buckets = new Array(24).fill(0);
  for (const t of tasks) {
    const hour = new Date(t.created_at).getHours();
    buckets[hour]++;
  }
  return buckets;
}

function buildPeerBreakdown(tasks: TaskState[]): Analytics["peer_breakdown"] {
  const peerMap = new Map<string, { sent: number; completed: number; failed: number; duration_ms: number; cost_usd: number }>();

  for (const t of tasks) {
    const peer = t.to;
    if (!peerMap.has(peer)) {
      peerMap.set(peer, { sent: 0, completed: 0, failed: 0, duration_ms: 0, cost_usd: 0 });
    }
    const stats = peerMap.get(peer)!;
    stats.sent++;
    if (t.status === "completed") {
      stats.completed++;
    } else if (t.status === "failed" || t.status === "timeout") {
      stats.failed++;
    }
    if (t.result?.duration_ms) {
      stats.duration_ms += t.result.duration_ms;
    }
    if (t.result?.cost_usd) {
      stats.cost_usd += t.result.cost_usd;
    }
  }

  return Array.from(peerMap.entries())
    .map(([peer, stats]) => ({
      peer,
      tasks_sent: stats.sent,
      success_rate: stats.sent > 0 ? (stats.completed / (stats.completed + stats.failed)) * 100 : 0,
      avg_duration_ms: stats.completed > 0 ? stats.duration_ms / stats.completed : 0,
      avg_cost_usd: stats.completed > 0 ? stats.cost_usd / stats.completed : 0,
    }))
    .sort((a, b) => b.tasks_sent - a.tasks_sent);
}

function buildTopTaskTypes(tasks: TaskState[]): { pattern: string; count: number }[] {
  const patternMap = new Map<string, number>();

  for (const t of tasks) {
    // Extract first word from objective (common pattern: "review", "fix", "deploy", etc.)
    const trimmed = t.objective.trim();
    const firstWord = trimmed ? (trimmed.split(/\s+/)[0]?.toLowerCase() ?? "unknown") : "unknown";
    patternMap.set(firstWord, (patternMap.get(firstWord) ?? 0) + 1);
  }

  return Array.from(patternMap.entries())
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count);
}

// ─── Rendering Helpers ───────────────────────────────────────────────────────

function renderBarChart(data: { date: string; count: number }[]) {
  if (data.length === 0) return;

  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const maxWidth = 30;

  for (const { date, count } of data) {
    const barWidth = Math.round((count / maxCount) * maxWidth);
    const bar = "█".repeat(barWidth);
    const dateLabel = date.slice(5); // MM-DD
    p.log.info(`  ${pc.dim(dateLabel)}  ${pc.cyan(bar)} ${pc.dim(String(count))}`);
  }
}

function renderHourlyHeatmap(buckets: number[]) {
  const maxCount = Math.max(...buckets, 1);
  const blocks = buckets.map((count) => {
    const ratio = count / maxCount;
    if (ratio === 0) return pc.dim("▪");
    if (ratio < 0.25) return pc.dim("░");
    if (ratio < 0.5) return "▒";
    if (ratio < 0.75) return "▓";
    return pc.cyan("█");
  });

  // Print hour labels
  const hourLabels = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  p.log.info(`  ${pc.dim(hourLabels.join(" "))}`);

  // Print blocks
  p.log.info(`  ${blocks.join(" ")}`);
}
