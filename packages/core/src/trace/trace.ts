/**
 * core/trace/trace.ts — Structured execution tracing for cofounder task pipelines
 *
 * Records a timeline of named steps (WOL wake, gateway connect/auth, wake ACK,
 * watch pickup, streaming chunks, result delivery) with per-step durations.
 *
 * Designed for debugging Windows boot-chain issues and general latency analysis.
 *
 * Storage: ~/.cofounder/traces/<task_id>.json
 *
 * Phase 16 — Calcifer ✅ (2026-03-16)
 */

import { readFile, writeFile, readdir, unlink, mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

// ─── Paths ────────────────────────────────────────────────────────────────────

export const TRACE_DIR = join(homedir(), ".cofounder", "traces");

// ─── Step names ──────────────────────────────────────────────────────────────

/**
 * Well-known step names in the cofounder task pipeline.
 * Custom steps can use any string.
 */
export type TraceStepName =
  | "preflight_ping"       // Tailscale reachability check
  | "preflight_gateway"    // Gateway /health check
  | "wol_wake"             // WOL magic packet sent
  | "gateway_connect"      // WS connection established
  | "gateway_challenge"    // connect.challenge received
  | "gateway_auth"         // connect req/res (auth handshake)
  | "gateway_wake"         // wake req/res (message injected)
  | "result_server_start"  // H1 starts webhook result listener
  | "stream_server_start"  // H1 starts SSE stream server
  | "stream_chunk"         // streaming partial chunk received
  | "result_received"      // result delivered (webhook or poll)
  | "task_complete"        // full pipeline done
  | string;                // allow custom steps

// ─── Schemas ─────────────────────────────────────────────────────────────────

export const TraceEventSchema = z.object({
  /** Step identifier */
  step: z.string(),
  /** ISO 8601 timestamp when step started */
  started_at: z.string(),
  /** Elapsed milliseconds for this step (undefined = still in progress) */
  duration_ms: z.number().nonnegative().optional(),
  /** Whether the step succeeded */
  ok: z.boolean(),
  /** Error message if ok=false */
  error: z.string().optional(),
  /** Optional metadata (arbitrary key-value for debugging) */
  meta: z.record(z.unknown()).optional(),
});

export const TraceLogSchema = z.object({
  /** Task ID this trace belongs to */
  task_id: z.string(),
  /** Peer node name */
  peer: z.string(),
  /** Task objective (truncated to 200 chars) */
  objective: z.string(),
  /** ISO 8601 timestamp when tracing started */
  started_at: z.string(),
  /** ISO 8601 timestamp when tracing ended */
  ended_at: z.string().optional(),
  /** Total pipeline duration in ms */
  total_ms: z.number().nonnegative().optional(),
  /** Ordered list of trace events */
  events: z.array(TraceEventSchema),
});

export type TraceEvent = z.infer<typeof TraceEventSchema>;
export type TraceLog = z.infer<typeof TraceLogSchema>;

// ─── Store helpers ────────────────────────────────────────────────────────────

function tracePath(taskId: string): string {
  return join(TRACE_DIR, `${taskId}.json`);
}

export async function loadTrace(taskId: string): Promise<TraceLog | null> {
  try {
    const raw = await readFile(tracePath(taskId), "utf8");
    return TraceLogSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveTrace(trace: TraceLog): Promise<void> {
  await mkdir(TRACE_DIR, { recursive: true });
  await writeFile(tracePath(trace.task_id), JSON.stringify(trace, null, 2), "utf8");
}

export async function listTraces(): Promise<TraceLog[]> {
  try {
    const files = await readdir(TRACE_DIR);
    const traces: TraceLog[] = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(TRACE_DIR, f), "utf8");
        traces.push(TraceLogSchema.parse(JSON.parse(raw)));
      } catch {
        // skip malformed
      }
    }
    // Sort by started_at descending (newest first)
    return traces.sort(
      (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
    );
  } catch {
    return [];
  }
}

export async function clearTrace(taskId: string): Promise<boolean> {
  try {
    await unlink(tracePath(taskId));
    return true;
  } catch {
    return false;
  }
}

export async function clearAllTraces(): Promise<number> {
  try {
    const files = await readdir(TRACE_DIR);
    let count = 0;
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        await unlink(join(TRACE_DIR, f));
        count++;
      } catch {
        // ignore
      }
    }
    return count;
  } catch {
    return 0;
  }
}

