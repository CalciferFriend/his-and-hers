/**
 * pipeline.test.ts — unit tests for hh pipeline
 *
 * Tests the orchestration logic:
 *   - Inline spec parsing + step execution flow
 *   - Step interpolation (previous.output threading)
 *   - continueOnError vs abort-on-failure semantics
 *   - skipped steps when pipeline is aborted
 *   - JSON output shape
 *   - Error paths: no config, bad peer, gateway unreachable, timeout
 *   - PipelineRunResult aggregation (cost, tokens, status)
 *
 * wakeAgent, pollTaskCompletion, checkGatewayHealth are mocked out.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as p from "@clack/prompts";
import { pipeline } from "./pipeline.ts";
import * as configStore from "../config/store.ts";
import * as coreMod from "@his-and-hers/core";
import * as tasksState from "../state/tasks.ts";
import * as peersSelect from "../peers/select.ts";
import type { HHConfig, PeerNodeConfig } from "../config/schema.ts";

// ── Silence clack output ──────────────────────────────────────────────────
vi.mock("@clack/prompts", async () => {
  const actual = await vi.importActual<typeof p>("@clack/prompts");
  return {
    ...actual,
    intro: vi.fn(),
    outro: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), step: vi.fn() },
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() })),
  };
});

vi.mock("../config/store.ts");
vi.mock("@his-and-hers/core", async () => {
  const actual = await vi.importActual<typeof import("@his-and-hers/core")>("@his-and-hers/core");
  return {
    ...actual,
    // Keep pure parsers + interpolation as real implementations.
    // Stub only the side-effectful network/IO functions.
    checkGatewayHealth: vi.fn(),
    wakeAgent: vi.fn(),
    loadContextSummary: vi.fn(),
    createTaskMessage: vi.fn(),
    withRetry: vi.fn(),
  };
});
vi.mock("../state/tasks.ts");
vi.mock("../peers/select.ts");
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

// ── Fixture helpers ───────────────────────────────────────────────────────

function makePeer(name: string): PeerNodeConfig {
  return {
    name,
    tailscale_ip: `100.0.0.1`,
    ssh_user: "ubuntu",
    gateway_token: `tok-${name}`,
    gateway_port: 18789,
    gateway_url: `http://100.0.0.1:18789`,
  } as unknown as PeerNodeConfig;
}

function makeConfig(peerNames: string[] = ["glados"]): HHConfig {
  return {
    role: "h1",
    identity: { name: "Calcifer", emoji: "🔥", model: "claude-3-5-sonnet" },
    peer_node: { name: peerNames[0]!, tailscale_ip: "100.0.0.1", ssh_user: "ubuntu", gateway_token: "tok", gateway_port: 18789, gateway_url: "http://100.0.0.1:18789" },
    peer_nodes: peerNames.map(makePeer),
  } as unknown as HHConfig;
}

function makeCompletedState(taskId: string, output: string, tokens = 100, cost = 0.001) {
  return {
    id: taskId,
    status: "completed" as const,
    result: { output, tokens_used: tokens, cost_usd: cost },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function makeFailedState(taskId: string, error: string) {
  return {
    id: taskId,
    status: "failed" as const,
    result: { error },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// ── Setup / teardown ──────────────────────────────────────────────────────

let consoleLogSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  // Default mocks — all succeed
  vi.mocked(configStore.loadConfig).mockResolvedValue(makeConfig(["glados", "piper"]));
  vi.mocked(coreMod.checkGatewayHealth).mockResolvedValue(undefined as never);
  vi.mocked(coreMod.wakeAgent).mockResolvedValue({ ok: true } as never);
  vi.mocked(coreMod.loadContextSummary).mockResolvedValue("");
  vi.mocked(coreMod.createTaskMessage).mockReturnValue("wake text");
  vi.mocked(coreMod.withRetry).mockImplementation((fn) => fn());
  vi.mocked(peersSelect.findPeerByName).mockImplementation((_cfg, name) =>
    name === "glados" ? makePeer("glados") :
    name === "piper"  ? makePeer("piper")  :
    null,
  );
  vi.mocked(tasksState.createTaskState).mockImplementation(async (s) => ({
    ...s,
    status: "pending" as const,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
  vi.mocked(tasksState.pollTaskCompletion).mockImplementation(async (id) =>
    makeCompletedState(id, `output for ${id}`),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// No-config guard
// ─────────────────────────────────────────────────────────────────────────────

describe("no config", () => {
  it("logs error and returns when config is null", async () => {
    vi.mocked(configStore.loadConfig).mockResolvedValue(null);
    await pipeline("glados:do thing", {});
    expect(p.log.error).toHaveBeenCalledWith(expect.stringContaining("No configuration"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Input validation
// ─────────────────────────────────────────────────────────────────────────────

describe("input validation", () => {
  it("logs error when no spec and no file provided", async () => {
    await pipeline(undefined, {});
    expect(p.log.error).toHaveBeenCalledWith(expect.stringContaining("pipeline spec"));
  });

  it("logs error on invalid inline spec (missing colon)", async () => {
    await pipeline("glados do thing", {});
    expect(p.log.error).toHaveBeenCalledWith(expect.stringContaining("Invalid pipeline spec"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Single-step pipeline
// ─────────────────────────────────────────────────────────────────────────────

describe("single-step pipeline", () => {
  it("runs one step and completes", async () => {
    await pipeline("glados:write unit tests", {});
    expect(tasksState.createTaskState).toHaveBeenCalledTimes(1);
    expect(tasksState.pollTaskCompletion).toHaveBeenCalledTimes(1);
    expect(p.outro).toHaveBeenCalledWith(expect.stringContaining("COMPLETED"));
  });

  it("JSON output contains correct structure", async () => {
    await pipeline("glados:test task", { json: true });
    const call = consoleLogSpy.mock.calls.find((args) =>
      typeof args[0] === "string" && args[0].includes("pipeline_id"),
    );
    expect(call).toBeDefined();
    const result = JSON.parse(call![0] as string);
    expect(result.status).toBe("completed");
    expect(result.total_steps).toBe(1);
    expect(result.completed_steps).toBe(1);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].status).toBe("completed");
    expect(result.steps[0].peer).toBe("glados");
  });

  it("JSON output includes cost + token totals", async () => {
    vi.mocked(tasksState.pollTaskCompletion).mockImplementation(async (id) =>
      makeCompletedState(id, "output", 500, 0.005),
    );
    await pipeline("glados:cost test", { json: true });
    const call = consoleLogSpy.mock.calls.find((args) =>
      typeof args[0] === "string" && args[0].includes("total_cost_usd"),
    );
    const result = JSON.parse(call![0] as string);
    expect(result.total_cost_usd).toBeCloseTo(0.005);
    expect(result.total_tokens).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Multi-step pipeline
// ─────────────────────────────────────────────────────────────────────────────

describe("multi-step pipeline", () => {
  it("runs two steps in sequence", async () => {
    await pipeline("glados:step one -> piper:step two", {});
    expect(tasksState.createTaskState).toHaveBeenCalledTimes(2);
    expect(tasksState.pollTaskCompletion).toHaveBeenCalledTimes(2);
    expect(p.outro).toHaveBeenCalledWith(expect.stringContaining("COMPLETED"));
  });

  it("interpolates {{previous.output}} into second step", async () => {
    let capturedTask: string | undefined;
    vi.mocked(tasksState.createTaskState).mockImplementation(async (s) => {
      capturedTask = s.task;
      return { ...s, status: "pending" as const, created_at: "", updated_at: "" };
    });
    // First call → step 1 (glados), second call → step 2 (piper)
    let callCount = 0;
    vi.mocked(tasksState.createTaskState).mockImplementation(async (s) => {
      callCount++;
      if (callCount === 1) {
        // step 1
      } else {
        capturedTask = s.task; // step 2 task (should have interpolated output)
      }
      return { ...s, status: "pending" as const, created_at: "", updated_at: "" };
    });
    vi.mocked(tasksState.pollTaskCompletion).mockImplementation(async (id) =>
      makeCompletedState(id, "GENERATED_CODE"),
    );

    await pipeline("glados:generate code -> piper:review {{previous.output}}", {});
    expect(capturedTask).toContain("GENERATED_CODE");
  });

  it("JSON: completed_steps and failed_steps are accurate", async () => {
    await pipeline("glados:step one -> piper:step two", { json: true });
    const call = consoleLogSpy.mock.calls.find((args) =>
      typeof args[0] === "string" && args[0].includes("pipeline_id"),
    );
    const result = JSON.parse(call![0] as string);
    expect(result.completed_steps).toBe(2);
    expect(result.failed_steps).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Failure handling
// ─────────────────────────────────────────────────────────────────────────────

describe("failure handling", () => {
  it("aborts subsequent steps when a step fails (continueOnError=false, default)", async () => {
    vi.mocked(tasksState.pollTaskCompletion).mockResolvedValueOnce(
      makeFailedState("t-1", "task failed"),
    );
    await pipeline("glados:step one -> piper:step two", { json: true });
    const call = consoleLogSpy.mock.calls.find((args) =>
      typeof args[0] === "string" && args[0].includes("pipeline_id"),
    );
    const result = JSON.parse(call![0] as string);
    expect(result.status).toBe("failed");
    expect(result.steps[0].status).toBe("failed");
    expect(result.steps[1].status).toBe("skipped");
  });

  it("continues when peer is not found", async () => {
    vi.mocked(peersSelect.findPeerByName).mockReturnValue(null);
    await pipeline("unknown-peer:task", { json: true });
    const call = consoleLogSpy.mock.calls.find((args) =>
      typeof args[0] === "string" && args[0].includes("pipeline_id"),
    );
    const result = JSON.parse(call![0] as string);
    expect(result.status).toBe("failed");
    expect(result.steps[0].status).toBe("failed");
    expect(result.steps[0].error).toContain("not found");
  });

  it("marks step as failed when gateway is unreachable", async () => {
    vi.mocked(coreMod.checkGatewayHealth).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await pipeline("glados:a task", { json: true });
    const call = consoleLogSpy.mock.calls.find((args) =>
      typeof args[0] === "string" && args[0].includes("pipeline_id"),
    );
    const result = JSON.parse(call![0] as string);
    expect(result.steps[0].status).toBe("failed");
    expect(result.steps[0].error).toContain("unreachable");
  });

  it("marks step as timeout when poll returns null", async () => {
    vi.mocked(tasksState.pollTaskCompletion).mockResolvedValueOnce(null);
    await pipeline("glados:slow task", { json: true });
    const call = consoleLogSpy.mock.calls.find((args) =>
      typeof args[0] === "string" && args[0].includes("pipeline_id"),
    );
    const result = JSON.parse(call![0] as string);
    expect(result.steps[0].status).toBe("timeout");
  });

  it("status=partial when some but not all steps complete", async () => {
    // step 1 → ok, step 2 → failed but continueOnError is tricky to test inline
    // For this we need a 2-step pipeline where step 2 fails but step 1 succeeds
    vi.mocked(tasksState.pollTaskCompletion)
      .mockResolvedValueOnce(makeCompletedState("t1", "done"))
      .mockResolvedValueOnce(makeFailedState("t2", "boom"));

    // Need continueOnError=true on step1 to get "partial"
    // Use file-based pipeline to set continueOnError — mock file system
    const { readFileSync, existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        name: "partial-test",
        steps: [
          { peer: "glados", task: "step one", continueOnError: true },
          { peer: "piper", task: "step two" },
        ],
      }) as never,
    );

    await pipeline(undefined, { file: "pipeline.json", json: true });
    const call = consoleLogSpy.mock.calls.find((args) =>
      typeof args[0] === "string" && args[0].includes("pipeline_id"),
    );
    const result = JSON.parse(call![0] as string);
    expect(result.status).toBe("partial");
    expect(result.completed_steps).toBe(1);
    expect(result.failed_steps).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// File-based pipeline
// ─────────────────────────────────────────────────────────────────────────────

describe("file-based pipeline", () => {
  it("loads and runs a valid JSON pipeline file", async () => {
    const { readFileSync, existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        name: "test-pipe",
        steps: [{ peer: "glados", task: "do thing" }],
      }) as never,
    );

    await pipeline(undefined, { file: "my-pipe.json", json: true });
    const call = consoleLogSpy.mock.calls.find((args) =>
      typeof args[0] === "string" && args[0].includes("pipeline_id"),
    );
    const result = JSON.parse(call![0] as string);
    expect(result.name).toBe("test-pipe");
    expect(result.status).toBe("completed");
  });

  it("logs error when file does not exist", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(false);
    await pipeline(undefined, { file: "missing.json" });
    expect(p.log.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Output shape sanity checks
// ─────────────────────────────────────────────────────────────────────────────

describe("JSON output shape", () => {
  it("always includes required top-level fields", async () => {
    await pipeline("glados:task", { json: true });
    const call = consoleLogSpy.mock.calls.find((args) =>
      typeof args[0] === "string" && args[0].includes("pipeline_id"),
    );
    const result = JSON.parse(call![0] as string);
    expect(result).toMatchObject({
      pipeline_id: expect.any(String),
      name: expect.any(String),
      status: expect.stringMatching(/^(completed|failed|partial)$/),
      steps: expect.any(Array),
      total_steps: expect.any(Number),
      completed_steps: expect.any(Number),
      failed_steps: expect.any(Number),
      total_cost_usd: expect.any(Number),
      total_tokens: expect.any(Number),
      total_duration_ms: expect.any(Number),
      started_at: expect.any(String),
      finished_at: expect.any(String),
    });
  });

  it("each step result has required fields", async () => {
    await pipeline("glados:task", { json: true });
    const call = consoleLogSpy.mock.calls.find((args) =>
      typeof args[0] === "string" && args[0].includes("pipeline_id"),
    );
    const result = JSON.parse(call![0] as string);
    const step = result.steps[0];
    expect(step).toMatchObject({
      stepIndex: 0,
      label: expect.any(String),
      peer: "glados",
      task_id: expect.any(String),
      status: expect.any(String),
    });
  });

  it("pipeline_id is an 8-character hex string", async () => {
    await pipeline("glados:task", { json: true });
    const call = consoleLogSpy.mock.calls.find((args) =>
      typeof args[0] === "string" && args[0].includes("pipeline_id"),
    );
    const result = JSON.parse(call![0] as string);
    expect(result.pipeline_id).toMatch(/^[0-9a-f-]{8}$/);
  });
});
