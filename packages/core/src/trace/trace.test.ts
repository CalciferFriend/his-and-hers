/**
 * core/trace/trace.test.ts
 *
 * Phase 16 — Calcifer ✅ (2026-03-16)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";

// ─── Path override (point TRACE_DIR at a temp dir) ───────────────────────────

const tmpTraceDir = join(tmpdir(), `hh-trace-test-${process.pid}`);

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: () => join(actual.tmpdir(), `hh-trace-test-${process.pid}`, "home"),
  };
});

import {
  createTraceContext,
  saveTrace,
  loadTrace,
  listTraces,
  clearTrace,
  clearAllTraces,
  renderBar,
  formatStepLabel,
  TraceLog,
} from "./trace.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function cleanDir() {
  const dir = join(tmpdir(), `hh-trace-test-${process.pid}`, "home", ".his-and-hers", "traces");
  try {
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dir);
    await Promise.all(
      files.map((f) => unlink(join(dir, f)).catch(() => {})),
    );
  } catch {
    // doesn't exist yet
  }
}

// ─── TraceContext tests ───────────────────────────────────────────────────────

describe("createTraceContext", () => {
  it("builds an empty trace with correct metadata", () => {
    const ctx = createTraceContext({ task_id: "t1", peer: "glados", objective: "run inference" });
    ctx.finish();
    const trace = ctx.build();
    expect(trace.task_id).toBe("t1");
    expect(trace.peer).toBe("glados");
    expect(trace.objective).toBe("run inference");
    expect(trace.events).toHaveLength(0);
    expect(trace.ended_at).toBeDefined();
    expect(trace.total_ms).toBeGreaterThanOrEqual(0);
  });

  it("truncates objective to 200 chars", () => {
    const long = "x".repeat(300);
    const ctx = createTraceContext({ task_id: "t2", peer: "p", objective: long });
    expect(ctx.build().objective).toHaveLength(200);
  });

  it("records step with ok=true and duration", async () => {
    const ctx = createTraceContext({ task_id: "t3", peer: "glados", objective: "test" });
    const done = ctx.step("gateway_connect");
    await new Promise((r) => setTimeout(r, 5));
    const event = done({ ok: true, meta: { rtt_ms: 5 } });
    ctx.finish();
    const trace = ctx.build();
    expect(trace.events).toHaveLength(1);
    expect(event.step).toBe("gateway_connect");
    expect(event.ok).toBe(true);
    expect(event.duration_ms).toBeGreaterThanOrEqual(0);
    expect(event.meta).toEqual({ rtt_ms: 5 });
    expect(event.error).toBeUndefined();
  });

  it("records step with ok=false and error", () => {
    const ctx = createTraceContext({ task_id: "t4", peer: "glados", objective: "test" });
    const done = ctx.step("wol_wake");
    const event = done({ ok: false, error: "no response from MAC" });
    ctx.finish();
    const trace = ctx.build();
    expect(trace.events[0].ok).toBe(false);
    expect(trace.events[0].error).toBe("no response from MAC");
    expect(event).toBe(trace.events[0]);
  });

  it("addEvent pushes a pre-built event", () => {
    const ctx = createTraceContext({ task_id: "t5", peer: "p", objective: "test" });
    ctx.addEvent({
      step: "stream_chunk",
      started_at: new Date().toISOString(),
      duration_ms: 10,
      ok: true,
      meta: { bytes: 512 },
    });
    const trace = ctx.build();
    expect(trace.events[0].step).toBe("stream_chunk");
    expect(trace.events[0].meta).toEqual({ bytes: 512 });
  });

  it("records multiple steps in order", () => {
    const ctx = createTraceContext({ task_id: "t6", peer: "p", objective: "o" });
    ctx.step("preflight_ping")({ ok: true });
    ctx.step("preflight_gateway")({ ok: true });
    ctx.step("gateway_connect")({ ok: true });
    ctx.step("gateway_auth")({ ok: true });
    ctx.step("gateway_wake")({ ok: true });
    const trace = ctx.build();
    const steps = trace.events.map((e) => e.step);
    expect(steps).toEqual([
      "preflight_ping",
      "preflight_gateway",
      "gateway_connect",
      "gateway_auth",
      "gateway_wake",
    ]);
  });

  it("build without finish omits ended_at and total_ms", () => {
    const ctx = createTraceContext({ task_id: "t7", peer: "p", objective: "o" });
    const trace = ctx.build();
    expect(trace.ended_at).toBeUndefined();
    expect(trace.total_ms).toBeUndefined();
  });
});

// ─── Store tests ──────────────────────────────────────────────────────────────

describe("trace store", () => {
  beforeEach(cleanDir);
  afterEach(cleanDir);

  function makeTrace(overrides?: Partial<TraceLog>): TraceLog {
    return {
      task_id: "abc123",
      peer: "glados",
      objective: "run a test",
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      total_ms: 250,
      events: [
        {
          step: "gateway_connect",
          started_at: new Date().toISOString(),
          duration_ms: 40,
          ok: true,
        },
      ],
      ...overrides,
    };
  }

  it("saveTrace + loadTrace round-trip", async () => {
    const trace = makeTrace();
    await saveTrace(trace);
    const loaded = await loadTrace("abc123");
    expect(loaded).not.toBeNull();
    expect(loaded!.task_id).toBe("abc123");
    expect(loaded!.total_ms).toBe(250);
    expect(loaded!.events[0].step).toBe("gateway_connect");
  });

  it("loadTrace returns null for unknown task_id", async () => {
    const result = await loadTrace("nonexistent");
    expect(result).toBeNull();
  });

  it("listTraces returns empty array when dir is missing", async () => {
    const traces = await listTraces();
    expect(Array.isArray(traces)).toBe(true);
  });

  it("listTraces returns traces sorted by started_at desc", async () => {
    const older = makeTrace({
      task_id: "old1",
      started_at: new Date(Date.now() - 60_000).toISOString(),
    });
    const newer = makeTrace({
      task_id: "new1",
      started_at: new Date(Date.now() - 1_000).toISOString(),
    });
    await saveTrace(older);
    await saveTrace(newer);
    const traces = await listTraces();
    expect(traces[0].task_id).toBe("new1");
    expect(traces[1].task_id).toBe("old1");
  });

  it("clearTrace removes the file", async () => {
    await saveTrace(makeTrace());
    const removed = await clearTrace("abc123");
    expect(removed).toBe(true);
    const loaded = await loadTrace("abc123");
    expect(loaded).toBeNull();
  });

  it("clearTrace returns false for missing file", async () => {
    const removed = await clearTrace("never-existed");
    expect(removed).toBe(false);
  });

  it("clearAllTraces removes all trace files and returns count", async () => {
    await saveTrace(makeTrace({ task_id: "x1" }));
    await saveTrace(makeTrace({ task_id: "x2" }));
    await saveTrace(makeTrace({ task_id: "x3" }));
    const count = await clearAllTraces();
    expect(count).toBe(3);
    const traces = await listTraces();
    expect(traces).toHaveLength(0);
  });

  it("clearAllTraces returns 0 when dir is empty", async () => {
    const count = await clearAllTraces();
    expect(count).toBe(0);
  });

  it("listTraces skips malformed JSON files gracefully", async () => {
    const { homedir } = await import("node:os");
    const badPath = join(homedir(), ".his-and-hers", "traces", "bad.json");
    await mkdir(join(homedir(), ".his-and-hers", "traces"), { recursive: true });
    await writeFile(badPath, "{ this is not valid json }", "utf8");
    const traces = await listTraces();
    expect(Array.isArray(traces)).toBe(true);
    // bad file should be silently skipped
    expect(traces.every((t) => typeof t.task_id === "string")).toBe(true);
    await unlink(badPath).catch(() => {});
  });
});

// ─── Formatting tests ─────────────────────────────────────────────────────────

describe("renderBar", () => {
  it("renders a full bar when duration equals max", () => {
    expect(renderBar(100, 100, 10)).toBe("██████████");
  });

  it("renders an empty bar when duration is 0", () => {
    expect(renderBar(0, 100, 10)).toBe("░░░░░░░░░░");
  });

  it("renders a half bar for 50% of max", () => {
    const bar = renderBar(50, 100, 10);
    expect(bar).toBe("█████░░░░░");
  });

  it("clamps to full bar when duration exceeds max", () => {
    const bar = renderBar(200, 100, 8);
    expect(bar).toBe("████████");
  });

  it("returns empty bar when maxMs is 0", () => {
    expect(renderBar(50, 0, 6)).toBe("░░░░░░");
  });

  it("returns empty bar when durationMs is undefined", () => {
    expect(renderBar(undefined, 100, 6)).toBe("░░░░░░");
  });
});

describe("formatStepLabel", () => {
  it("returns human label for known step", () => {
    expect(formatStepLabel("gateway_connect")).toBe("WS connect");
    expect(formatStepLabel("wol_wake")).toBe("WOL wake");
    expect(formatStepLabel("preflight_ping")).toBe("Tailscale ping");
    expect(formatStepLabel("result_received")).toBe("Result received");
  });

  it("replaces underscores for unknown steps", () => {
    expect(formatStepLabel("custom_step_name")).toBe("custom step name");
  });
});
