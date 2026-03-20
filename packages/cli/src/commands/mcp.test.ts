/**
 * commands/mcp.test.ts
 *
 * Unit tests for the MCP stdio server — protocol handling, tool schemas,
 * processMessage dispatch, and error paths.
 *
 * All external I/O (wakeAgent, pingPeer, listTaskStates, etc.) is mocked so
 * these tests run offline with zero side effects.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildToolList,
  handleInitialize,
  handleToolsList,
  handleUnknownMethod,
  processMessage,
  MCP_PROTOCOL_VERSION,
  SERVER_NAME,
  SERVER_VERSION,
  type JsonRpcRequest,
  type McpTool,
} from "./mcp.ts";

// ─── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("../config/store.ts", () => ({
  loadConfig: vi.fn().mockResolvedValue({
    peers: [
      {
        name: "glados",
        tailscale_host: "glados",
        gateway_url: "http://glados:18789",
        gateway_token: "tok",
      },
    ],
    gateway: { url: "http://localhost:18789", token: "tok" },
  }),
}));

vi.mock("@cofounder/core", async (importActual) => {
  const actual = await importActual<typeof import("@cofounder/core")>();
  return {
    ...actual,
    wakeAgent: vi.fn().mockResolvedValue({ ok: true, task_id: "task-abc", message: "queued" }),
    pingPeer: vi.fn().mockResolvedValue({ reachable: true, latencyMs: 12 }),
    checkGatewayHealth: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    wakeAndWait: vi.fn().mockResolvedValue({ ok: true, result: "done", cost_usd: 0.001 }),
    loadPeerCapabilities: vi.fn().mockResolvedValue(null),
  };
});

vi.mock("../state/tasks.ts", () => ({
  createTaskState: vi.fn().mockResolvedValue(undefined),
  listTaskStates: vi.fn().mockResolvedValue([
    {
      id: "task-001-uuid-full",
      to: "glados",
      objective: "summarise report",
      status: "completed",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      result: {
        output: "Here is a summary.",
        cost_usd: 0.0025,
        duration_ms: 4200,
      },
    },
  ]),
  pollTaskCompletion: vi.fn().mockResolvedValue({ status: "completed", result: "done" }),
}));

vi.mock("../peers/select.ts", () => ({
  // getAllPeers is synchronous — takes a config object and returns peers
  getAllPeers: vi.fn().mockReturnValue([
    {
      name: "glados",
      role: "h2",
      emoji: "🤖",
      tailscale_ip: "100.100.0.2",
      tailscale_host: "glados",
      gateway_url: "http://glados:18789",
      gateway_token: "tok",
    },
  ]),
  getPeer: vi.fn().mockResolvedValue({
    name: "glados",
    role: "h2",
    tailscale_ip: "100.100.0.2",
    tailscale_host: "glados",
    gateway_url: "http://glados:18789",
    gateway_token: "tok",
  }),
}));

beforeEach(() => vi.clearAllMocks());

// ─── buildToolList ─────────────────────────────────────────────────────────────

describe("buildToolList()", () => {
  it("returns an array of tools", () => {
    const tools = buildToolList();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThanOrEqual(6);
  });

  it("each tool has name, description, and inputSchema", () => {
    for (const tool of buildToolList()) {
      expect(tool).toHaveProperty("name");
      expect(tool).toHaveProperty("description");
      expect(tool).toHaveProperty("inputSchema");
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  const expectedTools = [
    "hh_send",
    "hh_status",
    "hh_peers",
    "hh_tasks",
    "hh_broadcast",
    "hh_wake",
  ];

  for (const name of expectedTools) {
    it(`includes tool '${name}'`, () => {
      const tools = buildToolList();
      const found = tools.find((t: McpTool) => t.name === name);
      expect(found).toBeDefined();
    });
  }

  it("hh_send requires 'task' field", () => {
    const send = buildToolList().find((t: McpTool) => t.name === "hh_send")!;
    expect(send.inputSchema.required).toContain("task");
  });

  it("hh_broadcast requires 'task' field", () => {
    const bc = buildToolList().find((t: McpTool) => t.name === "hh_broadcast")!;
    expect(bc.inputSchema.required).toContain("task");
  });

  it("hh_tasks status enum includes all valid values", () => {
    const tasks = buildToolList().find((t: McpTool) => t.name === "hh_tasks")!;
    const statusProp = tasks.inputSchema.properties["status"] as { enum: string[] };
    expect(statusProp.enum).toContain("pending");
    expect(statusProp.enum).toContain("completed");
    expect(statusProp.enum).toContain("failed");
  });
});

// ─── handleInitialize ──────────────────────────────────────────────────────────

describe("handleInitialize()", () => {
  it("returns a valid initialize response", () => {
    const resp = handleInitialize(1, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0" },
    });
    expect(resp.jsonrpc).toBe("2.0");
    expect(resp.id).toBe(1);
    expect(resp.result).toBeDefined();
  });

  it("result contains protocolVersion and serverInfo", () => {
    const resp = handleInitialize(42, {});
    const result = resp.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect((result.serverInfo as Record<string, string>).name).toBe(SERVER_NAME);
    expect((result.serverInfo as Record<string, string>).version).toBe(SERVER_VERSION);
  });

  it("result contains capabilities.tools object", () => {
    const resp = handleInitialize("init-1", {});
    const result = resp.result as Record<string, unknown>;
    expect(result.capabilities).toBeDefined();
    expect((result.capabilities as Record<string, unknown>).tools).toBeDefined();
  });

  it("echoes back the id", () => {
    expect(handleInitialize("abc", {}).id).toBe("abc");
    expect(handleInitialize(null, {}).id).toBeNull();
  });
});

// ─── handleToolsList ───────────────────────────────────────────────────────────

describe("handleToolsList()", () => {
  it("returns jsonrpc 2.0 response", () => {
    const resp = handleToolsList(1);
    expect(resp.jsonrpc).toBe("2.0");
    expect(resp.id).toBe(1);
  });

  it("result.tools is an array", () => {
    const result = handleToolsList(1).result as { tools: McpTool[] };
    expect(Array.isArray(result.tools)).toBe(true);
  });

  it("result.tools matches buildToolList()", () => {
    const result = handleToolsList(1).result as { tools: McpTool[] };
    expect(result.tools).toEqual(buildToolList());
  });
});

// ─── handleUnknownMethod ───────────────────────────────────────────────────────

describe("handleUnknownMethod()", () => {
  it("returns error with code -32601", () => {
    const resp = handleUnknownMethod(1, "foo/bar");
    expect(resp.error).toBeDefined();
    expect(resp.error!.code).toBe(-32601);
    expect(resp.error!.message).toMatch(/foo\/bar/);
  });

  it("echoes back the id", () => {
    expect(handleUnknownMethod("x", "noop").id).toBe("x");
  });
});

// ─── processMessage ────────────────────────────────────────────────────────────

describe("processMessage()", () => {
  it("initialize → returns initialize result", async () => {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {} },
    };
    const resp = await processMessage(req);
    expect(resp).not.toBeNull();
    expect(resp!.result).toBeDefined();
    expect((resp!.result as Record<string, unknown>).protocolVersion).toBe(
      MCP_PROTOCOL_VERSION,
    );
  });

  it("notifications/initialized → returns null (no response)", async () => {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: null,
      method: "notifications/initialized",
    };
    const resp = await processMessage(req);
    expect(resp).toBeNull();
  });

  it("tools/list → returns tool list", async () => {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    };
    const resp = await processMessage(req);
    expect(resp).not.toBeNull();
    const tools = (resp!.result as { tools: McpTool[] }).tools;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });

  it("unknown method with id → returns method-not-found error", async () => {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 99,
      method: "completely/unknown",
    };
    const resp = await processMessage(req);
    expect(resp!.error!.code).toBe(-32601);
  });

  it("unknown method without id → returns null (notification)", async () => {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: null,
      method: "server/ping",
    };
    const resp = await processMessage(req);
    expect(resp).toBeNull();
  });

  it("tools/call hh_send → returns ok result", async () => {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "hh_send",
        arguments: { task: "write a haiku", peer: "glados" },
      },
    };
    const resp = await processMessage(req);
    expect(resp).not.toBeNull();
    const result = resp!.result as { content: Array<{ text: string }> };
    expect(result.content[0].text).toBeTruthy();
  });

  it("tools/call hh_tasks → returns task list", async () => {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "hh_tasks",
        arguments: { limit: 5 },
      },
    };
    const resp = await processMessage(req);
    expect(resp).not.toBeNull();
    const result = resp!.result as { content: Array<{ text: string }> };
    expect(result.content[0].text).toMatch(/task-001|summarise/i);
  });

  it("tools/call hh_peers → returns peer list", async () => {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "hh_peers", arguments: {} },
    };
    const resp = await processMessage(req);
    const result = resp!.result as { content: Array<{ text: string }> };
    expect(result.content[0].text).toMatch(/glados/i);
  });

  it("tools/call unknown tool → isError result", async () => {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "hh_nonexistent", arguments: {} },
    };
    const resp = await processMessage(req);
    const result = resp!.result as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBe(true);
  });

  it("tools/call with empty params object → isError (missing tool name)", async () => {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {},
    };
    const resp = await processMessage(req);
    // Should not throw — returns isError result for missing tool name
    expect(resp).not.toBeNull();
    const result = resp!.result as { isError?: boolean; content?: Array<{ text: string }> };
    expect(result.isError).toBe(true);
  });
});

// ─── Protocol version constants ────────────────────────────────────────────────

describe("MCP constants", () => {
  it("MCP_PROTOCOL_VERSION matches spec", () => {
    expect(MCP_PROTOCOL_VERSION).toBe("2024-11-05");
  });

  it("SERVER_NAME is cofounder", () => {
    expect(SERVER_NAME).toBe("cofounder");
  });

  it("SERVER_VERSION is a semver string", () => {
    expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
