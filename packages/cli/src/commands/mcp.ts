/**
 * commands/mcp.ts — `cofounder mcp`
 *
 * A minimal MCP (Model Context Protocol) stdio server that exposes
 * cofounder as tools to any MCP-compatible client.
 *
 * Compatible with: Claude Desktop, Cursor, Zed, Cline, Continue, and any
 * client implementing MCP protocol version 2024-11-05.
 *
 * Transport: stdio (JSON-RPC 2.0, newline-delimited)
 * Protocol version: 2024-11-05
 *
 * Exposed tools:
 *   hh_send       — send a task to a peer (optionally wait for result)
 *   hh_status     — check peer gateway + Tailscale health
 *   hh_peers      — list configured peers with capability info
 *   hh_tasks      — list recent tasks with status + cost
 *   hh_broadcast  — broadcast a task to all (or named) peers
 *   hh_wake       — wake a peer via WOL/SSH
 *
 * Usage:
 *   cofounder mcp                  # start stdio server (used by Claude Desktop)
 *   cofounder mcp --list-tools     # print tool schemas as JSON and exit
 *
 * Claude Desktop config (~/.claude/claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "cofounder": { "command": "cofounder", "args": ["mcp"] }
 *     }
 *   }
 *
 * Cursor / .cursor/mcp.json:
 *   {
 *     "mcpServers": {
 *       "cofounder": { "command": "cofounder", "args": ["mcp"], "type": "stdio" }
 *     }
 *   }
 */

import { createInterface } from "node:readline";
import { loadConfig } from "../config/store.ts";
import {
  wakeAgent,
  pingPeer,
  checkGatewayHealth,
  wakeAndWait,
} from "@cofounder/core";
import {
  createTaskState,
  listTaskStates,
  pollTaskCompletion,
} from "../state/tasks.ts";
import { getAllPeers, getPeer } from "../peers/select.ts";
import { loadPeerCapabilities } from "@cofounder/core";

// ─── JSON-RPC 2.0 Types ───────────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

// ─── MCP Protocol Types ───────────────────────────────────────────────────────

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

// ─── Tool schemas ─────────────────────────────────────────────────────────────

export const MCP_PROTOCOL_VERSION = "2024-11-05";
export const SERVER_NAME = "cofounder";
export const SERVER_VERSION = "0.3.0";