// ─── TraceContext — in-memory builder ─────────────────────────────────────────

/**
 * Mutable in-memory trace builder, passed through the send pipeline.
 *
 * Usage:
 * ```ts
 * const ctx = createTraceContext({ task_id, peer, objective });
 * const done = ctx.step("gateway_connect");
 * // ... do work ...
 * done({ ok: true, meta: { rtt_ms: 42 } });
 * await ctx.finish({ ok: true });
 * const trace = ctx.build();
 * await saveTrace(trace);
 * ```
 */
export interface StepFinisher {
  (result: { ok: boolean; error?: string; meta?: Record<string, unknown> }): TraceEvent;
}

export interface TraceContext {
  /** Start a step; returns a finisher that records the duration. */
  step(name: TraceStepName): StepFinisher;
  /** Add a pre-built event (for steps without a finisher, e.g. stream chunks). */
  addEvent(event: TraceEvent): void;
  /** Mark the trace as complete and write ended_at + total_ms. */
  finish(): void;
  /** Build the final TraceLog. */
  build(): TraceLog;
}

export function createTraceContext(init: {
  task_id: string;
  peer: string;
  objective: string;
}): TraceContext {
  const started_at = new Date().toISOString();
  const events: TraceEvent[] = [];
  let ended_at: string | undefined;
  let total_ms: number | undefined;

  return {
    step(name) {
      const stepStart = Date.now();
      const step_started_at = new Date().toISOString();
      return function finish({ ok, error, meta }) {
        const duration_ms = Date.now() - stepStart;
        const event: TraceEvent = {
          step: name,
          started_at: step_started_at,
          duration_ms,
          ok,
          ...(error !== undefined ? { error } : {}),
          ...(meta !== undefined ? { meta } : {}),
        };
        events.push(event);
        return event;
      };
    },

    addEvent(event) {
      events.push(event);
    },

    finish() {
      ended_at = new Date().toISOString();
      total_ms = new Date(ended_at).getTime() - new Date(started_at).getTime();
    },

    build() {
      return {
        task_id: init.task_id,
        peer: init.peer,
        objective: init.objective.slice(0, 200),
        started_at,
        ...(ended_at !== undefined ? { ended_at } : {}),
        ...(total_ms !== undefined ? { total_ms } : {}),
        events,
      };
    },
  };
}

// ─── Formatting helpers ────────────────────────────────────────────────────────

const STEP_LABELS: Record<string, string> = {
  preflight_ping:      "Tailscale ping",
  preflight_gateway:   "Gateway health",
  wol_wake:            "WOL wake",
  gateway_connect:     "WS connect",
  gateway_challenge:   "Challenge recv",
  gateway_auth:        "Auth handshake",
  gateway_wake:        "Wake inject",
  result_server_start: "Result listener",
  stream_server_start: "Stream server",
  stream_chunk:        "Stream chunk",
  result_received:     "Result received",
  task_complete:       "Pipeline done",
};

export function formatStepLabel(step: string): string {
  return STEP_LABELS[step] ?? step.replace(/_/g, " ");
}

/**
 * Render a compact ASCII timeline bar for a step duration,
 * scaled relative to a max duration.
 *
 * Example: "████░░░░░░░░  42ms"
 */
export function renderBar(durationMs: number | undefined, maxMs: number, width = 12): string {
  if (durationMs === undefined || maxMs === 0) return "░".repeat(width);
  const filled = Math.round((durationMs / maxMs) * width);
  const clamped = Math.min(filled, width);
  return "█".repeat(clamped) + "░".repeat(width - clamped);
}
