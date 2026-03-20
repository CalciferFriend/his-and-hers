/**
 * commands/health-report.ts — `cofounder health-report`
 *
 * Generate a comprehensive weekly health digest for a cofounder node pair.
 * Combines stats, budget, audit chain verification, peer uptime, and anomaly
 * detection into a shareable Markdown report (or JSON).
 *
 * Useful for:
 *   - Weekly reviews of what your H2 node actually did
 *   - Sharing with your team / collaborator
 *   - Attaching to Discord/Slack via webhook notification
 *   - Running on a cron to get automated weekly digests
 *
 * Usage:
 *   cofounder health-report                       # last 7 days, Markdown to stdout
 *   cofounder health-report --days 30             # last 30 days
 *   cofounder health-report --peer glados         # filter to one peer
 *   cofounder health-report --out report.md       # write to file
 *   cofounder health-report --json                # raw JSON data
 *   cofounder health-report --webhook <url>       # POST report to webhook
 *   cofounder health-report --no-verify-audit     # skip audit chain integrity check
 */

import { writeFile } from "node:fs/promises";
import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  verifyAuditChain,
  readAuditLog,
  formatCost,
  formatTokens,
  pingPeer,
  checkGatewayHealth,
} from "@cofounder/core";
import { loadConfig } from "../config/store.ts";
import { getAllPeers, findPeerByName } from "../peers/select.ts";
import { listTaskStates, type TaskState } from "../state/tasks.ts";
import { buildBudgetSummary } from "../state/budget.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HealthReportOptions {
  days?: number;
  peer?: string;
  out?: string;
  json?: boolean;
  webhook?: string;
  verifyAudit?: boolean;
}

interface PeerUptime {
  name: string;
  gateway_ok: boolean;
  tailscale_ok: boolean;
  gateway_rtt_ms?: number;
  tailscale_rtt_ms?: number;
}

interface AnomalyRecord {
  kind: "high_failure_rate" | "no_activity" | "cost_spike" | "audit_broken";
  severity: "warn" | "critical";
  message: string;
}

export interface HealthReport {
  generated_at: string;
  window_days: number;
  peer_filter?: string;

  // Task stats
  total_tasks: number;
  completed: number;
  failed: number;
  timeout: number;
  cancelled: number;
  success_rate: number;
  avg_duration_ms: number;
  tasks_per_day: { date: string; count: number }[];

  // Cost
  cloud_cost_usd: number;
  local_cost_usd: number;
  total_cost_usd: number;
  local_savings_usd: number;
  total_tokens: number;

  // Peer uptime (snapshot at report time)
  peer_uptime: PeerUptime[];

  // Audit
  audit_chain_ok: boolean;
  audit_entries: number;
  audit_broken_at?: string;

  // Anomalies
  anomalies: AnomalyRecord[];

  // Per-peer breakdown
  peer_breakdown: {
    peer: string;
    tasks: number;
    success_rate: number;
    avg_cost_usd: number;
    total_cost_usd: number;
  }[];
}

// ─── Build report data ────────────────────────────────────────────────────────