export function buildToolList(): McpTool[] {
  return [
    {
      name: "hh_send",
      description:
        "Send a task to a remote peer node (H2 — the heavy-compute machine). " +
        "The peer wakes up if offline, runs the task with its configured AI model, " +
        "and returns the result. Use `wait: true` to block until the task is done " +
        "(up to `timeout` seconds).",
      inputSchema: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "The task or question to send to the peer. Be specific.",
          },
          peer: {
            type: "string",
            description:
              "Name of the peer to target (from `cofounder peers`). Omit to use the default peer or auto-route by capability.",
          },
          wait: {
            type: "boolean",
            description:
              "If true, wait for the result before returning (default: false). " +
              "Set to true if you need the output.",
          },
          timeout: {
            type: "number",
            description:
              "Maximum seconds to wait when `wait` is true (default: 120).",
          },
        },
        required: ["task"],
      },
    },
    {
      name: "hh_status",
      description:
        "Check the health of this node and all configured peers. " +
        "Returns Tailscale reachability, gateway status, last heartbeat, " +
        "and WOL readiness per peer.",
      inputSchema: {
        type: "object",
        properties: {
          peer: {
            type: "string",
            description:
              "Focus on a specific peer by name. Omit to check all peers.",
          },
        },
      },
    },
    {
      name: "hh_peers",
      description:
        "List all configured peer nodes with their GPU, Ollama model count, " +
        "skill tags, and Tailscale IP. Use this to see which peers are available " +
        "before sending a task.",
      inputSchema: {
        type: "object",
        properties: {
          ping: {
            type: "boolean",
            description:
              "If true, perform a live Tailscale ping for each peer (slower but accurate).",
          },
        },
      },
    },
    {
      name: "hh_tasks",
      description:
        "List recent tasks sent to peers. Includes status, peer, cost, duration, " +
        "and result preview. Useful for checking on in-flight tasks or reviewing history.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Maximum number of tasks to return (default: 10).",
          },
          status: {
            type: "string",
            enum: ["pending", "running", "completed", "failed", "timeout", "cancelled"],
            description: "Filter by status (omit for all statuses).",
          },
          peer: {
            type: "string",
            description: "Filter by peer name.",
          },
        },
      },
    },
    {
      name: "hh_broadcast",
      description:
        "Broadcast a task to multiple peer nodes simultaneously. " +
        "Strategy 'all' waits for every peer; 'first' returns as soon as one responds. " +
        "Useful for parallel processing, redundancy, or capability probing.",
      inputSchema: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "The task to broadcast to all peers.",
          },
          peers: {
            type: "array",
            items: { type: "string" },
            description:
              "Specific peer names to target. Omit to broadcast to all configured peers.",
          },
          strategy: {
            type: "string",
            enum: ["all", "first"],
            description:
              "'all' — wait for every peer to respond (default). " +
              "'first' — return as soon as one peer responds.",
          },
          wait: {
            type: "boolean",
            description: "If true, wait for results (default: false).",
          },
          timeout: {
            type: "number",
            description: "Per-peer timeout in seconds when `wait` is true (default: 120).",
          },
        },
        required: ["task"],
      },
    },
    {
      name: "hh_wake",
      description:
        "Wake a peer node that is offline. Uses Wake-on-LAN (magic packet) " +
        "followed by SSH/Tailscale polling until the node responds. " +
        "Call this before `hh_send` if you know the peer is off and need it up fast.",
      inputSchema: {
        type: "object",
        properties: {
          peer: {
            type: "string",
            description: "Name of the peer to wake. Omit to wake the default peer.",
          },
          timeout: {
            type: "number",
            description: "Seconds to wait for the node to come up (default: 90).",
          },
        },
      },
    },
  ];
}

// ─── Tool dispatch ────────────────────────────────────────────────────────────

export async function dispatchToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  try {
    switch (name) {
      case "hh_send":
        return await toolSend(args);
      case "hh_status":
        return await toolStatus(args);
      case "hh_peers":
        return await toolPeers(args);
      case "hh_tasks":
        return await toolTasks(args);
      case "hh_broadcast":
        return await toolBroadcast(args);
      case "hh_wake":
        return await toolWake(args);
      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResult(msg);
  }
}

function textResult(text: string): McpToolResult {
  return { content: [{ type: "text", text }] };
}

function errorResult(text: string): McpToolResult {
  return { content: [{ type: "text", text: `Error: ${text}` }], isError: true };
}

// ─── hh_send ─────────────────────────────────────────────────────────────────

