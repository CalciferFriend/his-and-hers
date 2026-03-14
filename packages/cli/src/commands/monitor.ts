/**
 * commands/monitor.ts — `hh monitor`
 *
 * Live terminal dashboard for your agent network.
 * Shows peer health, recent tasks, and budget — refreshed every N seconds.
 *
 * Usage:
 *   hh monitor                  # refresh every 5s
 *   hh monitor --interval 10    # refresh every 10s
 *   hh monitor --once           # single snapshot, no loop (useful for scripts)
 *   hh monitor --json           # print snapshot as JSON and exit
 *
 * Layout:
 *   ┌─ header: node names + current time ─┐
 *   │  peers panel (health + WOL status)  │
 *   │  recent tasks (last 8)              │
 *   │  budget summary (today)             │
 *   └─ footer: interval hint + Ctrl+C    ─┘
 *
 * Implementation notes:
 *   - Pure ANSI/picocolors — no new runtime dependencies
 *   - Network calls run in parallel; if they fail the panel shows "?" rather
 *     than crashing the whole loop
 *   - SIGINT handler restores the terminal cursor before exiting
 */

import pc from "picocolors";
import { loadConfig } from "../config/store.ts";
import { pingPeer, checkGatewayHealth } from "@his-and-hers/core";
import { listTaskStates, type TaskState } from "../state/tasks.ts";
import { buildBudgetSummary } from "../state/budget.ts";
import { getAllPeers, type PeerNodeConfig } from "../peers/select.ts";

