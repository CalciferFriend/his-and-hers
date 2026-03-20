/**
 * commands/ask.test.ts — unit tests for `cofounder ask`
 *
 * Strategy: mock loadConfig, getAllPeers, wakeAgent, pingPeer,
 * checkGatewayHealth, startResultServer, startStreamServer, createTaskState,
 * pollTaskCompletion, and process.exit.
 *
 * Tests cover happy path (streaming + webhook + poll fallbacks), peer
 * selection, error paths (empty question, no config, no peers, bad peer,
 * no gateway token, send failure, timeout), and JSON output mode.
 *
 * Phase 14 — Calcifer ✅ (2026-03-16)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EventEmitter } from "node:events";

// ─── Hoist mock fns ──────────────────────────────────────────────────────────

const {
  mockLoadConfig,
  mockGetAllPeers,
  mockWakeAgent,
  mockPingPeer,
  mockCheckGatewayHealth,
  mockStartResultServer,
  mockStartStreamServer,
  mockCreateTaskState,
  mockPollTaskCompletion,
} = vi.hoisted(() => ({
  mockLoadConfig: vi.fn(),
  mockGetAllPeers: vi.fn(),
  mockWakeAgent: vi.fn(),
  mockPingPeer: vi.fn(),
  mockCheckGatewayHealth: vi.fn(),
  mockStartResultServer: vi.fn(),
  mockStartStreamServer: vi.fn(),
  mockCreateTaskState: vi.fn(),
  mockPollTaskCompletion: vi.fn(),
}));

vi.mock("../config/store.ts", () => ({ loadConfig: mockLoadConfig }));
vi.mock("../peers/select.ts", () => ({ getAllPeers: mockGetAllPeers }));
vi.mock("@cofounder/core", () => ({
  wakeAgent: mockWakeAgent,
  pingPeer: mockPingPeer,
  checkGatewayHealth: mockCheckGatewayHealth,
  startResultServer: mockStartResultServer,
  startStreamServer: mockStartStreamServer,
}));
vi.mock("../state/tasks.ts", () => ({
  createTaskState: mockCreateTaskState,
  pollTaskCompletion: mockPollTaskCompletion,
}));

// Suppress clack/console output
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  note: vi.fn(),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: vi.fn(),
  })),
}));
vi.mock("picocolors", () => ({
  default: {
    bold: (s: string) => s,
    cyan: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
    dim: (s: string) => s,
  },
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CONFIG = {
  this_node: { name: "calcifer" },
};

const PEER = {
  name: "glados",
  tailscale_ip: "100.64.1.2",
  gateway_port: 18789,
  gateway_token: "test-gw-token",
};

/** Build a minimal EventEmitter-style mock for startStreamServer */
function makeStreamHandle(chunks: string[] = [], answer = "") {
  const listeners: Record<string, ((v: unknown) => void)[]> = {};
  const handle = {
    url: "http://localhost:19999/stream/test",
    done: Promise.resolve(),
    close: vi.fn(),
    on: vi.fn((event: string, cb: (v: unknown) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    }),
    emit: (event: string, v: unknown) => {
      (listeners[event] ?? []).forEach((cb) => cb(v));
    },
  };
  // Emit chunks synchronously when .on("chunk") is registered — achieved by
  // resolving `done` after a microtask so the listener is already attached.
  handle.done = new Promise<void>((resolve) => {
    setTimeout(() => {
      for (const chunk of chunks) handle.emit("chunk", chunk);
      resolve();
    }, 0);
  });
  return handle;
}

/** Build a minimal result-server mock */
function makeResultSrv(output: string | null) {
  return {
    url: "http://localhost:19998/result/test",
    result:
      output !== null
        ? Promise.resolve({ task_id: "t1", output })
        : new Promise(() => {}), // never resolves → simulates timeout
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

let exitSpy: ReturnType<typeof vi.spyOn>;
let consoleLogSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();

  exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
    throw new Error("process.exit");
  }) as never);

  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  // Default happy-path mocks
  mockLoadConfig.mockResolvedValue(CONFIG);
  mockGetAllPeers.mockReturnValue([PEER]);
  mockPingPeer.mockResolvedValue(true);
  mockCheckGatewayHealth.mockResolvedValue(true);
  mockCreateTaskState.mockResolvedValue(undefined);
  mockPollTaskCompletion.mockResolvedValue(null);

  const streamHandle = makeStreamHandle(["Hello ", "world"], "Hello world");
  mockStartStreamServer.mockResolvedValue(streamHandle);
  mockStartResultServer.mockResolvedValue(makeResultSrv("Hello world"));
  mockWakeAgent.mockResolvedValue({ ok: true });
});