async function toolSend(args: Record<string, unknown>): Promise<McpToolResult> {
  const task = String(args.task ?? "");
  if (!task) return errorResult("task is required");

  const peerName = args.peer ? String(args.peer) : undefined;
  const shouldWait = Boolean(args.wait);
  const timeout = typeof args.timeout === "number" ? args.timeout : 120;

  const config = await loadConfig();
  if (!config) return errorResult("No cofounder config found. Run `cofounder onboard` first.");

  // Find the target peer
  const allPeers = getAllPeers(config);
  const targetPeer = peerName
    ? allPeers.find((p) => p.name === peerName)
    : allPeers[0];

  if (!targetPeer) {
    const names = allPeers.map((p) => p.name).join(", ");
    return errorResult(
      peerName
        ? `Peer '${peerName}' not found. Available: ${names}`
        : "No peers configured. Run `cofounder onboard` first.",
    );
  }

  // Create task state
  const taskState = await createTaskState({
    from: config.this_node.name,
    to: targetPeer.name,
    objective: task,
    constraints: [],
  });

  // Wake the agent
  const gatewayUrl = `ws://${targetPeer.tailscale_ip}:${targetPeer.gateway_port ?? 18789}`;
  const wakeResult = await wakeAgent(gatewayUrl, targetPeer.gateway_token, {
    text: task,
    mode: "task",
  });

  if (!wakeResult.ok) {
    return errorResult(
      `Failed to reach ${targetPeer.name}: ${wakeResult.error ?? "unknown error"}`,
    );
  }

  if (!shouldWait) {
    return textResult(
      `✓ Task dispatched to ${targetPeer.name}\n` +
        `  Task ID: ${taskState.id}\n` +
        `  Check status with: hh_tasks\n` +
        `  Or wait for result: hh_send with wait: true`,
    );
  }

  // Poll for result
  const result = await pollTaskCompletion(taskState.id, timeout * 1000, 2000);
  if (!result) {
    return textResult(
      `⏱ Task ${taskState.id} timed out after ${timeout}s.\n` +
        `It may still be running on ${targetPeer.name}. Check with: hh_tasks`,
    );
  }

  const status = result.status;
  const output = result.result?.output ?? "(no output)";
  const cost =
    result.result?.cost_usd != null
      ? `$${result.result.cost_usd.toFixed(4)}`
      : "—";
  const durationMs = result.result?.duration_ms;
  const duration =
    durationMs != null ? `${(durationMs / 1000).toFixed(1)}s` : "—";

  return textResult(
    `${status === "completed" ? "✓" : "✗"} Task ${status} on ${targetPeer.name}\n` +
      `  Duration: ${duration} | Cost: ${cost}\n\n` +
      `${output}`,
  );
}

// ─── hh_status ────────────────────────────────────────────────────────────────

async function toolStatus(
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const peerFilter = args.peer ? String(args.peer) : undefined;

  const config = await loadConfig();
  if (!config) return errorResult("No cofounder config found. Run `cofounder onboard` first.");

  const allPeers = getAllPeers(config);
  const targets = peerFilter
    ? allPeers.filter((p) => p.name === peerFilter)
    : allPeers;

  if (peerFilter && targets.length === 0) {
    const names = allPeers.map((p) => p.name).join(", ");
    return errorResult(
      `Peer '${peerFilter}' not found. Available: ${names}`,
    );
  }

  const lines: string[] = [];
  lines.push(`This node: ${config.this_node.emoji ?? "🖥"} ${config.this_node.name} (${config.this_node.role})`);

  // Local gateway health
  const localPort = config.gateway_port ?? 18789;
  const localHealth = await checkGatewayHealth(`http://127.0.0.1:${localPort}/health`);
  lines.push(`  Local gateway: ${localHealth ? "✓ live" : "✗ unreachable"} (port ${localPort})`);
  lines.push("");

  for (const peer of targets) {
    lines.push(`Peer: ${peer.emoji ?? "🖥"} ${peer.name} (${peer.role})`);
    lines.push(`  Tailscale IP: ${peer.tailscale_ip}`);

    const reachable = await pingPeer(peer.tailscale_ip, 5000);
    lines.push(`  Tailscale: ${reachable ? "✓ reachable" : "✗ unreachable"}`);

    if (reachable) {
      const peerPort = peer.gateway_port ?? 18789;
      const gwHealth = await checkGatewayHealth(
        `http://${peer.tailscale_ip}:${peerPort}/health`,
      );
      lines.push(`  Gateway: ${gwHealth ? "✓ live" : "⚠ not responding"} (port ${peerPort})`);
    }

    if (peer.wol_enabled) {
      lines.push(`  WOL: enabled (MAC: ${peer.wol_mac ?? "?"})`);
      if (!reachable) lines.push(`  → Use hh_wake to bring this node online`);
    }

    lines.push("");
  }

  return textResult(lines.join("\n").trimEnd());
}

