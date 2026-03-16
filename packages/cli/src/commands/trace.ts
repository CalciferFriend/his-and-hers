/**
 * cli/commands/trace.ts — hh trace
 *
 * Display, list, and clear structured execution traces for task pipelines.
 *
 * Traces capture a per-step timeline of each task send:
 *   Tailscale ping → gateway health → WOL wake → WS connect/auth/wake →
 *   result listener → stream chunks → result received
 *
 * Designed to help debug Windows boot-chain issues and general latency analysis.
 *
 * Usage:
 *   hh trace <task_id>           Show trace for a specific task
 *   hh trace list [--json]       List all stored traces
 *   hh trace clear [<task_id>]   Clear one or all traces
 *
 * Phase 16 — Calcifer ✅ (2026-03-16)
 */

import * as p from "@clack/prompts";
import {
  loadTrace,
  listTraces,
  clearTrace,
  clearAllTraces,
  formatStepLabel,
  renderBar,
  TraceLog,
  TraceEvent,
} from "@his-and-hers/core";

// ─── Status icons ─────────────────────────────────────────────────────────────

function icon(ok: boolean): string {
  return ok ? "✓" : "✗";
}

function statusColor(ok: boolean, text: string): string {
  // Use ANSI colour codes: green for ok, red for failure
  return ok ? `\x1b[32m${text}\x1b[0m` : `\x1b[31m${text}\x1b[0m`;
}

// ─── Trace rendering ──────────────────────────────────────────────────────────

/**
 * Render a single trace as a human-readable timeline.
 */
function renderTrace(trace: TraceLog): string {
  const lines: string[] = [];

  lines.push(`\n  Task:  ${trace.task_id}`);
  lines.push(`  Peer:  ${trace.peer}`);
  lines.push(`  Goal:  ${trace.objective}`);
  lines.push(`  Start: ${new Date(trace.started_at).toLocaleString()}`);
  if (trace.ended_at) {
    lines.push(`  End:   ${new Date(trace.ended_at).toLocaleString()}`);
  }
  if (trace.total_ms !== undefined) {
    lines.push(`  Total: ${trace.total_ms}ms`);
  }

  if (trace.events.length === 0) {
    lines.push("\n  (no steps recorded)");
    return lines.join("\n");
  }

  // Find max duration for bar scaling
  const maxMs = Math.max(
    1,
    ...trace.events
      .map((e) => e.duration_ms ?? 0)
      .filter((d) => d > 0),
  );

  lines.push("\n  Timeline:");
  lines.push("  " + "─".repeat(62));

  // Header
  lines.push(
    `  ${"Step".padEnd(20)}  ${"Bar".padEnd(14)}  ${"ms".padStart(7)}  Status`,
  );
  lines.push("  " + "─".repeat(62));

  for (const event of trace.events) {
    const label = formatStepLabel(event.step).padEnd(20);
    const bar = renderBar(event.duration_ms, maxMs, 12).padEnd(14);
    const ms =
      event.duration_ms !== undefined
        ? `${event.duration_ms}ms`.padStart(7)
        : "   –   ";
    const status = statusColor(event.ok, icon(event.ok));
    const err = event.error ? `  ← ${event.error}` : "";
    lines.push(`  ${label}  ${bar}  ${ms}  ${status}${err}`);

    // Show any metadata inline (for debugging — key=val pairs)
    if (event.meta && Object.keys(event.meta).length > 0) {
      const metaStr = Object.entries(event.meta)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join("  ");
      lines.push(`  ${"".padEnd(20)}  ${"".padEnd(14)}         ↳ ${metaStr}`);
    }
  }

  lines.push("  " + "─".repeat(62));

  // Summary: ok vs failed steps
  const total = trace.events.length;
  const failed = trace.events.filter((e) => !e.ok).length;
  const ok = total - failed;
  lines.push(`  ${ok}/${total} steps ok${failed > 0 ? `  — ${failed} FAILED` : ""}`);

  return lines.join("\n");
}