export async function buildHealthReport(opts: HealthReportOptions): Promise<HealthReport> {
  const days = opts.days ?? 7;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  // ── Task stats ─────────────────────────────────────────────────────────────
  let tasks = await listTaskStates();
  tasks = tasks.filter((t) => new Date(t.created_at).getTime() >= cutoff);
  if (opts.peer) {
    tasks = tasks.filter((t) =>
      t.to.toLowerCase().includes(opts.peer!.toLowerCase()),
    );
  }

  const completed = tasks.filter((t) => t.status === "completed").length;
  const failed = tasks.filter((t) => t.status === "failed").length;
  const timeout = tasks.filter((t) => t.status === "timeout").length;
  const cancelled = tasks.filter((t) => t.status === "cancelled").length;
  const total = tasks.length;
  const success_rate = total > 0 ? completed / total : 0;

  const durations = tasks
    .map((t) => t.result?.duration_ms)
    .filter((d): d is number => typeof d === "number");
  const avg_duration_ms =
    durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

  // ── Tasks per day ──────────────────────────────────────────────────────────
  const dayBuckets: Record<string, number> = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 86_400_000);
    dayBuckets[d.toISOString().slice(0, 10)] = 0;
  }
  for (const t of tasks) {
    const date = t.created_at.slice(0, 10);
    if (date in dayBuckets) dayBuckets[date]++;
  }
  const tasks_per_day = Object.entries(dayBuckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  // ── Cost ───────────────────────────────────────────────────────────────────
  const budgetSummary = await buildBudgetSummary(days === 7 ? "week" : days === 1 ? "today" : "month");
  const cloud_cost_usd = budgetSummary.cloud_cost_usd;
  const local_cost_usd = budgetSummary.local_cost_usd;
  const total_cost_usd = budgetSummary.total_cost_usd;
  const local_savings_usd = budgetSummary.local_savings_estimate_usd ?? 0;
  const total_tokens = budgetSummary.total_tokens;

  // ── Per-peer breakdown ─────────────────────────────────────────────────────
  const peerMap: Record<
    string,
    { tasks: TaskState[]; cost: number }
  > = {};
  for (const t of tasks) {
    if (!peerMap[t.to]) peerMap[t.to] = { tasks: [], cost: 0 };
    peerMap[t.to].tasks.push(t);
    peerMap[t.to].cost += t.result?.cost_usd ?? 0;
  }
  const peer_breakdown = Object.entries(peerMap).map(([peer, { tasks: pts, cost }]) => {
    const ok = pts.filter((t) => t.status === "completed").length;
    return {
      peer,
      tasks: pts.length,
      success_rate: pts.length > 0 ? ok / pts.length : 0,
      avg_cost_usd: pts.length > 0 ? cost / pts.length : 0,
      total_cost_usd: cost,
    };
  });

  // ── Peer uptime ────────────────────────────────────────────────────────────
  const config = await loadConfig();
  const peer_uptime: PeerUptime[] = [];
  const allPeers = config ? getAllPeers(config) : [];
  const targetPeers = opts.peer
    ? allPeers.filter((peer) =>
        peer.name?.toLowerCase().includes(opts.peer!.toLowerCase()),
      )
    : allPeers;

  for (const peer of targetPeers) {
    if (!peer.tailscale_ip) continue;
    const gwPort = peer.gateway?.port ?? 18789;
    const [gwOk, tsOk] = await Promise.allSettled([
      checkGatewayHealth(`http://${peer.tailscale_ip}:${gwPort}/health`),
      pingPeer(peer.tailscale_ip),
    ]).then((results) => results.map((r) => r.status === "fulfilled" && r.value));
    peer_uptime.push({
      name: peer.name ?? peer.tailscale_ip,
      gateway_ok: Boolean(gwOk),
      tailscale_ok: Boolean(tsOk),
    });
  }

  // ── Audit chain ────────────────────────────────────────────────────────────
  let audit_chain_ok = true;
  let audit_broken_at: string | undefined;
  let audit_entries = 0;

  if (opts.verifyAudit !== false) {
    try {
      const [entries, verify] = await Promise.all([
        readAuditLog({}),
        verifyAuditChain(),
      ]);
      audit_entries = entries.length;
      audit_chain_ok = verify.ok;
      if (!verify.ok && verify.brokenAt) {
        audit_broken_at = verify.brokenAt;
      }
    } catch {
      // Audit log may not exist on fresh installs — not an error
      audit_chain_ok = true;
      audit_entries = 0;
    }
  }

  // ── Anomaly detection ──────────────────────────────────────────────────────
  const anomalies: AnomalyRecord[] = [];

  if (total > 5 && success_rate < 0.6) {
    anomalies.push({
      kind: "high_failure_rate",
      severity: "critical",
      message: `High failure rate: ${Math.round((1 - success_rate) * 100)}% of tasks failed or timed out`,
    });
  } else if (total > 2 && success_rate < 0.8) {
    anomalies.push({
      kind: "high_failure_rate",
      severity: "warn",
      message: `Elevated failure rate: ${Math.round((1 - success_rate) * 100)}% of tasks failed`,
    });
  }

  if (days >= 7 && total === 0) {
    anomalies.push({
      kind: "no_activity",
      severity: "warn",
      message: `No tasks sent in the last ${days} days`,
    });
  }

  if (total_cost_usd > 5) {
    anomalies.push({
      kind: "cost_spike",
      severity: "warn",
      message: `Cloud spend of ${formatCost(total_cost_usd)} in ${days} days — consider routing more tasks locally`,
    });
  }

  if (!audit_chain_ok) {
    anomalies.push({
      kind: "audit_broken",
      severity: "critical",
      message: `Audit log integrity failure at entry: ${audit_broken_at ?? "unknown"}`,
    });
  }

  return {
    generated_at: new Date().toISOString(),
    window_days: days,
    peer_filter: opts.peer,
    total_tasks: total,
    completed,
    failed,
    timeout,
    cancelled,
    success_rate,
    avg_duration_ms,
    tasks_per_day,
    cloud_cost_usd,
    local_cost_usd,
    total_cost_usd,
    local_savings_usd,
    total_tokens,
    peer_uptime,
    audit_chain_ok,
    audit_entries,
    audit_broken_at,
    anomalies,
    peer_breakdown,
  };
}

