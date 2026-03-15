/**
 * broadcast.test.ts — unit tests for hh broadcast
 *
 * We test the pure-logic surface:
 *   - peer resolution from config
 *   - JSON output shape
 *   - strategy="first" vs strategy="all" semantics
 *   - error paths (no config, no peers, bad peer name)
 *   - result aggregation (ok/fail counts, cost/token totals)
 *
 * The wakeAgent / polling functions are mocked out — we're not testing
 * network I/O here, just the orchestration logic.
 */

import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";
import * as p from "@clack/prompts";
import { broadcast } from "./broadcast.ts";
import * as configStore from "../config/store.ts";
import * as coreMod from "@his-and-hers/core";
import * as tasksState from "../state/tasks.ts";
import * as peersSelect from "../peers/select.ts";
import type { HHConfig, PeerNodeConfig } from "../config/schema.ts";

// ── Silence clack output in tests ──────────────────────────────────────────
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
vi.mock("@his-and-hers/core");
vi.mock("../state/tasks.ts");
vi.mock("../peers/select.ts");

// ── Fixture helpers ─────────────────────────────────────────────────────────

function makePeer(name: string): PeerNodeConfig {
  return {
    name,
    tailscale_ip: `100.0.0.${name.charCodeAt(0)}`,
    ssh_user: "ubuntu",
    gateway_token: `tok-${name}`,
    gateway_port: 18789,
  } as PeerNodeConfig;
}

function makeConfig(peers: PeerNodeConfig[]): HHConfig {
  return {
    this_node: { name: "calcifer", role: "H1", tailscale_ip: "100.1.1.1" },
    peer_node: peers[0],
    peer_nodes: peers.slice(1),
  } as unknown as HHConfig;
}

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default: config with two peers
  const peers = [makePeer("glados"), makePeer("piper")];
  vi.mocked(configStore.loadConfig).mockResolvedValue(makeConfig(peers));
  vi.mocked(peersSelect.getAllPeers).mockReturnValue(peers);
  vi.mocked(peersSelect.findPeerByName).mockImplementation((_, name) =>
    peers.find((p) => p.name === name) ?? null,
  );

  // Core stubs
  vi.mocked(coreMod.checkGatewayHealth).mockResolvedValue(true);
  vi.mocked(coreMod.loadContextSummary).mockResolvedValue(null);
  vi.mocked(coreMod.createTaskMessage).mockImplementation((_from, to, payload) => ({
    id: `task-${to}-${Date.now()}`,
    type: "task" as const,
    from: "calcifer",
    to,
    created_at: new Date().toISOString(),
    payload,
  }));
  vi.mocked(coreMod.withRetry).mockImplementation(async (fn) => fn());
  vi.mocked(coreMod.wakeAgent).mockResolvedValue({ ok: true });

  // Task state stubs
  vi.mocked(tasksState.createTaskState).mockResolvedValue(undefined as never);
  vi.mocked(tasksState.pollTaskCompletion).mockResolvedValue({
    id: "task-x",
    from: "calcifer",
    to: "glados",
    objective: "test",
    constraints: [],
    status: "completed",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    result: {
      output: "done",
      success: true,
      artifacts: [],
      tokens_used: 100,
      cost_usd: 0.0025,
      duration_ms: 500,
    },
  });
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("broadcast — config checks", () => {
  it("exits with error when config is missing", async () => {
    vi.mocked(configStore.loadConfig).mockResolvedValue(null);
    await broadcast("hello", {});
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined as unknown as number;
  });

  it("exits with error when no peers are configured", async () => {
    vi.mocked(peersSelect.getAllPeers).mockReturnValue([]);
    await broadcast("hello", {});
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined as unknown as number;
  });

  it("warns and skips unknown peer names", async () => {
    vi.mocked(peersSelect.findPeerByName).mockReturnValue(null);
    // All names resolve to null → zero targets → exits 1
    await broadcast("hello", { peers: "nobody" });
    expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining("nobody"));
    process.exitCode = undefined as unknown as number;
  });
});

