/**
 * cli/commands/trace.test.ts
 *
 * Phase 16 — Calcifer ✅ (2026-03-16)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock @cofounder/core ──────────────────────────────────────────────────

const mockTrace = {
  task_id: "abc123",
  peer: "glados",
  objective: "run inference on attached prompt",
  started_at: "2026-03-16T08:00:00.000Z",
  ended_at: "2026-03-16T08:00:01.200Z",
  total_ms: 1200,
  events: [
    {
      step: "preflight_ping",
      started_at: "2026-03-16T08:00:00.010Z",
      duration_ms: 32,
      ok: true,
      meta: { rtt_ms: 32 },
    },
    {
      step: "preflight_gateway",
      started_at: "2026-03-16T08:00:00.050Z",
      duration_ms: 18,
      ok: true,
    },
    {
      step: "gateway_connect",
      started_at: "2026-03-16T08:00:00.080Z",
      duration_ms: 120,
      ok: true,
    },
    {
      step: "gateway_auth",
      started_at: "2026-03-16T08:00:00.200Z",
      duration_ms: 45,
      ok: true,
    },
    {
      step: "gateway_wake",
      started_at: "2026-03-16T08:00:00.250Z",
      duration_ms: 30,
      ok: true,
    },
    {
      step: "result_received",
      started_at: "2026-03-16T08:00:01.100Z",
      duration_ms: 88,
      ok: true,
    },
  ],
};

const mockTraceWithFailure = {
  ...mockTrace,
  task_id: "fail01",
  events: [
    ...mockTrace.events.slice(0, 2),
    {
      step: "wol_wake",
      started_at: "2026-03-16T08:00:00.100Z",
      duration_ms: 5000,
      ok: false,
      error: "no MAC response after 3 attempts",
    },
  ],
};

vi.mock("@cofounder/core", async (importActual) => {
  const actual = await importActual<typeof import("@cofounder/core")>();
  return {
    ...actual,
    loadTrace: vi.fn(),
    listTraces: vi.fn(),
    clearTrace: vi.fn(),
    clearAllTraces: vi.fn(),
    formatStepLabel: actual.formatStepLabel,
    renderBar: actual.renderBar,
  };
});

vi.mock("@clack/prompts", () => ({
  log: {
    error: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
}));

import {
  loadTrace,
  listTraces,
  clearTrace,
  clearAllTraces,
} from "@cofounder/core";
import * as p from "@clack/prompts";
import { trace } from "./trace.ts";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("cofounder trace — show", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("shows trace for valid task_id", async () => {
    vi.mocked(loadTrace).mockResolvedValue(mockTrace);
    await trace("abc123", {});
    expect(loadTrace).toHaveBeenCalledWith("abc123");
    expect(console.log).toHaveBeenCalled();
  });

  it("shows trace via explicit 'show' subcommand", async () => {
    vi.mocked(loadTrace).mockResolvedValue(mockTrace);
    await trace("show", {}, "abc123");
    expect(loadTrace).toHaveBeenCalledWith("abc123");
  });

  it("exits 1 if task_id not found", async () => {
    vi.mocked(loadTrace).mockResolvedValue(null);
    await trace("missing123", {});
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("exits 1 if 'show' subcommand missing task_id arg", async () => {
    await trace("show", {}, undefined);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("outputs JSON when --json flag set", async () => {
    vi.mocked(loadTrace).mockResolvedValue(mockTrace);
    await trace("abc123", { json: true });
    const written = vi.mocked(process.stdout.write).mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.task_id).toBe("abc123");
    expect(parsed.events).toHaveLength(6);
  });

  it("renders failed steps in trace output", async () => {
    vi.mocked(loadTrace).mockResolvedValue(mockTraceWithFailure);
    await trace("fail01", {});
    const output = vi.mocked(console.log).mock.calls[0]?.[0] as string;
    expect(output).toContain("WOL wake");
    expect(output).toContain("no MAC response");
  });

  it("renders metadata inline", async () => {
    vi.mocked(loadTrace).mockResolvedValue(mockTrace);
    await trace("abc123", {});
    const output = vi.mocked(console.log).mock.calls[0]?.[0] as string;
    expect(output).toContain("rtt_ms");
  });
});

describe("cofounder trace — list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  it("lists traces in table format", async () => {
    vi.mocked(listTraces).mockResolvedValue([mockTrace, mockTraceWithFailure]);
    await trace("list", {});
    expect(listTraces).toHaveBeenCalled();
    const output = vi.mocked(console.log).mock.calls[0]?.[0] as string;
    expect(output).toContain("abc123");
    expect(output).toContain("fail01");
    expect(output).toContain("glados");
  });

  it("shows empty message when no traces", async () => {
    vi.mocked(listTraces).mockResolvedValue([]);
    await trace("list", {});
    const output = vi.mocked(console.log).mock.calls[0]?.[0] as string;
    expect(output).toContain("No traces found");
  });

  it("outputs JSON list when --json flag set", async () => {
    vi.mocked(listTraces).mockResolvedValue([mockTrace]);
    await trace("list", { json: true });
    const written = vi.mocked(process.stdout.write).mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].task_id).toBe("abc123");
    expect(parsed[0].steps).toBe(6);
    expect(typeof parsed[0].failed).toBe("number");
  });

  it("routes undefined subcommand to list", async () => {
    vi.mocked(listTraces).mockResolvedValue([]);
    await trace(undefined, {});
    expect(listTraces).toHaveBeenCalled();
  });
});

describe("cofounder trace — clear", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("clears single trace by id", async () => {
    vi.mocked(clearTrace).mockResolvedValue(true);
    await trace("clear", {}, "abc123");
    expect(clearTrace).toHaveBeenCalledWith("abc123");
    expect(p.log.success).toHaveBeenCalled();
  });

  it("warns when trace id not found", async () => {
    vi.mocked(clearTrace).mockResolvedValue(false);
    await trace("clear", {}, "missing");
    expect(p.log.warn).toHaveBeenCalled();
  });

  it("clears all traces with --force", async () => {
    vi.mocked(clearAllTraces).mockResolvedValue(5);
    await trace("clear", { force: true }, undefined);
    expect(clearAllTraces).toHaveBeenCalled();
    expect(p.log.success).toHaveBeenCalled();
    expect(p.confirm).not.toHaveBeenCalled();
  });

  it("prompts for confirmation without --force", async () => {
    vi.mocked(p.confirm).mockResolvedValue(true);
    vi.mocked(p.isCancel).mockReturnValue(false);
    vi.mocked(clearAllTraces).mockResolvedValue(3);
    await trace("clear", {}, undefined);
    expect(p.confirm).toHaveBeenCalled();
    expect(clearAllTraces).toHaveBeenCalled();
  });

  it("cancels clear-all if user declines confirmation", async () => {
    vi.mocked(p.confirm).mockResolvedValue(false);
    vi.mocked(p.isCancel).mockReturnValue(false);
    await trace("clear", {}, undefined);
    expect(clearAllTraces).not.toHaveBeenCalled();
    expect(p.log.info).toHaveBeenCalledWith("Cancelled.");
  });

  it("cancels clear-all if p.isCancel returns true", async () => {
    vi.mocked(p.confirm).mockResolvedValue(Symbol("cancel") as unknown as boolean);
    vi.mocked(p.isCancel).mockReturnValue(true);
    await trace("clear", {}, undefined);
    expect(clearAllTraces).not.toHaveBeenCalled();
  });
});