// ─── Render Markdown ──────────────────────────────────────────────────────────

export function renderHealthReport(report: HealthReport): string {
  const lines: string[] = [];
  const ts = new Date(report.generated_at).toUTCString();
  const windowLabel = `Last ${report.window_days} days`;
  const peerNote = report.peer_filter ? ` · Peer: ${report.peer_filter}` : "";

  lines.push(`# 🏥 cofounder Health Report`);
  lines.push(`\n_Generated: ${ts}${peerNote}_`);
  lines.push(`\n---\n`);

  // ── Overview ───────────────────────────────────────────────────────────────
  lines.push(`## Overview — ${windowLabel}`);
  lines.push(`\n| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total tasks | ${report.total_tasks} |`);
  lines.push(`| Completed | ${report.completed} ✅ |`);
  lines.push(`| Failed | ${report.failed} ${report.failed > 0 ? "❌" : ""} |`);
  lines.push(`| Timeout | ${report.timeout} ${report.timeout > 0 ? "⏱" : ""} |`);
  lines.push(`| Cancelled | ${report.cancelled} |`);
  lines.push(
    `| Success rate | ${report.total_tasks > 0 ? `${Math.round(report.success_rate * 100)}%` : "—"} |`,
  );
  lines.push(
    `| Avg duration | ${report.avg_duration_ms > 0 ? `${(report.avg_duration_ms / 1000).toFixed(1)}s` : "—"} |`,
  );
  lines.push(``);

  // ── Cost ───────────────────────────────────────────────────────────────────
  lines.push(`## 💰 Cost`);
  lines.push(`\n| | Amount |`);
  lines.push(`|--|--------|`);
  lines.push(`| Cloud | \`${formatCost(report.cloud_cost_usd)}\` |`);
  lines.push(`| Local (est.) | \`${formatCost(report.local_cost_usd)}\` |`);
  lines.push(`| **Total** | **\`${formatCost(report.total_cost_usd)}\`** |`);
  lines.push(`| Local savings | \`${formatCost(report.local_savings_usd)}\` |`);
  lines.push(`| Total tokens | ${formatTokens(report.total_tokens)} |`);
  lines.push(``);

  // ── Activity chart ─────────────────────────────────────────────────────────
  if (report.tasks_per_day.length > 0) {
    lines.push(`## 📊 Daily Activity`);
    lines.push(`\n\`\`\``);
    const maxCount = Math.max(...report.tasks_per_day.map((d) => d.count), 1);
    for (const { date, count } of report.tasks_per_day) {
      const barLen = Math.round((count / maxCount) * 20);
      const bar = "█".repeat(barLen) + "░".repeat(20 - barLen);
      lines.push(`${date}  ${bar}  ${count}`);
    }
    lines.push(`\`\`\``);
    lines.push(``);
  }

  // ── Peer status ────────────────────────────────────────────────────────────
  if (report.peer_uptime.length > 0) {
    lines.push(`## 🌐 Peer Status (at report time)`);
    lines.push(`\n| Peer | Gateway | Tailscale |`);
    lines.push(`|------|---------|-----------|`);
    for (const pu of report.peer_uptime) {
      lines.push(
        `| ${pu.name} | ${pu.gateway_ok ? "✅ online" : "❌ offline"} | ${pu.tailscale_ok ? "✅ reachable" : "❌ unreachable"} |`,
      );
    }
    lines.push(``);
  }

  // ── Per-peer breakdown ─────────────────────────────────────────────────────
  if (report.peer_breakdown.length > 0) {
    lines.push(`## 📋 Per-Peer Breakdown`);
    lines.push(`\n| Peer | Tasks | Success | Avg Cost | Total Cost |`);
    lines.push(`|------|-------|---------|----------|------------|`);
    for (const pb of report.peer_breakdown) {
      lines.push(
        `| ${pb.peer} | ${pb.tasks} | ${Math.round(pb.success_rate * 100)}% | ${formatCost(pb.avg_cost_usd)} | ${formatCost(pb.total_cost_usd)} |`,
      );
    }
    lines.push(``);
  }

  // ── Audit ──────────────────────────────────────────────────────────────────
  lines.push(`## 🔐 Audit Log`);
  lines.push(`\n| | |`);
  lines.push(`|--|--|`);
  lines.push(
    `| Chain integrity | ${report.audit_chain_ok ? "✅ OK" : "❌ BROKEN"} |`,
  );
  lines.push(`| Total entries | ${report.audit_entries} |`);
  if (report.audit_broken_at) {
    lines.push(`| Broken at entry | \`${report.audit_broken_at}\` |`);
  }
  lines.push(``);

  // ── Anomalies ──────────────────────────────────────────────────────────────
  if (report.anomalies.length > 0) {
    lines.push(`## ⚠️ Anomalies`);
    lines.push(``);
    for (const a of report.anomalies) {
      const icon = a.severity === "critical" ? "🔴" : "🟡";
      lines.push(`- ${icon} **${a.kind}**: ${a.message}`);
    }
    lines.push(``);
  } else {
    lines.push(`## ✅ No Anomalies`);
    lines.push(`\n_System is healthy — no issues detected._\n`);
  }

  lines.push(`---`);
  lines.push(`\n_Generated by [cofounder](https://github.com/CalciferFriend/cofounder) · \`cofounder health-report\`_`);

  return lines.join("\n");
}