afterEach(() => {
  exitSpy.mockRestore();
  consoleLogSpy.mockRestore();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

import { ask, buildAskText } from "./ask.ts";

// ── buildAskText ─────────────────────────────────────────────────────────────

describe("buildAskText", () => {
  it("includes the CofounderMessage:ask prefix", () => {
    const text = buildAskText("calcifer", "ask-1234", "what time is it?", null);
    expect(text).toContain("[CofounderMessage:ask from calcifer id=ask-1234]");
    expect(text).toContain("what time is it?");
  });

  it("includes webhook run command when webhookUrl is set", () => {
    const text = buildAskText(
      "calcifer",
      "ask-1234",
      "ping?",
      "http://localhost:9000/result/ask-1234",
    );
    expect(text).toContain("cofounder result ask-1234");
    expect(text).toContain("HH-Result-Webhook:");
  });

  it("includes stream headers when streamUrl and streamToken are provided", () => {
    const text = buildAskText(
      "calcifer",
      "ask-1234",
      "ping?",
      "http://localhost:9000/result/ask-1234",
      "http://localhost:9001/stream/ask-1234",
      "streamtok123",
    );
    expect(text).toContain("HH-Stream-URL:");
    expect(text).toContain("HH-Stream-Token:");
  });

  it("omits stream headers when streamUrl is null", () => {
    const text = buildAskText("calcifer", "ask-1234", "ping?", null, null, null);
    expect(text).not.toContain("HH-Stream-URL:");
  });
});

// ── ask() validation ─────────────────────────────────────────────────────────

describe("ask() — input validation", () => {
  it("exits 1 on empty question", async () => {
    await expect(ask("   ")).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("emits JSON error on empty question with --json", async () => {
    await expect(ask("", { json: true })).rejects.toThrow("process.exit");
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Question cannot be empty"),
    );
  });

  it("exits 1 when config is null", async () => {
    mockLoadConfig.mockResolvedValue(null);
    await expect(ask("hello?")).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits 1 when no peers configured", async () => {
    mockGetAllPeers.mockReturnValue([]);
    await expect(ask("hello?")).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits 1 when specified peer not found", async () => {
    await expect(ask("hello?", { peer: "nobody" })).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits 1 when peer has no gateway_token", async () => {
    mockGetAllPeers.mockReturnValue([{ ...PEER, gateway_token: undefined }]);
    await expect(ask("hello?")).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ── ask() happy path ─────────────────────────────────────────────────────────

describe("ask() — happy path", () => {
  it("completes successfully with streaming answer", async () => {
    await ask("what time is it?");
    expect(mockWakeAgent).toHaveBeenCalledOnce();
    // Should NOT exit with code 1 — exits only on error
    expect(exitSpy).not.toHaveBeenCalledWith(1);
  });

  it("uses first peer by default", async () => {
    const peer2 = { ...PEER, name: "other-peer" };
    mockGetAllPeers.mockReturnValue([PEER, peer2]);
    await ask("ping?");
    const callArg = mockWakeAgent.mock.calls[0][0];
    expect(callArg.url).toContain(PEER.tailscale_ip);
  });

  it("selects named peer when --peer is specified", async () => {
    const peer2 = {
      ...PEER,
      name: "other",
      tailscale_ip: "100.64.1.99",
      gateway_token: "other-tok",
    };
    mockGetAllPeers.mockReturnValue([PEER, peer2]);
    await ask("ping?", { peer: "other" });
    const callArg = mockWakeAgent.mock.calls[0][0];
    expect(callArg.url).toContain("100.64.1.99");
  });

  it("creates a task state before sending", async () => {
    await ask("test question?");
    expect(mockCreateTaskState).toHaveBeenCalledWith(
      expect.objectContaining({ objective: "test question?" }),
    );
  });

  it("starts result server and stream server", async () => {
    await ask("test?");
    expect(mockStartResultServer).toHaveBeenCalledOnce();
    expect(mockStartStreamServer).toHaveBeenCalledOnce();
  });

  it("skips stream server when --no-stream", async () => {
    await ask("test?", { noStream: true });
    expect(mockStartStreamServer).not.toHaveBeenCalled();
  });
});

// ── ask() offline / warn path ─────────────────────────────────────────────────

describe("ask() — offline peer (warn, still sends)", () => {
  it("continues sending when peer is unreachable", async () => {
    mockPingPeer.mockResolvedValue(false);
    mockCheckGatewayHealth.mockResolvedValue(false);
    await ask("are you there?");
    expect(mockWakeAgent).toHaveBeenCalledOnce();
  });
});

// ── ask() send failure ────────────────────────────────────────────────────────

describe("ask() — send failure", () => {
  it("exits 1 when wakeAgent returns ok:false", async () => {
    mockWakeAgent.mockResolvedValue({ ok: false, error: "connection refused" });
    await expect(ask("hello?")).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("emits JSON error when wakeAgent fails with --json", async () => {
    mockWakeAgent.mockResolvedValue({ ok: false, error: "timeout" });
    await expect(ask("hello?", { json: true })).rejects.toThrow("process.exit");
    const printed = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(printed).toContain('"ok":false');
    expect(printed).toContain("timeout");
  });
});

// ── ask() timeout / poll fallback ─────────────────────────────────────────────

describe("ask() — timeout + poll fallback", () => {
  it("falls through to poll when stream and result server both unavailable", async () => {
    // stream returns empty, result server rejects (no port available)
    // → resultDone is null → poll path triggers
    mockStartStreamServer.mockResolvedValue(makeStreamHandle([], ""));
    mockStartResultServer.mockRejectedValue(new Error("port unavailable"));
    mockPollTaskCompletion.mockResolvedValue({
      result: { output: "poll answer" },
    });
    await ask("deep thought?");
    // Should complete without process.exit(1)
    expect(exitSpy).not.toHaveBeenCalledWith(1);
  });

  it("exits 1 on full timeout with no answer", async () => {
    mockStartStreamServer.mockResolvedValue(makeStreamHandle([], ""));
    mockStartResultServer.mockResolvedValue(makeResultSrv(null));
    mockPollTaskCompletion.mockResolvedValue(null);
    await expect(ask("silence?", { timeoutSeconds: 1 })).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ── ask() —json mode ──────────────────────────────────────────────────────────

describe("ask() — JSON output mode", () => {
  it("prints valid JSON with ok:true on success (exits 0)", async () => {
    mockStartStreamServer.mockResolvedValue(makeStreamHandle([], ""));
    mockStartResultServer.mockResolvedValue(makeResultSrv("the answer is 42"));
    // JSON mode always calls process.exit — exit(0) on success
    await expect(ask("what is the answer?", { json: true })).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(0);
    const printed = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
    const parsed = JSON.parse(printed);
    expect(parsed.ok).toBe(true);
    expect(parsed.answer).toBe("the answer is 42");
    expect(parsed.peer).toBe("glados");
  });

  it("prints valid JSON with ok:false on timeout", async () => {
    mockStartStreamServer.mockResolvedValue(makeStreamHandle([], ""));
    mockStartResultServer.mockResolvedValue(makeResultSrv(null));
    mockPollTaskCompletion.mockResolvedValue(null);
    await expect(ask("silence?", { json: true, timeoutSeconds: 1 })).rejects.toThrow(
      "process.exit",
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    const printed = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
    const parsed = JSON.parse(printed);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBeDefined();
  });

  it("includes duration_ms in JSON output (exits 0)", async () => {
    mockStartResultServer.mockResolvedValue(makeResultSrv("fast"));
    mockStartStreamServer.mockResolvedValue(makeStreamHandle([], ""));
    await expect(ask("quick?", { json: true })).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(0);
    const printed = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
    const parsed = JSON.parse(printed);
    expect(typeof parsed.duration_ms).toBe("number");
    expect(parsed.duration_ms).toBeGreaterThanOrEqual(0);
  });
});

// ── ask() startResultServer / startStreamServer failure tolerance ─────────────

describe("ask() — server startup failure tolerance", () => {
  it("continues when startResultServer throws", async () => {
    mockStartResultServer.mockRejectedValue(new Error("port in use"));
    mockStartStreamServer.mockResolvedValue(makeStreamHandle(["answer"], "answer"));
    // Should not throw — server failure is handled gracefully
    await ask("resilient?");
    expect(mockWakeAgent).toHaveBeenCalledOnce();
  });

  it("continues when startStreamServer throws", async () => {
    mockStartStreamServer.mockRejectedValue(new Error("port in use"));
    mockStartResultServer.mockResolvedValue(makeResultSrv("webhook answer"));
    await ask("resilient?");
    expect(mockWakeAgent).toHaveBeenCalledOnce();
  });
});