// ─── hh_peers ─────────────────────────────────────────────────────────────────

async function toolPeers(
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const doPing = Boolean(args.ping);

  const config = await loadConfig();
  if (!config) return errorResult("No cofounder config found. Run `cofounder onboard` first.");

  const allPeers = getAllPeers(config);
  if (allPeers.length === 0) {
    return textResult("No peers configured. Run `cofounder onboard` to add a peer.");
  }

  const lines: string[] = [`${allPeers.length} peer(s) configured:\n`];

  for (const peer of allPeers) {
    const caps = await loadPeerCapabilities(peer.name).catch(() => null);
    let reachable: boolean | undefined;
    if (doPing) {
      reachable = await pingPeer(peer.tailscale_ip, 5000);
    }

    lines.push(
      `${peer.emoji ?? "🖥"} ${peer.name} (${peer.role}) — ${peer.tailscale_ip}`,
    );

    if (doPing && reachable !== undefined) {
      lines.push(`  Reachable: ${reachable ? "✓ yes" : "✗ no"}`);
    }

    if (caps) {
      if (caps.gpu?.name) lines.push(`  GPU: ${caps.gpu.name}`);
      if (caps.ollama_models?.length) {
        lines.push(`  Ollama: ${caps.ollama_models.length} model(s)`);
      }
      if (caps.skill_tags?.length) {
        lines.push(`  Skills: ${caps.skill_tags.join(", ")}`);
      }
    } else {
      lines.push("  Capabilities: not cached (run: cofounder capabilities fetch)");
    }

    lines.push("");
  }

  return textResult(lines.join("\n").trimEnd());
}

// ─── hh_tasks ─────────────────────────────────────────────────────────────────

