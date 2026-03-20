/**
 * @cofounder/sdk — unit tests
 *
 * All tests are fully offline — no real Tailscale, no gateway, no disk I/O.
 * We inject config objects and mock the core transport/gateway functions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SDKConfig } from "./types.ts";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock @cofounder/core transport + gateway
vi.mock("@cofounder/core", () => ({
  getTailscaleStatus: vi.fn().mockResolvedValue({ online: true, hostname: "calcifer", tailscaleIP: "100.1.2.3" }),
  pingPeer: vi.fn().mockResolvedValue(true),
  waitForPeer: vi.fn().mockResolvedValue(true),
  wakeAgent: vi.fn().mockResolvedValue({ ok: true }),
  checkGatewayHealth: vi.fn().mockResolvedValue(true),
  startResultServer: vi.fn().mockResolvedValue({
    url: "http://100.1.2.3:39999/result",
    port: 39999,
    result: Promise.resolve({
      task_id: "mock-task-id",
      output: "42",
      success: true,
      artifacts: [],
      tokens_used: 150,
      duration_ms: 800,
      cost_usd: 0.0003,
    }),
    waitForResult: vi.fn(),
    close: vi.fn(),
  }),
  startStreamServer: vi.fn().mockResolvedValue({
    url: "http://100.1.2.3:40000/stream",
    port: 40000,
    done: Promise.resolve(),
    close: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    once: vi.fn(),
    removeAllListeners: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    listeners: vi.fn().mockReturnValue([]),
    rawListeners: vi.fn().mockReturnValue([]),
    listenerCount: vi.fn().mockReturnValue(0),
    eventNames: vi.fn().mockReturnValue([]),
    getMaxListeners: vi.fn().mockReturnValue(10),
    setMaxListeners: vi.fn(),
    prependListener: vi.fn(),
    prependOnceListener: vi.fn(),
  }),
  createTaskMessage: vi.fn((opts) => ({
    type: "task",
    from: opts.from,
    to: opts.to,
    payload: { objective: opts.objective, constraints: opts.constraints ?? [] },
  })),
}));

// Mock state module — track calls; simulate empty state by default
const mockTasks: Record<string, ReturnType<typeof makeMockState>> = {};

function makeMockState(id: string, from: string, to: string, objective: string) {
  return {
    id,
    from,
    to,
    objective,
    constraints: [],
    status: "pending" as const,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    result: null,
  };
}

// Mock config module so loadConfig can be controlled per-test
vi.mock("./config.ts", () => ({
  loadConfig: vi.fn().mockResolvedValue(null),
  DEFAULT_CONFIG_PATH: "/mock/.cofounder/cofounder.json",
}));

vi.mock("./state.ts", () => ({
  createTaskState: vi.fn(async (t) => {
    const state = makeMockState(t.id, t.from, t.to, t.objective);
    mockTasks[t.id] = state;
    return state;
  }),
  loadTaskState: vi.fn(async (id) => mockTasks[id] ?? null),
  listTaskStates: vi.fn(async () => Object.values(mockTasks)),
  updateTaskState: vi.fn(async (id, patch) => {
    if (mockTasks[id]) {
      Object.assign(mockTasks[id], patch, { updated_at: new Date().toISOString() });
      return mockTasks[id];
    }
    return null;
  }),
  pollTaskCompletion: vi.fn(async (id) => {
    const state = mockTasks[id];
    if (!state) return null;
    // Simulate instant completion for tests
    state.status = "completed";
    state.result = { output: "done", success: true, artifacts: [], tokens_used: 100, duration_ms: 500, cost_usd: 0.0002 };
    return state;
  }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_CONFIG: SDKConfig = {
  this_node: { name: "calcifer", emoji: "🔥", tailscale_ip: "100.1.2.3" },
  peer_node: {
    name: "glados",
    emoji: "🤖",
    tailscale_ip: "100.9.8.7",
    gateway_port: 18789,
    gateway_token: "tok-abc123",
    os: "windows",
  },
};

const MULTI_PEER_CONFIG: SDKConfig = {
  ...BASE_CONFIG,
  peer_nodes: [
    {
      name: "jarvis",
      tailscale_ip: "100.5.5.5",
      gateway_port: 18790,
      gateway_token: "tok-jarvis",
      os: "linux",
    },
  ],
};

// ── Import HH after mocks are registered ─────────────────────────────────────

const { HH, createHH } = await import("./index.ts");

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Clear accumulated mock task state between tests
  for (const key of Object.keys(mockTasks)) {
    delete mockTasks[key];
  }
  vi.clearAllMocks();
});

describe("HH constructor", () => {
  it("accepts injected config — no disk read", async () => {
    const cf = new Cofounder({ config: BASE_CONFIG });
    const cfg = await cf.config();
    expect(cfg.this_node.name).toBe("calcifer");
    expect(cfg.peer_node.name).toBe("glados");
  });

  it("createHH factory produces an HH instance", async () => {
    const cf = createCofounder({ config: BASE_CONFIG });
    expect(cf).toBeInstanceOf(Cofounder);
    const cfg = await cf.config();
    expect(cfg).toEqual(BASE_CONFIG);
  });

  it("throws if config file is missing and no config injected", async () => {
    const { loadConfig } = await import("./config.ts");
    vi.mocked(loadConfig).mockResolvedValueOnce(null);
    const cf = new Cofounder({ configPath: "/nonexistent/cofounder.json" });
    await expect(cf.config()).rejects.toThrow("cofounder config not found");
  });
});

describe("HH.peers()", () => {
  it("returns primary peer with primary=true", async () => {
    const cf = new Cofounder({ config: BASE_CONFIG });
    const peers = await cf.peers();
    expect(peers).toHaveLength(1);
    expect(peers[0].name).toBe("glados");
    expect(peers[0].primary).toBe(true);
  });

  it("includes additional peer_nodes with primary=false", async () => {
    const cf = new Cofounder({ config: MULTI_PEER_CONFIG });
    const peers = await cf.peers();
    expect(peers).toHaveLength(2);
    const jarvis = peers.find((p) => p.name === "jarvis");
    expect(jarvis).toBeDefined();
    expect(jarvis!.primary).toBe(false);
    expect(jarvis!.os).toBe("linux");
  });

  it("includes gateway_port and tailscale_ip", async () => {
    const cf = new Cofounder({ config: BASE_CONFIG });
    const [glados] = await cf.peers();
    expect(glados.tailscale_ip).toBe("100.9.8.7");
    expect(glados.gateway_port).toBe(18789);
  });
});

describe("HH.ping()", () => {
  it("returns reachable=true when pingPeer resolves true", async () => {
    const { pingPeer } = await import("@cofounder/core");
    vi.mocked(pingPeer).mockResolvedValueOnce(true);

    const cf = new Cofounder({ config: BASE_CONFIG });
    const result = await cf.ping();
    expect(result.peer).toBe("glados");
    expect(result.reachable).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("returns reachable=false when pingPeer resolves false", async () => {
    const { pingPeer } = await import("@cofounder/core");
    vi.mocked(pingPeer).mockResolvedValueOnce(false);

    const cf = new Cofounder({ config: BASE_CONFIG });
    const result = await cf.ping();
    expect(result.reachable).toBe(false);
    expect(result.latencyMs).toBeUndefined();
  });

  it("targets named peer when opts.peer is set", async () => {
    const { pingPeer } = await import("@cofounder/core");
    vi.mocked(pingPeer).mockResolvedValueOnce(true);

    const cf = new Cofounder({ config: MULTI_PEER_CONFIG });
    const result = await cf.ping({ peer: "jarvis" });
    expect(result.peer).toBe("jarvis");
    expect(vi.mocked(pingPeer)).toHaveBeenCalledWith("100.5.5.5", expect.any(Number));
  });

  it("throws when named peer does not exist", async () => {
    const cf = new Cofounder({ config: BASE_CONFIG });
    await expect(cf.ping({ peer: "nobody" })).rejects.toThrow('Peer "nobody" not found');
  });
});

describe("HH.status()", () => {
  it("returns online=true and gatewayHealthy=true when both checks pass", async () => {
    const { pingPeer, checkGatewayHealth } = await import("@cofounder/core");
    vi.mocked(pingPeer).mockResolvedValueOnce(true);
    vi.mocked(checkGatewayHealth).mockResolvedValueOnce(true);

    const cf = new Cofounder({ config: BASE_CONFIG });
    const result = await cofounder.status();
    expect(result.online).toBe(true);
    expect(result.gatewayHealthy).toBe(true);
    expect(result.peer.name).toBe("glados");
  });

  it("returns gatewayHealthy=false when peer is offline", async () => {
    const { pingPeer, checkGatewayHealth } = await import("@cofounder/core");
    vi.mocked(pingPeer).mockResolvedValueOnce(false);

    const cf = new Cofounder({ config: BASE_CONFIG });
    const result = await cofounder.status();
    expect(result.online).toBe(false);
    expect(result.gatewayHealthy).toBe(false);
    // Should NOT attempt health check when peer is unreachable
    expect(vi.mocked(checkGatewayHealth)).not.toHaveBeenCalled();
  });

  it("returns latencyMs only when peer is reachable", async () => {
    const { pingPeer } = await import("@cofounder/core");
    vi.mocked(pingPeer).mockResolvedValueOnce(false);

    const cf = new Cofounder({ config: BASE_CONFIG });
    const result = await cofounder.status();
    expect(result.latencyMs).toBeUndefined();
  });

  it("targets named peer", async () => {
    const { pingPeer, checkGatewayHealth } = await import("@cofounder/core");
    vi.mocked(pingPeer).mockResolvedValueOnce(true);
    vi.mocked(checkGatewayHealth).mockResolvedValueOnce(true);

    const cf = new Cofounder({ config: MULTI_PEER_CONFIG });
    const result = await cofounder.status({ peer: "jarvis" });
    expect(result.peer.name).toBe("jarvis");
    expect(vi.mocked(pingPeer)).toHaveBeenCalledWith("100.5.5.5", 5000);
  });
});

describe("HH.send() — fire-and-forget", () => {
  it("returns task id and pending status", async () => {
    const cf = new Cofounder({ config: BASE_CONFIG });
    const result = await cofounder.send("Run benchmark suite");
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.peer).toBe("glados");
    expect(result.status).toBe("pending");
  });

  it("calls wakeAgent with correct ws URL and token", async () => {
    const { wakeAgent } = await import("@cofounder/core");
    const cf = new Cofounder({ config: BASE_CONFIG });
    await cofounder.send("Do stuff");
    expect(vi.mocked(wakeAgent)).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "ws://100.9.8.7:18789",
        token: "tok-abc123",
        mode: "now",
      }),
    );
  });

  it("includes task text in the wake message", async () => {
    const { wakeAgent } = await import("@cofounder/core");
    const cf = new Cofounder({ config: BASE_CONFIG });
    await cofounder.send("Render 4K scene");
    const callArgs = vi.mocked(wakeAgent).mock.calls[0][0];
    expect(callArgs.text).toContain("Render 4K scene");
  });

  it("creates a task state entry locally", async () => {
    const { createTaskState } = await import("./state.ts");
    const cf = new Cofounder({ config: BASE_CONFIG });
    await cofounder.send("Train LoRA");
    expect(vi.mocked(createTaskState)).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "calcifer",
        to: "glados",
        objective: "Train LoRA",
      }),
      undefined, // no stateDirOverride
    );
  });

  it("routes to named peer when opts.peer is set", async () => {
    const { wakeAgent } = await import("@cofounder/core");
    const cf = new Cofounder({ config: MULTI_PEER_CONFIG });
    await cofounder.send("Quick job", { peer: "jarvis" });
    expect(vi.mocked(wakeAgent)).toHaveBeenCalledWith(
      expect.objectContaining({ url: "ws://100.5.5.5:18790", token: "tok-jarvis" }),
    );
  });

  it("throws if wakeAgent fails", async () => {
    const { wakeAgent } = await import("@cofounder/core");
    vi.mocked(wakeAgent).mockResolvedValueOnce({ ok: false, error: "connection refused" });
    const cf = new Cofounder({ config: BASE_CONFIG });
    await expect(cofounder.send("Task")).rejects.toThrow("connection refused");
  });

  it("includes routingHint in wake text when provided", async () => {
    const { wakeAgent } = await import("@cofounder/core");
    const cf = new Cofounder({ config: BASE_CONFIG });
    await cofounder.send("Heavy job", { routingHint: "gpu" });
    const callArgs = vi.mocked(wakeAgent).mock.calls[0][0];
    expect(callArgs.text).toContain("gpu");
  });
});

describe("HH.send() — wait:true (webhook path)", () => {
  it("returns completed result from webhook payload", async () => {
    const cf = new Cofounder({ config: BASE_CONFIG });
    const result = await cofounder.send("Run inference", { wait: true });
    expect(result.status).toBe("completed");
    expect(result.output).toBe("42");
    expect(result.success).toBe(true);
    expect(result.tokensUsed).toBe(150);
    expect(result.costUsd).toBe(0.0003);
  });

  it("includes webhook URL in the wake message", async () => {
    const { wakeAgent } = await import("@cofounder/core");
    const cf = new Cofounder({ config: BASE_CONFIG });
    await cofounder.send("Task", { wait: true });
    const callArgs = vi.mocked(wakeAgent).mock.calls[0][0];
    expect(callArgs.text).toContain("webhook=http://100.1.2.3:39999/result");
  });

  it("starts stream server when onChunk is provided", async () => {
    const { startStreamServer } = await import("@cofounder/core");
    const cf = new Cofounder({ config: BASE_CONFIG });
    const chunks: string[] = [];
    await cofounder.send("Task", { wait: true, onChunk: (c) => chunks.push(c) });
    expect(vi.mocked(startStreamServer)).toHaveBeenCalled();
  });

  it("falls back to polling when startResultServer fails", async () => {
    const { startResultServer } = await import("@cofounder/core");
    const { pollTaskCompletion } = await import("./state.ts");
    vi.mocked(startResultServer).mockRejectedValueOnce(new Error("port in use"));

    const cf = new Cofounder({ config: BASE_CONFIG });
    const result = await cofounder.send("Task", { wait: true });
    // Polling fallback should have been used
    expect(vi.mocked(pollTaskCompletion)).toHaveBeenCalled();
    expect(result.status).toBe("completed");
  });

  it("throws on timeout when polling path times out", async () => {
    const { startResultServer } = await import("@cofounder/core");
    const { pollTaskCompletion } = await import("./state.ts");
    vi.mocked(startResultServer).mockRejectedValueOnce(new Error("unavailable"));
    vi.mocked(pollTaskCompletion).mockResolvedValueOnce(null);

    const cf = new Cofounder({ config: BASE_CONFIG });
    await expect(cofounder.send("Task", { wait: true, timeoutMs: 100 })).rejects.toThrow("timed out");
  });
});

describe("HH.tasks()", () => {
  it("returns empty array when no tasks exist", async () => {
    const cf = new Cofounder({ config: BASE_CONFIG });
    const tasks = await cf.tasks();
    expect(tasks).toEqual([]);
  });

  it("returns tasks after sends", async () => {
    const cf = new Cofounder({ config: BASE_CONFIG });
    await cofounder.send("Task A");
    await cofounder.send("Task B");
    const tasks = await cf.tasks();
    expect(tasks).toHaveLength(2);
    const objectives = tasks.map((t) => t.objective);
    expect(objectives).toContain("Task A");
    expect(objectives).toContain("Task B");
  });

  it("filters by status", async () => {
    const { listTaskStates } = await import("./state.ts");
    vi.mocked(listTaskStates).mockResolvedValueOnce([
      { ...makeMockState("id-1", "calcifer", "glados", "job 1"), status: "completed", result: null },
      { ...makeMockState("id-2", "calcifer", "glados", "job 2"), status: "failed", result: null },
      { ...makeMockState("id-3", "calcifer", "glados", "job 3"), status: "pending", result: null },
    ]);

    const cf = new Cofounder({ config: BASE_CONFIG });
    const completed = await cf.tasks({ status: "completed" });
    expect(completed).toHaveLength(1);
    expect(completed[0].objective).toBe("job 1");
  });

  it("filters by multiple statuses", async () => {
    const { listTaskStates } = await import("./state.ts");
    vi.mocked(listTaskStates).mockResolvedValueOnce([
      { ...makeMockState("id-1", "calcifer", "glados", "job 1"), status: "completed", result: null },
      { ...makeMockState("id-2", "calcifer", "glados", "job 2"), status: "failed", result: null },
      { ...makeMockState("id-3", "calcifer", "glados", "job 3"), status: "pending", result: null },
    ]);

    const cf = new Cofounder({ config: BASE_CONFIG });
    const terminal = await cf.tasks({ status: ["completed", "failed"] });
    expect(terminal).toHaveLength(2);
  });

  it("filters by peer name", async () => {
    const { listTaskStates } = await import("./state.ts");
    vi.mocked(listTaskStates).mockResolvedValueOnce([
      { ...makeMockState("id-1", "calcifer", "glados", "job 1"), status: "completed", result: null },
      { ...makeMockState("id-2", "calcifer", "jarvis", "job 2"), status: "completed", result: null },
    ]);

    const cf = new Cofounder({ config: BASE_CONFIG });
    const gladosTasks = await cf.tasks({ peer: "glados" });
    expect(gladosTasks).toHaveLength(1);
    expect(gladosTasks[0].to).toBe("glados");
  });

  it("respects limit", async () => {
    const { listTaskStates } = await import("./state.ts");
    vi.mocked(listTaskStates).mockResolvedValueOnce(
      Array.from({ length: 100 }, (_, i) => ({
        ...makeMockState(`id-${i}`, "calcifer", "glados", `job ${i}`),
        status: "completed" as const,
        result: null,
      })),
    );

    const cf = new Cofounder({ config: BASE_CONFIG });
    const tasks = await cf.tasks({ limit: 5 });
    expect(tasks).toHaveLength(5);
  });
});

describe("HH.getTask()", () => {
  it("returns null for unknown task id", async () => {
    const cf = new Cofounder({ config: BASE_CONFIG });
    const task = await cf.getTask("nonexistent-id");
    expect(task).toBeNull();
  });

  it("finds task by exact id", async () => {
    const { loadTaskState } = await import("./state.ts");
    vi.mocked(loadTaskState).mockResolvedValueOnce({
      ...makeMockState("exact-uuid-1234", "calcifer", "glados", "Exact task"),
      status: "completed",
      result: { output: "done", success: true, artifacts: [], tokens_used: 50, duration_ms: 300, cost_usd: 0.0001 },
    });

    const cf = new Cofounder({ config: BASE_CONFIG });
    const task = await cf.getTask("exact-uuid-1234");
    expect(task).not.toBeNull();
    expect(task!.objective).toBe("Exact task");
    expect(task!.output).toBe("done");
  });

  it("finds task by id prefix", async () => {
    const { loadTaskState, listTaskStates } = await import("./state.ts");
    // Exact lookup returns null (no full match)
    vi.mocked(loadTaskState).mockResolvedValueOnce(null);
    // Prefix search finds it
    vi.mocked(listTaskStates).mockResolvedValueOnce([
      { ...makeMockState("abcd-1234-efgh", "calcifer", "glados", "Prefix task"), status: "completed", result: null },
    ]);

    const cf = new Cofounder({ config: BASE_CONFIG });
    const task = await cf.getTask("abcd");
    expect(task).not.toBeNull();
    expect(task!.id).toBe("abcd-1234-efgh");
  });
});

describe("HH.waitFor()", () => {
  it("returns final task state after polling", async () => {
    const { pollTaskCompletion } = await import("./state.ts");
    vi.mocked(pollTaskCompletion).mockResolvedValueOnce({
      ...makeMockState("poll-task-1", "calcifer", "glados", "Polled task"),
      status: "completed",
      result: { output: "result here", success: true, artifacts: [], tokens_used: 200, duration_ms: 1200, cost_usd: 0.0004 },
    });

    const cf = new Cofounder({ config: BASE_CONFIG });
    const task = await cf.waitFor("poll-task-1");
    expect(task).not.toBeNull();
    expect(task!.status).toBe("completed");
    expect(task!.output).toBe("result here");
  });

  it("returns null if task not found or timed out", async () => {
    const { pollTaskCompletion } = await import("./state.ts");
    vi.mocked(pollTaskCompletion).mockResolvedValueOnce(null);

    const cf = new Cofounder({ config: BASE_CONFIG });
    const task = await cf.waitFor("missing-id");
    expect(task).toBeNull();
  });
});
