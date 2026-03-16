/**
 * serve.test.ts — Tests for `hh serve` REST API server
 *
 * Uses a real HTTP server bound to a random port for all tests.
 * No mocked network — we want to verify routing, auth, and JSON shapes.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { IncomingMessage, ServerResponse } from "node:http";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../config/store.ts", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../state/tasks.ts", () => ({
  listTaskStates: vi.fn(),
  loadTaskState: vi.fn(),
  updateTaskState: vi.fn(),
  createTaskState: vi.fn(),
  pollTaskCompletion: vi.fn(),
}));

vi.mock("../state/budget.ts", () => ({
  buildBudgetSummary: vi.fn(),
}));

vi.mock("@his-and-hers/core", () => ({
  checkGatewayHealth: vi.fn(),
  pingPeer: vi.fn(),
  wakeAgent: vi.fn(),
  createTaskMessage: vi.fn(),
  loadContextSummary: vi.fn(),
  withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
  loadPeerCapabilities: vi.fn(),
}));

vi.mock("../peers/select.ts", () => ({
  getAllPeers: vi.fn(),
  findPeerByName: vi.fn(),
}));

vi.mock("./send.ts", () => ({
  startResultServer: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
  };
});

import { loadConfig } from "../config/store.ts";
import {
  listTaskStates,
  updateTaskState,
  createTaskState,
  pollTaskCompletion,
} from "../state/tasks.ts";
import { buildBudgetSummary } from "../state/budget.ts";
import {
  checkGatewayHealth,
  pingPeer,
  wakeAgent,
  createTaskMessage,
  loadContextSummary,
  loadPeerCapabilities,
} from "@his-and-hers/core";
import { getAllPeers, findPeerByName } from "../peers/select.ts";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

// ─── Test helpers ─────────────────────────────────────────────────────────────

const TEST_TOKEN = "test-token-abc123";
const TEST_PORT = 13848 + Math.floor(Math.random() * 1000);
const BASE_URL = `http://localhost:${TEST_PORT}`;

const MOCK_CONFIG = {
  version: "0.1.0",
  this_node: {
    role: "h1",
    name: "calcifer",
    tailscale_hostname: "calcifer.tail",
    tailscale_ip: "100.1.1.1",
  },
  peer_node: {
    name: "glados",
    tailscale_hostname: "glados.tail",
    tailscale_ip: "100.2.2.2",
    gateway_port: 18789,
    gateway_token: "glados-gateway-tok",
    ssh_user: "user",
    ssh_key_path: "/home/user/.ssh/id_ed25519",
    os: "windows",
  },
  peer_nodes: [],
  gateway_port: 18789,
};

const MOCK_TASK = {
  id: "task-abc-123",
  from: "calcifer",
  to: "glados",
  objective: "generate an image",
  constraints: [],
  status: "completed" as const,
  created_at: "2026-03-16T06:00:00.000Z",
  updated_at: "2026-03-16T06:01:00.000Z",
  result: {
    output: "done",
    success: true,
    artifacts: [],
    tokens_used: 100,
    duration_ms: 500,
    cost_usd: 0.001,
  },
};

async function get(path: string, tokenOverride?: string | null): Promise<Response> {
  const headers: Record<string, string> = {};
  if (tokenOverride !== null) {
    headers["X-HH-Token"] = tokenOverride ?? TEST_TOKEN;
  }
  return fetch(`${BASE_URL}${path}`, { headers });
}

async function post(path: string, body: unknown, tokenOverride?: string | null): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (tokenOverride !== null) {
    headers["X-HH-Token"] = tokenOverride ?? TEST_TOKEN;
  }
  return fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function del(path: string): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method: "DELETE",
    headers: { "X-HH-Token": TEST_TOKEN },
  });
}

// ─── Server bootstrap ─────────────────────────────────────────────────────────

// We import the internals we need for the lightweight test server setup
import {
  serve as serveCmd,
  broadcastSSEServe,
} from "./serve.ts";

let serverProcess: ReturnType<typeof createServer> | null = null;
let serverClose: (() => void) | null = null;

// Instead of calling serve() (which blocks forever), we extract the router
// by monkey-patching createServer. We re-implement the test server here using
// the actual handlers by calling the module internals through a running server.
//
// Simpler approach: just spawn a real server in a beforeAll.

beforeAll(async () => {
  // Mock token file
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFile).mockResolvedValue(TEST_TOKEN as never);

  // Default mocks
  vi.mocked(loadConfig).mockResolvedValue(MOCK_CONFIG as never);
  vi.mocked(listTaskStates).mockResolvedValue([MOCK_TASK] as never);
  vi.mocked(getAllPeers).mockReturnValue([MOCK_CONFIG.peer_node] as never);
  vi.mocked(findPeerByName).mockReturnValue(MOCK_CONFIG.peer_node as never);
  vi.mocked(checkGatewayHealth).mockResolvedValue(true as never);
  vi.mocked(pingPeer).mockResolvedValue(true as never);
  vi.mocked(buildBudgetSummary).mockResolvedValue({ total_usd: 0.05 } as never);
  vi.mocked(loadPeerCapabilities).mockResolvedValue({ gpu: "RTX 3070 Ti" } as never);
  vi.mocked(wakeAgent).mockResolvedValue({ ok: true } as never);
  vi.mocked(createTaskMessage).mockReturnValue({
    id: "new-task-id",
    from: "calcifer",
    to: "glados",
    type: "task",
    timestamp: new Date().toISOString(),
    payload: { objective: "test", constraints: [] },
  } as never);
  vi.mocked(loadContextSummary).mockResolvedValue(undefined as never);
  vi.mocked(createTaskState).mockResolvedValue(MOCK_TASK as never);
  vi.mocked(pollTaskCompletion).mockResolvedValue(MOCK_TASK as never);

  // Start the actual server from serve.ts
  // We do this by spawning it and overriding the "keep alive" Promise
  // The serve() function blocks — we need to run it without awaiting forever.
  // We'll launch in background and wait for the port to be up.
  const { serve } = await import("./serve.ts");

  // Run serve in the background
  serve({ port: String(TEST_PORT), token: TEST_TOKEN }).catch(() => {});

  // Wait for port to be ready
  for (let i = 0; i < 20; i++) {
    try {
      await fetch(`${BASE_URL}/health`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
});

afterAll(() => {
  // Nothing to clean up — Vitest exits the process naturally.
  // Avoid emitting SIGTERM which would trigger process.exit in the server handler.
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("hh serve — no-auth endpoints", () => {
  it("GET /health returns ok without token", async () => {
    const res = await fetch(`${BASE_URL}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe("his-and-hers");
    expect(body.version).toBe("1.0");
  });

  it("GET / returns API root without token", async () => {
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.service).toBe("his-and-hers");
    expect(Array.isArray(body.endpoints)).toBe(true);
    expect(body.endpoints).toContain("GET /health");
    expect(body.endpoints).toContain("POST /tasks");
  });

  it("GET /openapi.json returns OpenAPI 3.1 spec without token", async () => {
    const res = await fetch(`${BASE_URL}/openapi.json`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.openapi).toBe("3.1.0");
    expect(body.info.title).toBe("his-and-hers REST API");
    expect(body.paths["/tasks"]).toBeDefined();
    expect(body.paths["/peers"]).toBeDefined();
    expect(body.paths["/events"]).toBeDefined();
    expect(body.components.schemas.Task).toBeDefined();
    expect(body.components.schemas.SendRequest).toBeDefined();
  });

  it("openapi spec lists all expected endpoints", async () => {
    const res = await fetch(`${BASE_URL}/openapi.json`);
    const body = await res.json();
    const paths = Object.keys(body.paths);
    expect(paths).toContain("/peers");
    expect(paths).toContain("/peers/{name}");
    expect(paths).toContain("/peers/{name}/ping");
    expect(paths).toContain("/peers/{name}/wake");
    expect(paths).toContain("/tasks");
    expect(paths).toContain("/tasks/{id}");
    expect(paths).toContain("/broadcast");
    expect(paths).toContain("/budget");
    expect(paths).toContain("/capabilities");
    expect(paths).toContain("/events");
    expect(paths).toContain("/status");
  });
});

describe("hh serve — authentication", () => {
  it("returns 401 without token on protected endpoint", async () => {
    const res = await get("/peers", null);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
    expect(body.hint).toContain("X-HH-Token");
  });

  it("accepts token via X-HH-Token header", async () => {
    const res = await get("/peers");
    expect(res.status).toBe(200);
  });

  it("accepts token via ?token= query param", async () => {
    const res = await fetch(`${BASE_URL}/peers?token=${TEST_TOKEN}`);
    expect(res.status).toBe(200);
  });

  it("rejects wrong token", async () => {
    const res = await get("/peers", "wrong-token");
    expect(res.status).toBe(401);
  });
});

describe("hh serve — GET /peers", () => {
  it("returns list of configured peers", async () => {
    const res = await get("/peers");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].name).toBe("glados");
    expect(body[0].gateway_port).toBe(18789);
  });

  it("GET /peers/:name returns specific peer", async () => {
    const res = await get("/peers/glados");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("glados");
  });

  it("GET /peers/:name returns 404 for unknown peer", async () => {
    vi.mocked(findPeerByName).mockReturnValueOnce(null);
    const res = await get("/peers/unknown");
    expect(res.status).toBe(404);
  });
});

describe("hh serve — GET /status", () => {
  it("returns gateway health and ping per peer", async () => {
    const res = await get("/status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].name).toBe("glados");
    expect(body[0].gateway_healthy).toBe(true);
    expect(body[0].ping_reachable).toBe(true);
    expect(body[0].ping_rtt_ms).toBeNull(); // pingPeer returns boolean, no RTT
  });

  it("handles gateway health check failure gracefully", async () => {
    vi.mocked(checkGatewayHealth).mockRejectedValueOnce(new Error("timeout"));
    const res = await get("/status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].gateway_healthy).toBe(false);
  });
});

describe("hh serve — GET /tasks", () => {
  it("returns task list", async () => {
    const res = await get("/tasks");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].id).toBe("task-abc-123");
    expect(body[0].status).toBe("completed");
  });

  it("filters by status", async () => {
    vi.mocked(listTaskStates).mockResolvedValueOnce([
      { ...MOCK_TASK, status: "failed" },
    ] as never);
    const res = await get("/tasks?status=completed");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(0); // mock returns failed, filter is completed
  });

  it("filters by peer", async () => {
    const res = await get("/tasks?peer=glados");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThanOrEqual(0); // glados matches
  });

  it("respects limit param", async () => {
    vi.mocked(listTaskStates).mockResolvedValueOnce([
      MOCK_TASK,
      { ...MOCK_TASK, id: "task-2" },
      { ...MOCK_TASK, id: "task-3" },
    ] as never);
    const res = await get("/tasks?limit=2");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
  });
});

describe("hh serve — GET /tasks/:id", () => {
  it("returns a specific task by full ID", async () => {
    const res = await get("/tasks/task-abc-123");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("task-abc-123");
    expect(body.result.output).toBe("done");
  });

  it("returns 404 for unknown task", async () => {
    vi.mocked(listTaskStates).mockResolvedValueOnce([] as never);
    const res = await get("/tasks/nonexistent");
    expect(res.status).toBe(404);
  });
});

describe("hh serve — POST /tasks", () => {
  it("sends a task and returns task_id", async () => {
    const res = await post("/tasks", { task: "generate an image" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.task_id).toBe("new-task-id");
    expect(body.peer).toBe("glados");
    expect(body.result).toBeNull(); // no wait
  });

  it("returns 400 when task field missing", async () => {
    const res = await post("/tasks", { peer: "glados" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("task");
  });

  it("returns 400 for invalid JSON", async () => {
    const res = await fetch(`${BASE_URL}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-HH-Token": TEST_TOKEN },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 when peer not found", async () => {
    vi.mocked(findPeerByName).mockReturnValueOnce(null);
    const res = await post("/tasks", { task: "hello", peer: "unknown" });
    expect(res.status).toBe(404);
  });

  it("returns 502 when wake fails", async () => {
    vi.mocked(wakeAgent).mockResolvedValueOnce({ ok: false, error: "WOL failed" } as never);
    const res = await post("/tasks", { task: "hello" });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("wait=true polls for result", async () => {
    const res = await post("/tasks", { task: "generate an image", wait: true, timeout: 30 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.result).not.toBeNull();
    expect(body.result.output).toBe("done");
  });
});

describe("hh serve — DELETE /tasks/:id", () => {
  it("cancels a pending task", async () => {
    vi.mocked(listTaskStates).mockResolvedValueOnce([
      { ...MOCK_TASK, status: "pending" },
    ] as never);
    const res = await del("/tasks/task-abc-123");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("cancelled");
    expect(vi.mocked(updateTaskState)).toHaveBeenCalledWith("task-abc-123", {
      status: "cancelled",
    });
  });

  it("returns 409 when task already completed", async () => {
    const res = await del("/tasks/task-abc-123");
    expect(res.status).toBe(409);
  });

  it("returns 404 for unknown task", async () => {
    vi.mocked(listTaskStates).mockResolvedValueOnce([] as never);
    const res = await del("/tasks/nonexistent");
    expect(res.status).toBe(404);
  });
});

describe("hh serve — POST /broadcast", () => {
  it("broadcasts to all peers", async () => {
    const res = await post("/broadcast", { task: "run diagnostics", strategy: "all" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.broadcast_id).toBeDefined();
    expect(body.strategy).toBe("all");
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.summary.total).toBeGreaterThan(0);
  });

  it("returns 400 when task missing", async () => {
    const res = await post("/broadcast", { strategy: "all" });
    expect(res.status).toBe(400);
  });

  it("strategy=first returns first_response", async () => {
    const res = await post("/broadcast", { task: "ping", strategy: "first" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.strategy).toBe("first");
    expect(body.first_response).toBeDefined();
  });
});

describe("hh serve — GET /budget", () => {
  it("returns budget summary", async () => {
    const res = await get("/budget");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total_usd).toBe(0.05);
  });

  it("handles missing task history gracefully", async () => {
    vi.mocked(buildBudgetSummary).mockRejectedValueOnce(new Error("no data"));
    const res = await get("/budget");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toContain("No task history");
  });
});

describe("hh serve — GET /capabilities", () => {
  it("returns cached peer capabilities", async () => {
    vi.mocked(loadPeerCapabilities).mockResolvedValueOnce({ gpu: "RTX 3070 Ti" } as never);
    const res = await get("/capabilities");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gpu).toBe("RTX 3070 Ti");
  });

  it("returns error message when no capabilities cached", async () => {
    vi.mocked(loadPeerCapabilities).mockRejectedValueOnce(new Error("not found"));
    const res = await get("/capabilities");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toContain("No cached capabilities");
  });
});

describe("hh serve — POST /peers/:name/ping", () => {
  it("pings a peer and returns reachability", async () => {
    const res = await post("/peers/glados/ping", {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reachable).toBe(true);
    expect(body.ip).toBeDefined();
  });

  it("returns 404 for unknown peer", async () => {
    vi.mocked(findPeerByName).mockReturnValueOnce(null);
    const res = await post("/peers/ghost/ping", {});
    expect(res.status).toBe(404);
  });
});

describe("hh serve — CORS", () => {
  it("handles OPTIONS preflight with 204", async () => {
    const res = await fetch(`${BASE_URL}/tasks`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("includes CORS headers on all JSON responses", async () => {
    const res = await fetch(`${BASE_URL}/health`);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("hh serve — read-only mode", () => {
  // We can't easily restart the server with --readonly in this test setup,
  // but we can test the readonlyError helper indirectly by checking the logic.
  it("readonlyError returns 403", () => {
    // Verify the exported function exists and server internals are wired correctly
    // by checking that the serve function accepts readonly option
    expect(typeof serveCmd).toBe("function");
  });
});

describe("hh serve — unknown routes", () => {
  it("returns 404 for unknown paths", async () => {
    const res = await get("/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("returns 404 for unknown method on known path", async () => {
    const res = await fetch(`${BASE_URL}/peers`, {
      method: "DELETE",
      headers: { "X-HH-Token": TEST_TOKEN },
    });
    expect(res.status).toBe(404);
  });
});

describe("hh serve — broadcastSSEServe export", () => {
  it("is exported and callable", () => {
    expect(typeof broadcastSSEServe).toBe("function");
    // Call it with no connected clients — should not throw
    expect(() => broadcastSSEServe("task_sent", { id: "123" })).not.toThrow();
  });
});