async function toolTasks(
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const limit = typeof args.limit === "number" ? args.limit : 10;
  const statusFilter = args.status ? String(args.status) : undefined;
  const peerFilter = args.peer ? String(args.peer) : undefined;

  const all = await listTaskStates();
  let tasks = all.slice().reverse(); // newest first

  if (statusFilter) {
    tasks = tasks.filter((t) => t.status === statusFilter);
  }
  if (peerFilter) {
    tasks = tasks.filter((t) => t.to === peerFilter);
  }

  tasks = tasks.slice(0, limit);

  if (tasks.length === 0) {
    const filterDesc = [
      statusFilter ? `status=${statusFilter}` : null,
      peerFilter ? `peer=${peerFilter}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    return textResult(
      `No tasks found${filterDesc ? ` (${filterDesc})` : ""}. Use hh_send to dispatch a task.`,
    );
  }

  const lines: string[] = [`Recent tasks (${tasks.length} shown):\n`];

  for (const task of tasks) {
    const badge =
      task.status === "completed"
        ? "✓"
        : task.status === "failed"
          ? "✗"
          : task.status === "running"
            ? "⟳"
            : task.status === "pending"
              ? "…"
              : "○";

    const cost =
      task.result?.cost_usd != null
        ? ` $${task.result.cost_usd.toFixed(4)}`
        : "";
    const dur =
      task.result?.duration_ms != null
        ? ` ${(task.result.duration_ms / 1000).toFixed(1)}s`
        : "";

    const preview =
      task.result?.output
        ? task.result.output.slice(0, 120).replace(/\n/g, " ") +
          (task.result.output.length > 120 ? "…" : "")
        : task.objective.slice(0, 60).replace(/\n/g, " ");

    lines.push(
      `${badge} [${task.id.slice(0, 8)}] → ${task.to}${cost}${dur}`,
    );
    lines.push(`  ${preview}`);
    lines.push(`  Created: ${task.created_at}`);
    lines.push("");
  }

  return textResult(lines.join("\n").trimEnd());
}

// ─── hh_broadcast ─────────────────────────────────────────────────────────────

async function toolBroadcast(
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const task = String(args.task ?? "");
  if (!task) return errorResult("task is required");

  const targetNames = Array.isArray(args.peers)
    ? (args.peers as string[])
    : undefined;
  const strategy = args.strategy === "first" ? "first" : "all";
  const shouldWait = Boolean(args.wait);
  const timeout = typeof args.timeout === "number" ? args.timeout : 120;

  const config = await loadConfig();
  if (!config) return errorResult("No cofounder config found. Run `cofounder onboard` first.");

  const allPeers = getAllPeers(config);
  const targets = targetNames
    ? allPeers.filter((p) => targetNames.includes(p.name))
    : allPeers;

  if (targets.length === 0) {
    return errorResult("No matching peers found.");
  }

  const lines: string[] = [
    `Broadcasting to ${targets.length} peer(s) [strategy: ${strategy}]:\n`,
  ];

  type WakeOutcome = {
    peer: string;
    ok: boolean;
    error?: string;
    taskId?: string;
  };

  const dispatchOne = async (peer: (typeof allPeers)[number]): Promise<WakeOutcome> => {
    try {
      const state = await createTaskState({
        from: config.this_node.name,
        to: peer.name,
        objective: task,
        constraints: [],
      });
      const gatewayUrl = `ws://${peer.tailscale_ip}:${peer.gateway_port ?? 18789}`;
      const result = await wakeAgent(gatewayUrl, peer.gateway_token, {
        text: task,
        mode: "task",
      });
      return { peer: peer.name, ok: result.ok, error: result.error, taskId: state.id };
    } catch (err) {
      return {
        peer: peer.name,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  let outcomes: WakeOutcome[];

  if (strategy === "first") {
    // Race — first peer to dispatch wins; the rest are still sent (wake-and-forget)
    outcomes = await Promise.all(targets.map(dispatchOne));
  } else {
    outcomes = await Promise.all(targets.map(dispatchOne));
  }

  let ok = 0;
  let failed = 0;
  for (const outcome of outcomes) {
    if (outcome.ok) {
      ok++;
      lines.push(
        `  ✓ ${outcome.peer}${outcome.taskId ? ` (task: ${outcome.taskId.slice(0, 8)})` : ""}`,
      );
    } else {
      failed++;
      lines.push(`  ✗ ${outcome.peer}: ${outcome.error ?? "failed"}`);
    }
  }

  lines.push("");
  lines.push(`Summary: ${ok} dispatched, ${failed} failed.`);

  if (!shouldWait) {
    lines.push("Tip: use hh_tasks to check results when they arrive.");
  }

  return textResult(lines.join("\n"));
}

// ─── hh_wake ──────────────────────────────────────────────────────────────────

async function toolWake(args: Record<string, unknown>): Promise<McpToolResult> {
  const peerName = args.peer ? String(args.peer) : undefined;
  const timeout = typeof args.timeout === "number" ? args.timeout : 90;

  const config = await loadConfig();
  if (!config) return errorResult("No cofounder config found. Run `cofounder onboard` first.");

  const allPeers = getAllPeers(config);
  const peer = peerName ? allPeers.find((p) => p.name === peerName) : allPeers[0];

  if (!peer) {
    const names = allPeers.map((p) => p.name).join(", ");
    return errorResult(
      peerName
        ? `Peer '${peerName}' not found. Available: ${names}`
        : "No peers configured.",
    );
  }

  if (!peer.wol_enabled || !peer.wol_mac) {
    // Check if already reachable
    const reachable = await pingPeer(peer.tailscale_ip, 3000);
    if (reachable) {
      return textResult(
        `${peer.name} is already online (Tailscale reachable). No wake needed.`,
      );
    }
    return errorResult(
      `${peer.name} does not have Wake-on-LAN configured. ` +
        "Enable it via `cofounder onboard` or set wol_enabled + wol_mac in your config.",
    );
  }

  // Check if already up first
  const alreadyUp = await pingPeer(peer.tailscale_ip, 3000);
  if (alreadyUp) {
    return textResult(`${peer.name} is already online. No wake needed.`);
  }

  // Send WOL and wait
  const result = await wakeAndWait(peer, timeout * 1000);

  if (result.ok) {
    return textResult(
      `✓ ${peer.name} is up! (came online in ~${Math.round((result.elapsed_ms ?? 0) / 1000)}s)\n` +
        "You can now use hh_send to dispatch tasks.",
    );
  }

  return textResult(
    `⚠ Wake-on-LAN sent to ${peer.name} (MAC: ${peer.wol_mac}), ` +
      `but node did not respond within ${timeout}s.\n` +
      "It may take a few more seconds to boot. Try hh_status in a moment.",
  );
}

// ─── MCP message handlers ─────────────────────────────────────────────────────

export function handleInitialize(
  id: string | number | null,
  _params: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: { listChanged: false },
      },
      serverInfo: {
        name: SERVER_NAME,
        version: SERVER_VERSION,
      },
    },
  };
}