// ─── Webhook delivery ────────────────────────────────────────────────────────

async function postWebhook(url: string, report: HealthReport, markdown: string): Promise<boolean> {
  try {
    const body = JSON.stringify({
      type: "health_report",
      generated_at: report.generated_at,
      window_days: report.window_days,
      total_tasks: report.total_tasks,
      success_rate: report.success_rate,
      total_cost_usd: report.total_cost_usd,
      anomaly_count: report.anomalies.length,
      anomalies: report.anomalies,
      audit_chain_ok: report.audit_chain_ok,
      markdown_report: markdown,
    });
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── CLI entrypoint ───────────────────────────────────────────────────────────

export async function healthReport(opts: HealthReportOptions) {
  if (!opts.json) {
    p.intro(pc.bgGreen(pc.black(" cofounder health-report ")));
  }

  const spinner = opts.json ? null : p.spinner();
  spinner?.start("Building health report...");

  const report = await buildHealthReport(opts);

  spinner?.stop("Health report ready.");

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const markdown = renderHealthReport(report);

  // Output to file or stdout
  if (opts.out) {
    await writeFile(opts.out, markdown, "utf8");
    p.log.success(`Report written to ${opts.out}`);
  } else {
    console.log(markdown);
  }

  // Post to webhook if requested
  if (opts.webhook) {
    const ws = p.spinner();
    ws.start(`Posting to webhook...`);
    const ok = await postWebhook(opts.webhook, report, markdown);
    if (ok) {
      ws.stop(`${pc.green("✓")} Webhook delivered.`);
    } else {
      ws.stop(`${pc.red("✗")} Webhook delivery failed.`);
    }
  }

  // Print anomaly summary at end if any
  if (report.anomalies.length > 0) {
    p.log.warn(
      `${report.anomalies.length} anomal${report.anomalies.length === 1 ? "y" : "ies"} detected — see report for details.`,
    );
  }

  p.outro(
    report.total_tasks === 0
      ? "No tasks found in window."
      : `${report.total_tasks} tasks · ${Math.round(report.success_rate * 100)}% success · ${formatCost(report.total_cost_usd)} spent`,
  );
}