/**
 * Render a list of traces as a summary table.
 */
function renderTraceList(traces: TraceLog[]): string {
  if (traces.length === 0) return "  No traces found.";

  const lines: string[] = [];
  lines.push("\n  " + "─".repeat(72));
  lines.push(
    `  ${"Task ID".padEnd(20)}  ${"Peer".padEnd(12)}  ${"Total".padStart(7)}  ${"Steps".padStart(5)}  Started`,
  );
  lines.push("  " + "─".repeat(72));

  for (const trace of traces) {
    const id = trace.task_id.slice(0, 18).padEnd(20);
    const peer = trace.peer.padEnd(12);
    const total =
      trace.total_ms !== undefined
        ? `${trace.total_ms}ms`.padStart(7)
        : "    –  ";
    const steps = String(trace.events.length).padStart(5);
    const started = new Date(trace.started_at).toLocaleString();
    const failed = trace.events.some((e) => !e.ok) ? " ✗" : " ✓";
    lines.push(`  ${id}  ${peer}  ${total}  ${steps}  ${started}${failed}`);
  }

  lines.push("  " + "─".repeat(72));
  lines.push(`  ${traces.length} trace${traces.length === 1 ? "" : "s"}`);
  return lines.join("\n");
}

// ─── Subcommands ──────────────────────────────────────────────────────────────

async function cmdShow(taskId: string, opts: { json?: boolean }): Promise<void> {
  const trace = await loadTrace(taskId);
  if (!trace) {
    p.log.error(`No trace found for task: ${taskId}`);
    process.exit(1);
    return;
  }
  if (opts.json) {
    process.stdout.write(JSON.stringify(trace, null, 2) + "\n");
    return;
  }
  console.log(renderTrace(trace));
}

async function cmdList(opts: { json?: boolean }): Promise<void> {
  const traces = await listTraces();
  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        traces.map((t) => ({
          task_id: t.task_id,
          peer: t.peer,
          objective: t.objective,
          started_at: t.started_at,
          ended_at: t.ended_at,
          total_ms: t.total_ms,
          steps: t.events.length,
          failed: t.events.filter((e) => !e.ok).length,
        })),
        null,
        2,
      ) + "\n",
    );
    return;
  }
  console.log(renderTraceList(traces));
}

async function cmdClear(taskId: string | undefined, opts: { force?: boolean }): Promise<void> {
  if (taskId) {
    // Clear single trace
    const removed = await clearTrace(taskId);
    if (removed) {
      p.log.success(`Cleared trace for task: ${taskId}`);
    } else {
      p.log.warn(`No trace found for task: ${taskId}`);
    }
    return;
  }

  // Clear all traces
  if (!opts.force) {
    const confirmed = await p.confirm({
      message: "Clear all traces? This cannot be undone.",
      initialValue: false,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      p.log.info("Cancelled.");
      return;
    }
  }

  const count = await clearAllTraces();
  p.log.success(`Cleared ${count} trace${count === 1 ? "" : "s"}.`);
}

// ─── Main entry ───────────────────────────────────────────────────────────────

export async function trace(
  subOrId: string | undefined,
  opts: { json?: boolean; force?: boolean },
  // second positional (used when subcommand is "clear <id>" or "show <id>")
  secondArg?: string,
): Promise<void> {
  // Route by first arg:
  //   hh trace list                → list
  //   hh trace clear [<id>]        → clear
  //   hh trace <task_id>           → show (default)
  //   hh trace show <task_id>      → show (explicit)

  if (!subOrId || subOrId === "list") {
    await cmdList(opts);
    return;
  }

  if (subOrId === "clear") {
    await cmdClear(secondArg, opts);
    return;
  }

  if (subOrId === "show") {
    if (!secondArg) {
      p.log.error("Usage: hh trace show <task_id>");
      process.exit(1);
      return;
    }
    await cmdShow(secondArg, opts);
    return;
  }

  // Default: treat subOrId as task_id
  await cmdShow(subOrId, opts);
}