describe("broadcast — send-only (no --wait)", () => {
  it("delivers to all peers by default", async () => {
    await broadcast("run tests", {});
    // wakeAgent should be called once per peer (2 peers)
    expect(coreMod.wakeAgent).toHaveBeenCalledTimes(2);
  });

  it("delivers only to the specified --peers subset", async () => {
    await broadcast("run tests", { peers: "glados" });
    expect(coreMod.wakeAgent).toHaveBeenCalledTimes(1);
  });

  it("creates a task state entry per peer", async () => {
    await broadcast("code review", {});
    expect(tasksState.createTaskState).toHaveBeenCalledTimes(2);
  });

  it("marks results as 'sent' when not waiting", async () => {
    const lines: string[] = [];
    vi.mocked(p.log.info).mockImplementation((s) => lines.push(s as string));

    await broadcast("run tests", { peers: "glados" });
    // Should have printed a "sent" status line
    expect(lines.some((l) => l.includes("sent"))).toBe(true);
  });
});

describe("broadcast — with --wait, strategy=all", () => {
  it("polls for completion for each peer", async () => {
    await broadcast("generate docs", { wait: true, strategy: "all" });
    expect(tasksState.pollTaskCompletion).toHaveBeenCalledTimes(2);
  });

  it("shows completed output per peer", async () => {
    const lines: string[] = [];
    vi.mocked(p.log.info).mockImplementation((s) => lines.push(s as string));

    await broadcast("generate docs", { wait: true, strategy: "all" });
    expect(lines.some((l) => l.includes("completed"))).toBe(true);
  });
});

describe("broadcast — strategy=first", () => {
  it("calls wakeAgent for all peers but resolves on the first result", async () => {
    await broadcast("quick question", { wait: true, strategy: "first" });
    // wakeAgent fires for both, but we only await the race winner
    expect(coreMod.wakeAgent).toHaveBeenCalledTimes(2);
  });
});

describe("broadcast — failure handling", () => {
  it("records failed status when gateway is unhealthy", async () => {
    vi.mocked(coreMod.checkGatewayHealth).mockResolvedValue(false);
    const lines: string[] = [];
    vi.mocked(p.log.info).mockImplementation((s) => lines.push(s as string));

    await broadcast("test", { peers: "glados" });
    expect(lines.some((l) => l.includes("failed"))).toBe(true);
  });

  it("records failed status when wakeAgent throws", async () => {
    vi.mocked(coreMod.withRetry).mockRejectedValue(new Error("connection refused"));
    const lines: string[] = [];
    vi.mocked(p.log.info).mockImplementation((s) => lines.push(s as string));

    await broadcast("test", { peers: "glados" });
    expect(lines.some((l) => l.includes("failed"))).toBe(true);
  });

  it("records timeout status when pollTaskCompletion returns null", async () => {
    vi.mocked(tasksState.pollTaskCompletion).mockResolvedValue(null as never);
    const lines: string[] = [];
    vi.mocked(p.log.info).mockImplementation((s) => lines.push(s as string));

    await broadcast("test", { wait: true, peers: "glados" });
    expect(lines.some((l) => l.includes("timeout"))).toBe(true);
  });
});

describe("broadcast — JSON output", () => {
  it("emits valid JSON with task and results array", async () => {
    const out: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((s) => out.push(s));

    await broadcast("review code", { json: true });

    spy.mockRestore();
    expect(out).toHaveLength(1);
    const parsed = JSON.parse(out[0]);
    expect(parsed).toMatchObject({
      task: "review code",
      strategy: "all",
      results: expect.any(Array),
    });
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0]).toMatchObject({
      peer: expect.any(String),
      task_id: expect.any(String),
      status: expect.stringMatching(/sent|completed|failed|timeout/),
    });
  });

  it("JSON includes cost and token fields when waiting", async () => {
    const out: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((s) => out.push(s));

    await broadcast("generate", { json: true, wait: true, peers: "glados" });

    spy.mockRestore();
    const parsed = JSON.parse(out[0]);
    const result = parsed.results[0];
    expect(result.tokens_used).toBe(100);
    expect(result.cost_usd).toBe(0.0025);
    expect(result.status).toBe("completed");
  });

  it("JSON output suppresses clack UI", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await broadcast("hello", { json: true });
    expect(p.intro).not.toHaveBeenCalled();
    expect(p.outro).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe("broadcast — skips gateway check with --no-check", () => {
  it("does not call checkGatewayHealth when noCheck is true", async () => {
    await broadcast("test", { noCheck: true });
    expect(coreMod.checkGatewayHealth).not.toHaveBeenCalled();
  });
});

describe("broadcast — custom wait timeout", () => {
  it("passes parsed timeout to pollTaskCompletion", async () => {
    await broadcast("long task", { wait: true, waitTimeoutSeconds: "60", peers: "glados" });
    expect(tasksState.pollTaskCompletion).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeoutMs: 60_000 }),
    );
  });
});
