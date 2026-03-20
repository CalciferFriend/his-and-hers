/**
 * chat.test.ts — unit tests for `cofounder chat` interactive multi-turn session
 *
 * Strategy: mock readline, wakeAgent, pingPeer, checkGatewayHealth,
 * startResultServer, startStreamServer, and all state/context functions.
 * Test happy path, polling fallback, WOL wake, gateway down, timeout,
 * exit keywords, .context/.clear commands, --no-context flag, context carry-over,
 * session summary output, turn failure recovery.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EventEmitter } from "node:events";

// ─── Hoist mock fns so they're available before module evaluation ────────────

const {
  mockLoadConfig,
  mockGetPeer,
  mockWakeAgent,
  mockPingPeer,
  mockCheckGatewayHealth,
  mockStartResultServer,
  mockStartStreamServer,
  mockCreateTaskState,
  mockUpdateTaskState,
  mockLoadTaskState,
  mockLoadContextSummary,
  mockAppendContextEntry,
  mockBuildContextSummary,
  mockWakeAndWait,
  mockCreateTaskMessage,
  mockReadlineInterface,
} = vi.hoisted(() => ({
  mockLoadConfig: vi.fn(),
  mockGetPeer: vi.fn(),
  mockWakeAgent: vi.fn(),
  mockPingPeer: vi.fn(),
  mockCheckGatewayHealth: vi.fn(),
  mockStartResultServer: vi.fn(),
  mockStartStreamServer: vi.fn(),
  mockCreateTaskState: vi.fn(),
  mockUpdateTaskState: vi.fn(),
  mockLoadTaskState: vi.fn(),
  mockLoadContextSummary: vi.fn(),
  mockAppendContextEntry: vi.fn(),
  mockBuildContextSummary: vi.fn(),
  mockWakeAndWait: vi.fn(),
  mockCreateTaskMessage: vi.fn(),
  mockReadlineInterface: vi.fn(),
}));

vi.mock("../config/store.ts", () => ({ loadConfig: mockLoadConfig }));
vi.mock("../peers/select.ts", () => ({ getPeer: mockGetPeer }));
vi.mock("@cofounder/core", () => ({
  wakeAgent: mockWakeAgent,
  pingPeer: mockPingPeer,
  checkGatewayHealth: mockCheckGatewayHealth,
  startResultServer: mockStartResultServer,
  startStreamServer: mockStartStreamServer,
  createTaskMessage: mockCreateTaskMessage,
  wakeAndWait: mockWakeAndWait,
}));
vi.mock("@cofounder/core/context/store", () => ({
  loadContextSummary: mockLoadContextSummary,
  appendContextEntry: mockAppendContextEntry,
  buildContextSummary: mockBuildContextSummary,
}));
vi.mock("../state/tasks.ts", () => ({
  createTaskState: mockCreateTaskState,
  updateTaskState: mockUpdateTaskState,
  loadTaskState: mockLoadTaskState,
}));

// Mock readline
vi.mock("node:readline/promises", () => ({
  createInterface: mockReadlineInterface,
}));

// Suppress console output in tests
const origLog = console.log;
const origWrite = process.stdout.write;
const origExit = process.exit;

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CONFIG = {
  this_node: { name: "calcifer", emoji: "🔥" },
  peer_node: { name: "glados", emoji: "🤖" },
};

const PEER = {
  name: "glados",
  emoji: "🤖",
  tailscale_ip: "100.64.1.2",
  gateway_port: 18789,
  gateway_token: "test-token",
  wol: { mac: "00:11:22:33:44:55" },
};

const TASK_MESSAGE = {
  id: "task-abc123",
  from: "calcifer",
  to: "glados",
  task: "hello world",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeReadlineInterface(responses: string[]): EventEmitter & {
  question: (q: string) => Promise<string>;
  close: () => void;
  on: (event: string, cb: () => void) => void;
} {
  let callCount = 0;
  const emitter = {
    question: vi.fn(async () => {
      if (callCount >= responses.length) {
        throw new Error("readline closed");
      }
      return responses[callCount++];
    }),
    close: vi.fn(),
    on: vi.fn((event: string, cb: () => void) => {
      if (event === "close") {
        // Save callback for manual triggering if needed
      }
    }),
  };
  return emitter as unknown as EventEmitter & typeof emitter;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("cofounder chat — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockResolvedValue(CONFIG);
    mockGetPeer.mockReturnValue(PEER);
    mockCreateTaskMessage.mockReturnValue(TASK_MESSAGE);
    mockCreateTaskState.mockResolvedValue({});
    mockUpdateTaskState.mockResolvedValue({});
    mockLoadTaskState.mockResolvedValue(null);
    mockLoadContextSummary.mockResolvedValue(null);
    mockAppendContextEntry.mockResolvedValue(undefined);
    mockBuildContextSummary.mockReturnValue("Task: hello\nResult: world");
    mockPingPeer.mockResolvedValue(true);
    mockCheckGatewayHealth.mockResolvedValue(true);
    mockWakeAgent.mockResolvedValue({ ok: true });
    mockStartResultServer.mockResolvedValue({
      url: "http://test-webhook",
      waitForResult: vi.fn(async () => ({
        output: "world",
        tokens_used: 100,
        cost_usd: 0.01,
        context_summary: null,
        artifacts: [],
      })),
    });
    mockStartStreamServer.mockResolvedValue({
      url: "http://test-stream",
      token: "stream-token",
      onChunk: vi.fn(),
      close: vi.fn(),
    });
    console.log = vi.fn();
    process.stdout.write = vi.fn(() => true);
    process.exit = vi.fn() as never;
  });

  afterEach(() => {
    console.log = origLog;
    process.stdout.write = origWrite;
    process.exit = origExit;
  });

  it("completes single turn with webhook result", async () => {
    const rl = makeReadlineInterface(["hello world", "exit"]);
    mockReadlineInterface.mockReturnValue(rl);

    const { chat } = await import("./chat.ts");
    await chat({});

    expect(mockWakeAgent).toHaveBeenCalledOnce();
    expect(mockCreateTaskState).toHaveBeenCalledOnce();
    expect(mockUpdateTaskState).toHaveBeenCalledWith("task-abc123", { status: "running" });
    expect(mockUpdateTaskState).toHaveBeenCalledWith(
      "task-abc123",
      expect.objectContaining({ status: "completed" }),
    );
    expect(rl.close).toHaveBeenCalled();
  });

  it("exits on 'exit' keyword", async () => {
    const rl = makeReadlineInterface(["exit"]);
    mockReadlineInterface.mockReturnValue(rl);

    const { chat } = await import("./chat.ts");
    await chat({});

    expect(mockWakeAgent).not.toHaveBeenCalled();
    expect(rl.close).toHaveBeenCalled();
  });

  it("exits on '.q' keyword", async () => {
    const rl = makeReadlineInterface([".q"]);
    mockReadlineInterface.mockReturnValue(rl);

    const { chat } = await import("./chat.ts");
    await chat({});

    expect(mockWakeAgent).not.toHaveBeenCalled();
    expect(rl.close).toHaveBeenCalled();
  });

  it("exits on 'quit' keyword", async () => {
    const rl = makeReadlineInterface(["quit"]);
    mockReadlineInterface.mockReturnValue(rl);

    const { chat } = await import("./chat.ts");
    await chat({});

    expect(mockWakeAgent).not.toHaveBeenCalled();
  });
});

describe("cofounder chat — .context and .clear commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockResolvedValue(CONFIG);
    mockGetPeer.mockReturnValue(PEER);
    mockCreateTaskMessage.mockReturnValue(TASK_MESSAGE);
    mockLoadContextSummary.mockResolvedValue("[1] Prior task summary");
    mockAppendContextEntry.mockResolvedValue(undefined);
    mockBuildContextSummary.mockReturnValue("Task: hello\nResult: world");
    mockPingPeer.mockResolvedValue(true);
    mockCheckGatewayHealth.mockResolvedValue(true);
    mockWakeAgent.mockResolvedValue({ ok: true });
    mockCreateTaskState.mockResolvedValue({});
    mockUpdateTaskState.mockResolvedValue({});
    mockStartResultServer.mockResolvedValue({
      url: "http://test-webhook",
      waitForResult: vi.fn(async () => ({
        output: "world",
        tokens_used: 100,
        cost_usd: 0.01,
        context_summary: null,
        artifacts: [],
      })),
    });
    mockStartStreamServer.mockResolvedValue({
      url: "http://test-stream",
      token: "stream-token",
      onChunk: vi.fn(),
      close: vi.fn(),
    });
    console.log = vi.fn();
    process.stdout.write = vi.fn(() => true);
    process.exit = vi.fn() as never;
  });

  afterEach(() => {
    console.log = origLog;
    process.stdout.write = origWrite;
    process.exit = origExit;
  });

  it("shows stored context with .context command", async () => {
    const rl = makeReadlineInterface([".context", "exit"]);
    mockReadlineInterface.mockReturnValue(rl);

    const { chat } = await import("./chat.ts");
    await chat({});

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("[1] Prior task summary"),
    );
    expect(mockWakeAgent).not.toHaveBeenCalled();
  });

  it("shows 'No context yet' when context is empty after .clear", async () => {
    mockLoadContextSummary.mockResolvedValue(null);
    const rl = makeReadlineInterface([".context", "exit"]);
    mockReadlineInterface.mockReturnValue(rl);

    const { chat } = await import("./chat.ts");
    await chat({});

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("No context yet"));
  });

  it("clears context with .clear command", async () => {
    const rl = makeReadlineInterface([".clear", "exit"]);
    mockReadlineInterface.mockReturnValue(rl);

    const { chat } = await import("./chat.ts");
    await chat({});

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Context cleared"),
    );
  });

  it("clears context with /clear command", async () => {
    const rl = makeReadlineInterface(["/clear", "exit"]);
    mockReadlineInterface.mockReturnValue(rl);

    const { chat } = await import("./chat.ts");
    await chat({});

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Context cleared"),
    );
  });
});

describe("cofounder chat — polling fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockResolvedValue(CONFIG);
    mockGetPeer.mockReturnValue({ ...PEER, gateway_token: null });
    mockCreateTaskMessage.mockReturnValue(TASK_MESSAGE);
    mockLoadContextSummary.mockResolvedValue(null);
    mockAppendContextEntry.mockResolvedValue(undefined);
    mockBuildContextSummary.mockReturnValue("Task: hello\nResult: world");
    mockPingPeer.mockResolvedValue(true);
    mockCheckGatewayHealth.mockResolvedValue(true);
    mockWakeAgent.mockResolvedValue({ ok: true });
    mockCreateTaskState.mockResolvedValue({});
    mockUpdateTaskState.mockResolvedValue({});
    mockStartResultServer.mockResolvedValue(null);
    mockStartStreamServer.mockResolvedValue(null);
    console.log = vi.fn();
    process.stdout.write = vi.fn(() => true);
    process.exit = vi.fn() as never;
  });

  afterEach(() => {
    console.log = origLog;
    process.stdout.write = origWrite;
    process.exit = origExit;
  });

  it("falls back to polling when no webhook server available", async () => {
    mockLoadTaskState
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        status: "completed",
        result: {
          output: "polled result",
          tokens_used: 50,
          cost_usd: 0.005,
          context_summary: null,
        },
      });

    const rl = makeReadlineInterface(["hello", "exit"]);
    mockReadlineInterface.mockReturnValue(rl);

    const { chat } = await import("./chat.ts");
    await chat({});

    // Wait for polling loop to complete
    await new Promise((r) => setTimeout(r, 3500));

    expect(mockLoadTaskState).toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("polled result"));
  }, 10000);
});

describe("cofounder chat — WOL wake path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockResolvedValue(CONFIG);
    mockGetPeer.mockReturnValue(PEER);
    mockCreateTaskMessage.mockReturnValue(TASK_MESSAGE);
    mockLoadContextSummary.mockResolvedValue(null);
    mockAppendContextEntry.mockResolvedValue(undefined);
    mockBuildContextSummary.mockReturnValue("Task: hello\nResult: world");
    mockPingPeer.mockResolvedValue(false); // peer offline
    mockWakeAndWait.mockResolvedValue(true); // wake succeeds
    mockCheckGatewayHealth.mockResolvedValue(true);
    mockWakeAgent.mockResolvedValue({ ok: true });
    mockCreateTaskState.mockResolvedValue({});
    mockUpdateTaskState.mockResolvedValue({});
    mockStartResultServer.mockResolvedValue({
      url: "http://test-webhook",
      waitForResult: vi.fn(async () => ({
        output: "woke up",
        tokens_used: 100,
        cost_usd: 0.01,
        context_summary: null,
        artifacts: [],
      })),
    });
    mockStartStreamServer.mockResolvedValue({
      url: "http://test-stream",
      token: "stream-token",
      onChunk: vi.fn(),
      close: vi.fn(),
    });
    console.log = vi.fn();
    process.stdout.write = vi.fn(() => true);
  });

  afterEach(() => {
    console.log = origLog;
    process.stdout.write = origWrite;
    mockPingPeer.mockResolvedValue(true); // reset for other tests
  });

  it("sends WOL magic packet when peer unreachable", async () => {
    const rl = makeReadlineInterface(["hello", "exit"]);
    mockReadlineInterface.mockReturnValue(rl);

    const { chat } = await import("./chat.ts");
    await chat({});

    expect(mockPingPeer).toHaveBeenCalled();
    expect(mockWakeAndWait).toHaveBeenCalled();
    expect(mockWakeAgent).toHaveBeenCalled();
  });

  it("fails turn when WOL wake times out", async () => {
    mockWakeAndWait.mockResolvedValue(false); // wake fails

    const rl = makeReadlineInterface(["hello", "exit"]);
    mockReadlineInterface.mockReturnValue(rl);

    const { chat } = await import("./chat.ts");
    await chat({});

    expect(mockWakeAndWait).toHaveBeenCalled();
    expect(mockWakeAgent).not.toHaveBeenCalled();
    expect(mockUpdateTaskState).toHaveBeenCalledWith("task-abc123", { status: "failed" });
  });

  it("fails turn when peer unreachable and no WOL configured", async () => {
    mockGetPeer.mockReturnValue({ ...PEER, wol: null });

    const rl = makeReadlineInterface(["hello", "exit"]);
    mockReadlineInterface.mockReturnValue(rl);

    const { chat } = await import("./chat.ts");
    await chat({});

    expect(mockWakeAndWait).not.toHaveBeenCalled();
    expect(mockWakeAgent).not.toHaveBeenCalled();
    expect(mockUpdateTaskState).toHaveBeenCalledWith("task-abc123", { status: "failed" });
  });
});

describe("cofounder chat — gateway down", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockResolvedValue(CONFIG);
    mockGetPeer.mockReturnValue(PEER);
    mockCreateTaskMessage.mockReturnValue(TASK_MESSAGE);
    mockLoadContextSummary.mockResolvedValue(null);
    mockPingPeer.mockResolvedValue(true);
    mockCheckGatewayHealth.mockResolvedValue(false); // gateway down
    mockCreateTaskState.mockResolvedValue({});
    mockUpdateTaskState.mockResolvedValue({});
    console.log = vi.fn();
    process.stdout.write = vi.fn(() => true);
    process.exit = vi.fn() as never;
  });

  afterEach(() => {
    console.log = origLog;
    process.stdout.write = origWrite;
    process.exit = origExit;
  });

  it("fails turn when gateway is not responding", async () => {
    const rl = makeReadlineInterface(["hello", "exit"]);
    mockReadlineInterface.mockReturnValue(rl);

    const { chat } = await import("./chat.ts");
    await chat({});

    expect(mockCheckGatewayHealth).toHaveBeenCalled();
    expect(mockWakeAgent).not.toHaveBeenCalled();
    expect(mockUpdateTaskState).toHaveBeenCalledWith("task-abc123", { status: "failed" });
  });
});

describe("cofounder chat — send failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockResolvedValue(CONFIG);
    mockGetPeer.mockReturnValue(PEER);
    mockCreateTaskMessage.mockReturnValue(TASK_MESSAGE);
    mockLoadContextSummary.mockResolvedValue(null);
    mockPingPeer.mockResolvedValue(true);
    mockCheckGatewayHealth.mockResolvedValue(true);
    mockWakeAgent.mockResolvedValue({ ok: false, error: "SSH connection failed" });
    mockCreateTaskState.mockResolvedValue({});
    mockUpdateTaskState.mockResolvedValue({});
    console.log = vi.fn();
    process.stdout.write = vi.fn(() => true);
    process.exit = vi.fn() as never;
  });

  afterEach(() => {
    console.log = origLog;
    process.stdout.write = origWrite;
    process.exit = origExit;
  });

  it("reports error and continues when send fails", async () => {
    const rl = makeReadlineInterface(["hello", "exit"]);
    mockReadlineInterface.mockReturnValue(rl);

    const { chat } = await import("./chat.ts");
    await chat({});

    expect(mockWakeAgent).toHaveBeenCalled();
    expect(mockUpdateTaskState).toHaveBeenCalledWith("task-abc123", { status: "failed" });
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Failed to send"),
    );
  });
});

describe("cofounder chat — --no-context flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockResolvedValue(CONFIG);
    mockGetPeer.mockReturnValue(PEER);
    mockCreateTaskMessage.mockReturnValue(TASK_MESSAGE);
    mockLoadContextSummary.mockResolvedValue("[1] Prior context");
    mockAppendContextEntry.mockResolvedValue(undefined);
    mockBuildContextSummary.mockReturnValue("Task: hello\nResult: world");
    mockPingPeer.mockResolvedValue(true);
    mockCheckGatewayHealth.mockResolvedValue(true);
    mockWakeAgent.mockResolvedValue({ ok: true });
    mockCreateTaskState.mockResolvedValue({});
    mockUpdateTaskState.mockResolvedValue({});
    mockStartResultServer.mockResolvedValue({
      url: "http://test-webhook",
      waitForResult: vi.fn(async () => ({
        output: "world",
        tokens_used: 100,
        cost_usd: 0.01,
        context_summary: null,
        artifacts: [],
      })),
    });
    mockStartStreamServer.mockResolvedValue({
      url: "http://test-stream",
      token: "stream-token",
      onChunk: vi.fn(),
      close: vi.fn(),
    });
    console.log = vi.fn();
    process.stdout.write = vi.fn(() => true);
    process.exit = vi.fn() as never;
  });

  afterEach(() => {
    console.log = origLog;
    process.stdout.write = origWrite;
    process.exit = origExit;
  });

  it("skips loadContextSummary when --no-context is set", async () => {
    const rl = makeReadlineInterface(["hello", "exit"]);
    mockReadlineInterface.mockReturnValue(rl);

    const { chat } = await import("./chat.ts");
    await chat({ noContext: true });

    expect(mockLoadContextSummary).not.toHaveBeenCalled();
    expect(mockAppendContextEntry).not.toHaveBeenCalled();
  });
});

describe("cofounder chat — context carry-over", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockResolvedValue(CONFIG);
    mockGetPeer.mockReturnValue(PEER);
    let taskId = 0;
    mockCreateTaskMessage.mockImplementation(() => ({
      id: `task-${++taskId}`,
      from: "calcifer",
      to: "glados",
      task: "hello",
    }));
    mockLoadContextSummary.mockResolvedValue(null);
    mockAppendContextEntry.mockResolvedValue(undefined);
    mockBuildContextSummary.mockReturnValue("Task: hello\nResult: world");
    mockPingPeer.mockResolvedValue(true);
    mockCheckGatewayHealth.mockResolvedValue(true);
    mockWakeAgent.mockResolvedValue({ ok: true });
    mockCreateTaskState.mockResolvedValue({});
    mockUpdateTaskState.mockResolvedValue({});
    mockStartResultServer.mockResolvedValue({
      url: "http://test-webhook",
      waitForResult: vi.fn(async () => ({
        output: "world",
        tokens_used: 100,
        cost_usd: 0.01,
        context_summary: "Custom H2 context",
        artifacts: [],
      })),
    });
    mockStartStreamServer.mockResolvedValue({
      url: "http://test-stream",
      token: "stream-token",
      onChunk: vi.fn(),
      close: vi.fn(),
    });
    console.log = vi.fn();
    process.stdout.write = vi.fn(() => true);
    process.exit = vi.fn() as never;
  });

  afterEach(() => {
    console.log = origLog;
    process.stdout.write = origWrite;
    process.exit = origExit;
  });

  it("carries H2's context_summary forward to turn 2", async () => {
    const rl = makeReadlineInterface(["turn 1", "turn 2", "exit"]);
    mockReadlineInterface.mockReturnValue(rl);

    const { chat } = await import("./chat.ts");
    await chat({});

    // First turn: no context
    const firstCall = mockCreateTaskMessage.mock.calls[0];
    expect(firstCall[3]?.context_summary).toBeUndefined();

    // Second turn: should have H2's context
    const secondCall = mockCreateTaskMessage.mock.calls[1];
    expect(secondCall[3]?.context_summary).toBe("Custom H2 context");
  });

  it("persists context entry after each turn", async () => {
    const rl = makeReadlineInterface(["hello", "exit"]);
    mockReadlineInterface.mockReturnValue(rl);

    const { chat } = await import("./chat.ts");
    await chat({});

    expect(mockAppendContextEntry).toHaveBeenCalledWith(
      "glados",
      expect.objectContaining({ summary: "Custom H2 context" }),
    );
  });
});

describe("cofounder chat — --peer option", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockResolvedValue(CONFIG);
    mockGetPeer.mockReturnValue(PEER);
    mockCreateTaskMessage.mockReturnValue(TASK_MESSAGE);
    mockLoadContextSummary.mockResolvedValue(null);
    mockPingPeer.mockResolvedValue(true);
    mockCheckGatewayHealth.mockResolvedValue(true);
    mockWakeAgent.mockResolvedValue({ ok: true });
    mockCreateTaskState.mockResolvedValue({});
    mockUpdateTaskState.mockResolvedValue({});
    mockStartResultServer.mockResolvedValue({
      url: "http://test-webhook",
      waitForResult: vi.fn(async () => ({
        output: "world",
        tokens_used: 100,
        cost_usd: 0.01,
        context_summary: null,
        artifacts: [],
      })),
    });
    mockStartStreamServer.mockResolvedValue({
      url: "http://test-stream",
      token: "stream-token",
      onChunk: vi.fn(),
      close: vi.fn(),
    });
    console.log = vi.fn();
    process.stdout.write = vi.fn(() => true);
    process.exit = vi.fn() as never;
  });

  afterEach(() => {
    console.log = origLog;
    process.stdout.write = origWrite;
    process.exit = origExit;
  });

  it("passes --peer option to getPeer", async () => {
    const rl = makeReadlineInterface(["exit"]);
    mockReadlineInterface.mockReturnValue(rl);

    const { chat } = await import("./chat.ts");
    await chat({ peer: "custom-peer" });

    expect(mockGetPeer).toHaveBeenCalledWith(CONFIG, "custom-peer");
  });
});

describe("cofounder chat — session summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockResolvedValue(CONFIG);
    mockGetPeer.mockReturnValue(PEER);
    let taskId = 0;
    mockCreateTaskMessage.mockImplementation(() => ({
      id: `task-${++taskId}`,
      from: "calcifer",
      to: "glados",
      task: "hello",
    }));
    mockLoadContextSummary.mockResolvedValue(null);
    mockAppendContextEntry.mockResolvedValue(undefined);
    mockBuildContextSummary.mockReturnValue("Task: hello\nResult: world");
    mockPingPeer.mockResolvedValue(true);
    mockCheckGatewayHealth.mockResolvedValue(true);
    mockWakeAgent.mockResolvedValue({ ok: true });
    mockCreateTaskState.mockResolvedValue({});
    mockUpdateTaskState.mockResolvedValue({});
    mockStartResultServer.mockResolvedValue({
      url: "http://test-webhook",
      waitForResult: vi.fn(async () => ({
        output: "world",
        tokens_used: 100,
        cost_usd: 0.05,
        context_summary: null,
        artifacts: [],
      })),
    });
    mockStartStreamServer.mockResolvedValue({
      url: "http://test-stream",
      token: "stream-token",
      onChunk: vi.fn(),
      close: vi.fn(),
    });
    console.log = vi.fn();
    process.stdout.write = vi.fn(() => true);
    process.exit = vi.fn() as never;
  });

  afterEach(() => {
    console.log = origLog;
    process.stdout.write = origWrite;
    process.exit = origExit;
  });

  it("prints session summary with accumulated stats when turns > 0", async () => {
    const rl = makeReadlineInterface(["turn 1", "turn 2", "exit"]);
    mockReadlineInterface.mockReturnValue(rl);

    const { chat } = await import("./chat.ts");
    await chat({});

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Session summary"),
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Turns:"),
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("200"), // 2 turns × 100 tokens
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("$0.1000"), // 2 turns × 0.05
    );
  });

  it("prints 'No turns completed' when exiting before any turns", async () => {
    const rl = makeReadlineInterface(["exit"]);
    mockReadlineInterface.mockReturnValue(rl);

    const { chat } = await import("./chat.ts");
    await chat({});

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("No turns completed"),
    );
    expect(console.log).not.toHaveBeenCalledWith(
      expect.stringContaining("Session summary"),
    );
  });
});

describe("cofounder chat — timeout path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockResolvedValue(CONFIG);
    mockGetPeer.mockReturnValue(PEER);
    mockCreateTaskMessage.mockReturnValue(TASK_MESSAGE);
    mockLoadContextSummary.mockResolvedValue(null);
    mockPingPeer.mockResolvedValue(true);
    mockCheckGatewayHealth.mockResolvedValue(true);
    mockWakeAgent.mockResolvedValue({ ok: true });
    mockCreateTaskState.mockResolvedValue({});
    mockUpdateTaskState.mockResolvedValue({});
    mockLoadTaskState.mockResolvedValue(null); // never completes
    mockStartResultServer.mockResolvedValue({
      url: "http://test-webhook",
      waitForResult: vi.fn(async () => null), // timeout
    });
    mockStartStreamServer.mockResolvedValue({
      url: "http://test-stream",
      token: "stream-token",
      onChunk: vi.fn(),
      close: vi.fn(),
    });
    console.log = vi.fn();
    process.stdout.write = vi.fn(() => true);
    process.exit = vi.fn() as never;
  });

  afterEach(() => {
    console.log = origLog;
    process.stdout.write = origWrite;
    process.exit = origExit;
  });

  it("marks task as timeout when turn times out", async () => {
    const rl = makeReadlineInterface(["hello", "exit"]);
    mockReadlineInterface.mockReturnValue(rl);

    const { chat } = await import("./chat.ts");
    await chat({ timeout: "1" }); // 1 second timeout

    // Wait for polling loop to time out
    await new Promise((r) => setTimeout(r, 1500));

    expect(mockUpdateTaskState).toHaveBeenCalledWith("task-abc123", { status: "timeout" });
  });
});

describe("cofounder chat — turn failure recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockResolvedValue(CONFIG);
    mockGetPeer.mockReturnValue(PEER);
    let taskId = 0;
    mockCreateTaskMessage.mockImplementation(() => ({
      id: `task-${++taskId}`,
      from: "calcifer",
      to: "glados",
      task: "hello",
    }));
    mockLoadContextSummary.mockResolvedValue(null);
    mockAppendContextEntry.mockResolvedValue(undefined);
    mockBuildContextSummary.mockReturnValue("Task: hello\nResult: world");
    mockPingPeer.mockResolvedValue(true);
    mockCheckGatewayHealth.mockResolvedValue(true);
    mockWakeAgent
      .mockResolvedValueOnce({ ok: false, error: "fail" }) // turn 1 fails
      .mockResolvedValueOnce({ ok: true }); // turn 2 succeeds
    mockCreateTaskState.mockResolvedValue({});
    mockUpdateTaskState.mockResolvedValue({});
    mockStartResultServer.mockResolvedValue({
      url: "http://test-webhook",
      waitForResult: vi.fn(async () => ({
        output: "recovered",
        tokens_used: 50,
        cost_usd: 0.005,
        context_summary: null,
        artifacts: [],
      })),
    });
    mockStartStreamServer.mockResolvedValue({
      url: "http://test-stream",
      token: "stream-token",
      onChunk: vi.fn(),
      close: vi.fn(),
    });
    console.log = vi.fn();
    process.stdout.write = vi.fn(() => true);
    process.exit = vi.fn() as never;
  });

  afterEach(() => {
    console.log = origLog;
    process.stdout.write = origWrite;
    process.exit = origExit;
  });

  it("continues after turn failure and shows 'Turn N failed' message", async () => {
    const rl = makeReadlineInterface(["first", "second", "exit"]);
    mockReadlineInterface.mockReturnValue(rl);

    const { chat } = await import("./chat.ts");
    await chat({});

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Turn 1 failed"),
    );
    expect(mockWakeAgent).toHaveBeenCalledTimes(2);
  });
});