export interface MonitorOptions {
  interval?: string;
  once?: boolean;
  json?: boolean;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PeerSnapshot {
  name: string;
  emoji: string;
  role: string;
  tailscale_ip: string;
  reachable: boolean | null;  // null = not checked
  gateway_live: boolean | null;
  wol_enabled: boolean;
  wol_mac?: string;
  gateway_port: number;
}

export interface MonitorSnapshot {
  ts: string;
  this_node: { name: string; emoji: string; role: string };
  peers: PeerSnapshot[];
  recent_tasks: TaskState[];
  budget: {
    cloud_cost_usd: number;
    local_tokens: number;
    total_tokens: number;
    completed: number;
    failed: number;
    pending: number;
  };
}

// ─── Network probes ───────────────────────────────────────────────────────────

async function probePeer(peer: PeerNodeConfig): Promise<Pick<PeerSnapshot, "reachable" | "gateway_live">> {
  try {
    const reachable = await pingPeer(peer.tailscale_ip, 3000);
    if (!reachable) return { reachable: false, gateway_live: false };

    const port = peer.gateway_port ?? 18789;
    const gateway_live = await checkGatewayHealth(`http://${peer.tailscale_ip}:${port}/health`);
    return { reachable, gateway_live };
  } catch {
    return { reachable: false, gateway_live: false };
  }
}

// ─── Snapshot builder ─────────────────────────────────────────────────────────

export async function buildSnapshot(): Promise<MonitorSnapshot | null> {
  const config = await loadConfig();
  if (!config) return null;

  const allPeers = getAllPeers(config);

  // Run all network probes in parallel — don't let one slow peer block others
  const probeResults = await Promise.all(allPeers.map(probePeer));

  const peers: PeerSnapshot[] = allPeers.map((peer, i) => ({
    name: peer.name,
    emoji: peer.emoji ?? "🖥",
    role: peer.role,
    tailscale_ip: peer.tailscale_ip,
    gateway_port: peer.gateway_port ?? 18789,
    wol_enabled: peer.wol_enabled ?? false,
    wol_mac: peer.wol_mac,
    ...probeResults[i],
  }));

  // Recent tasks: newest first, cap at 8
  const allTasks = await listTaskStates();
  const sorted = allTasks.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const recent_tasks = sorted.slice(0, 8);

  // Budget: today only (lightweight for frequent refresh)
  const budgetSummary = await buildBudgetSummary("today");

  return {
    ts: new Date().toISOString(),
    this_node: {
      name: config.this_node.name,
      emoji: config.this_node.emoji ?? "🔥",
      role: config.this_node.role,
    },
    peers,
    recent_tasks,
    budget: {
      cloud_cost_usd: budgetSummary.cloud_cost_usd,
      local_tokens: budgetSummary.local_tokens,
      total_tokens: budgetSummary.total_tokens,
      completed: budgetSummary.completed,
      failed: budgetSummary.failed,
      pending: budgetSummary.pending,
    },
  };
}

// ─── Rendering helpers ────────────────────────────────────────────────────────

const COL = {
  width: process.stdout.columns ?? 80,
};

function termWidth(): number {
  return process.stdout.columns ?? 80;
}

function pad(s: string, n: number): string {
  // Visible length (strip ANSI escape sequences for padding math)
  const visible = s.replace(/\x1b\[[0-9;]*m/g, "");
  const diff = n - visible.length;
  return diff > 0 ? s + " ".repeat(diff) : s;
}

function hr(char = "─"): string {
  return pc.dim(char.repeat(termWidth()));
}

function fmtStatus(s: TaskState["status"]): string {
  switch (s) {
    case "completed": return pc.green("✓ done   ");
    case "failed":    return pc.red("✗ failed ");
    case "pending":   return pc.yellow("⏳ pending");
    case "running":   return pc.cyan("⚡ running");
    case "timeout":   return pc.magenta("⏱ timeout");
    case "cancelled": return pc.dim("⊘ cancel ");
    default:          return pc.dim("? unknown");
  }
}

function fmtAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return pc.dim("just now");
  if (ms < 60_000) return pc.dim(`${Math.round(ms / 1000)}s ago`);
  if (ms < 3_600_000) return pc.dim(`${Math.round(ms / 60_000)}m ago`);
  if (ms < 86_400_000) return pc.dim(`${Math.round(ms / 3_600_000)}h ago`);
  return pc.dim(`${Math.round(ms / 86_400_000)}d ago`);
}

function fmtDuration(ms?: number): string {
  if (!ms) return pc.dim("—");
  if (ms < 1_000) return pc.dim(`${ms}ms`);
  if (ms < 60_000) return pc.dim(`${(ms / 1000).toFixed(1)}s`);
  return pc.dim(`${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`);
}

function fmtCost(usd?: number): string {
  if (usd === undefined || usd === null) return pc.dim("—");
  if (usd === 0) return pc.dim("$0 local");
  return pc.dim(`$${usd.toFixed(4)}`);
}

function fmtBool(v: boolean | null, trueStr: string, falseStr: string): string {
  if (v === null) return pc.dim("?");
  return v ? pc.green(trueStr) : pc.red(falseStr);
}

// ─── Render ───────────────────────────────────────────────────────────────────

export function renderSnapshot(snap: MonitorSnapshot): string {
  const lines: string[] = [];
  const w = termWidth();
  const timeStr = new Date(snap.ts).toUTCString().replace("GMT", "UTC");

  // ── Header ──
  const title = ` hh monitor `;
  const subtitle = `${snap.this_node.emoji} ${snap.this_node.name} (${snap.this_node.role})`;
  const timeRight = timeStr;
  const gap = w - title.length - subtitle.length - timeRight.length - 2;
  const headerContent =
    pc.bold(pc.cyan(title)) +
    pc.dim(subtitle) +
    " ".repeat(Math.max(0, gap)) +
    pc.dim(timeRight);
  lines.push(hr("═"));
  lines.push(headerContent);
  lines.push(hr("═"));
  lines.push("");

  // ── Peers ──
  lines.push(pc.bold("PEERS"));
  for (const peer of snap.peers) {
    const ts   = fmtBool(peer.reachable, `✓ ${peer.tailscale_ip}`, `✗ ${peer.tailscale_ip}`);
    const gw   = fmtBool(peer.gateway_live, "gw ✓", "gw ✗");
    const wol  = peer.wol_enabled
      ? pc.dim(`WOL:${peer.wol_mac ?? "?"}`)
      : pc.dim("no WOL");
    lines.push(
      `  ${peer.emoji} ${pc.bold(peer.name)} ${pc.dim(`(${peer.role})`)}` +
      `  ts: ${ts}  ${gw}  ${wol}`
    );
  }
  lines.push("");

  // ── Recent tasks ──
  lines.push(pc.bold(`RECENT TASKS  ${pc.dim("(last 8)")}`));
  if (snap.recent_tasks.length === 0) {
    lines.push(pc.dim("  No tasks yet — run `hh send` to delegate your first task."));
  } else {
    // Column widths
    const idW = 8;
    const peerW = 10;
    const statusW = 10;
    const whenW = 9;
    const durW = 8;
    const costW = 9;

    const header =
      pc.dim(
        "  " +
        pad("ID", idW) + "  " +
        pad("PEER", peerW) + "  " +
        pad("STATUS", statusW) + "  " +
        pad("WHEN", whenW) + "  " +
        pad("DUR", durW) + "  " +
        "COST"
      );
    lines.push(header);
    lines.push(pc.dim("  " + "─".repeat(Math.min(w - 4, idW + peerW + statusW + whenW + durW + costW + 14))));

    for (const task of snap.recent_tasks) {
      const shortId = task.id.slice(0, idW);
      const peerName = (task.to ?? "?").slice(0, peerW);
      const cost = task.result?.cost_usd;
      const dur = task.result?.duration_ms;
      const objective = task.objective ?? "";
      const truncObj = objective.length > 30 ? objective.slice(0, 28) + "…" : objective;

      lines.push(
        "  " +
        pad(pc.dim(shortId), idW + 14) + "  " +       // +14 for ANSI dim codes
        pad(pc.cyan(peerName), peerW + 9) + "  " +
        fmtStatus(task.status) + "  " +
        pad(fmtAge(task.created_at), whenW + 22) + "  " +
        pad(fmtDuration(dur), durW + 22) + "  " +
        fmtCost(cost)
      );
      lines.push(pc.dim(`     ${truncObj}`));
    }
  }
  lines.push("");

  // ── Budget (today) ──
  lines.push(pc.bold("BUDGET TODAY"));
  const { cloud_cost_usd, local_tokens, total_tokens, completed, failed, pending } = snap.budget;
  const localPct = total_tokens > 0 ? Math.round((local_tokens / total_tokens) * 100) : 0;
  const budgetLine =
    `  Cloud: ${pc.yellow(`$${cloud_cost_usd.toFixed(4)}`)}` +
    `  Local: ${pc.green(`${local_tokens.toLocaleString()} tok (${localPct}%)`)}` +
    `  Tasks: ${pc.green(`${completed} done`)} ${pc.red(`${failed} failed`)} ${pc.yellow(`${pending} pending`)}`;
  lines.push(budgetLine);
  lines.push("");

  // ── Footer ──
  lines.push(hr("─"));
  lines.push(pc.dim(`  Refreshing every ${COL.width > 60 ? "N" : ""}s  ·  Ctrl+C to quit`));

  return lines.join("\n");
}

// ─── Main command ─────────────────────────────────────────────────────────────

export async function monitor(opts: MonitorOptions = {}): Promise<void> {
  const intervalSec = Math.max(2, parseInt(opts.interval ?? "5", 10) || 5);

  const config = await loadConfig();
  if (!config) {
    console.error(pc.red("No configuration found. Run `hh onboard` first."));
    process.exit(1);
  }

  // ── JSON mode ──
  if (opts.json) {
    const snap = await buildSnapshot();
    console.log(JSON.stringify(snap, null, 2));
    return;
  }

  // ── Single-shot ──
  if (opts.once) {
    const snap = await buildSnapshot();
    if (!snap) {
      console.error(pc.red("Could not build snapshot."));
      process.exit(1);
    }
    console.log(renderSnapshot(snap));
    return;
  }

  // ── Live loop ──

  // Hide cursor on entry, restore on exit
  process.stdout.write("\x1b[?25l");

  const cleanup = () => {
    process.stdout.write("\x1b[?25h\n");
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  let first = true;
  let lineCount = 0;

  async function tick() {
    const snap = await buildSnapshot();
    if (!snap) {
      process.stdout.write("\x1b[?25h");
      console.error(pc.red("Could not load config."));
      process.exit(1);
    }

    // Overwrite previous render (move cursor up by lineCount lines)
    if (!first && lineCount > 0) {
      process.stdout.write(`\x1b[${lineCount}A\x1b[0J`);
    }

    const rendered = renderSnapshot(snap);
    process.stdout.write(rendered + "\n");
    lineCount = rendered.split("\n").length + 1;
    first = false;
  }

  await tick();
  const timer = setInterval(tick, intervalSec * 1000);

  // Keep the process alive
  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => { clearInterval(timer); cleanup(); resolve(); });
    process.on("SIGTERM", () => { clearInterval(timer); cleanup(); resolve(); });
  });
}