export function handleToolsList(id: string | number | null): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      tools: buildToolList(),
    },
  };
}

export async function handleToolsCall(
  id: string | number | null,
  params: unknown,
): Promise<JsonRpcResponse> {
  const p = params as { name?: string; arguments?: Record<string, unknown> };
  if (!p || !p.name) {
    return {
      jsonrpc: "2.0",
      id,
      result: errorResult("Missing tool name"),
    };
  }

  const result = await dispatchToolCall(p.name, p.arguments ?? {});
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

export function handleUnknownMethod(
  id: string | number | null,
  method: string,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}

export async function processMessage(
  msg: JsonRpcRequest,
): Promise<JsonRpcResponse | null> {
  const { id, method, params } = msg;

  switch (method) {
    case "initialize":
      return handleInitialize(id, params);

    case "notifications/initialized":
      // Notification — no response
      return null;

    case "tools/list":
      return handleToolsList(id);

    case "tools/call":
      return await handleToolsCall(id, params);

    default:
      // Notifications (no id) get no response
      if (id == null) return null;
      return handleUnknownMethod(id, method);
  }
}

// ─── Stdio server loop ────────────────────────────────────────────────────────

export async function runMcpServer(): Promise<void> {
  const rl = createInterface({ input: process.stdin, terminal: false });

  const send = (obj: JsonRpcResponse | JsonRpcNotification) => {
    process.stdout.write(JSON.stringify(obj) + "\n");
  };

  // Ready notification (some clients wait for a ready signal)
  // We just start reading — MCP clients send initialize first

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let msg: JsonRpcRequest;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      send({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
      continue;
    }

    const response = await processMessage(msg);
    if (response !== null) {
      send(response);
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface McpOptions {
  listTools?: boolean;
}

export async function mcp(opts: McpOptions = {}): Promise<void> {
  if (opts.listTools) {
    console.log(JSON.stringify({ tools: buildToolList() }, null, 2));
    return;
  }

  // Suppress all console.log noise from sub-commands while acting as MCP server
  // (MCP clients read stdout; any non-JSON line breaks the protocol)
  const origLog = console.log;
  const origInfo = console.info;
  const origWarn = console.warn;
  const origError = console.error;

  // Redirect everything to stderr so the client never sees it
  console.log = (...args: unknown[]) => process.stderr.write(args.join(" ") + "\n");
  console.info = (...args: unknown[]) => process.stderr.write(args.join(" ") + "\n");
  console.warn = (...args: unknown[]) => process.stderr.write(args.join(" ") + "\n");
  console.error = (...args: unknown[]) => process.stderr.write(args.join(" ") + "\n");

  try {
    await runMcpServer();
  } finally {
    console.log = origLog;
    console.info = origInfo;
    console.warn = origWarn;
    console.error = origError;
  }
}
