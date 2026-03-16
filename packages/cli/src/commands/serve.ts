/**
 * commands/serve.ts — `hh serve`
 *
 * A lightweight REST API server exposing his-and-hers as an HTTP interface.
 *
 * Complements `hh mcp` (LLM clients) and `hh web` (browser dashboard).
 * This server targets automation, CI scripts, custom apps, and language-agnostic integrations.
 *
 * Auth: X-HH-Token header or ?token= query param.
 * Token is auto-generated on first `hh serve` run and stored in
 * ~/.his-and-hers/serve-token (or override with --token / HH_SERVE_TOKEN env).
 *
 * Endpoints:
 *   GET  /              — API root (version, links)
 *   GET  /health        — liveness check (no auth required)
 *   GET  /openapi.json  — OpenAPI 3.1 spec
 *   GET  /peers         — list configured peers
 *   GET  /peers/:name   — get a specific peer
 *   POST /peers/:name/ping  — live ping a peer
 *   POST /peers/:name/wake  — wake a peer via WOL/SSH
 *   GET  /status        — all peers: gateway health + ping
 *   GET  /tasks         — list tasks (?status=&peer=&since=&limit=)
 *   GET  /tasks/:id     — get a specific task
 *   POST /tasks         — send a task { task, peer, wait, timeout }
 *   DELETE /tasks/:id   — cancel a task
 *   POST /broadcast     — broadcast { task, peers[], strategy }
 *   GET  /budget        — budget summary (weekly)
 *   GET  /capabilities  — cached peer capabilities
 *   GET  /events        — SSE stream (task updates, peer status)
 *
 * Usage:
 *   hh serve                     # default port 3848
 *   hh serve --port 9000         # custom port
 *   hh serve --token mytoken     # use fixed token
 *   hh serve --no-auth           # disable auth (local dev only)
 *   hh serve --readonly          # disable mutating endpoints
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { URL } from "node:url";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { loadConfig } from "../config/store.ts";
import {
  listTaskStates,
  loadTaskState,
  updateTaskState,
  type TaskState,
  type TaskStatus,
} from "../state/tasks.ts";
import { buildBudgetSummary } from "../state/budget.ts";
import {
  checkGatewayHealth,
  pingPeer,
  wakeAgent,
  createTaskMessage,
  loadContextSummary,
  withRetry,
  loadPeerCapabilities,
} from "@his-and-hers/core";
import { getAllPeers, findPeerByName } from "../peers/select.ts";
import { createTaskState, pollTaskCompletion } from "../state/tasks.ts";

// ─── Wake text helper (local to serve — mirrors send.ts pattern) ──────────────

function buildServeWakeText(from: string, taskId: string, task: string): string {
  return [
    `[HHMessage:task from ${from} id=${taskId}] ${task}`,
    ``,
    `When done, run: hh result ${taskId} "<your output here>"`,
  ].join("\n");
}

const HH_DIR = join(homedir(), ".his-and-hers");
const TOKEN_FILE = join(HH_DIR, "serve-token");
const DEFAULT_PORT = 3848;
const API_VERSION = "1.0";

export interface ServeOptions {
  port?: string;
  token?: string;
  noAuth?: boolean;
  readonly?: boolean;
}

// ─── Token management ─────────────────────────────────────────────────────────

async function getOrCreateToken(): Promise<string> {
  if (existsSync(TOKEN_FILE)) {
    const t = await readFile(TOKEN_FILE, "utf8");
    return t.trim();
  }
  await mkdir(HH_DIR, { recursive: true });
  const token = randomBytes(24).toString("hex");
  await writeFile(TOKEN_FILE, token, { mode: 0o600 });
  return token;
}

// ─── Auth middleware ──────────────────────────────────────────────────────────

function checkAuth(
  req: IncomingMessage,
  url: URL,
  token: string,
  noAuth: boolean,
): boolean {
  if (noAuth) return true;
  const header = req.headers["x-hh-token"];
  if (typeof header === "string" && header === token) return true;
  const queryToken = url.searchParams.get("token");
  if (queryToken === token) return true;
  return false;
}

// ─── Response helpers ─────────────────────────────────────────────────────────

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(payload);
}

function unauthorized(res: ServerResponse): void {
  json(res, 401, { error: "Unauthorized", hint: "Pass X-HH-Token header or ?token= query param." });
}

function notFound(res: ServerResponse, msg = "Not found"): void {
  json(res, 404, { error: msg });
}

function methodNotAllowed(res: ServerResponse): void {
  json(res, 405, { error: "Method not allowed" });
}

function readonlyError(res: ServerResponse): void {
  json(res, 403, { error: "Server is in read-only mode" });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk.toString()));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

// ─── SSE helpers ─────────────────────────────────────────────────────────────

const sseClients = new Set<ServerResponse>();

export function broadcastSSEServe(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

// ─── OpenAPI spec ─────────────────────────────────────────────────────────────

function buildOpenApiSpec(baseUrl: string): object {
  return {
    openapi: "3.1.0",
    info: {
      title: "his-and-hers REST API",
      version: API_VERSION,
      description:
        "HTTP interface for the his-and-hers two-agent communication framework. " +
        "Complements `hh mcp` (LLM clients) and `hh web` (browser dashboard).",
      contact: { url: "https://github.com/CalciferFriend/his-and-hers" },
      license: { name: "MIT" },
    },
    servers: [{ url: baseUrl }],
    security: [{ TokenAuth: [] }],
    components: {
      securitySchemes: {
        TokenAuth: {
          type: "apiKey",
          in: "header",
          name: "X-HH-Token",
          description: "API token from ~/.his-and-hers/serve-token (or HH_SERVE_TOKEN env)",
        },
      },
      schemas: {
        Task: {
          type: "object",
          properties: {
            id: { type: "string" },
            from: { type: "string" },
            to: { type: "string" },
            objective: { type: "string" },
            status: {
              type: "string",
              enum: ["pending", "running", "completed", "failed", "timeout", "cancelled"],
            },
            created_at: { type: "string", format: "date-time" },
            updated_at: { type: "string", format: "date-time" },
            result: {
              oneOf: [{ $ref: "#/components/schemas/TaskResult" }, { type: "null" }],
            },
          },
        },
        TaskResult: {
          type: "object",
          properties: {
            output: { type: "string" },
            success: { type: "boolean" },
            error: { type: "string" },
            artifacts: { type: "array", items: { type: "string" } },
            tokens_used: { type: "integer" },
            duration_ms: { type: "integer" },
            cost_usd: { type: "number" },
          },
        },
        Peer: {
          type: "object",
          properties: {
            name: { type: "string" },
            tailscale_hostname: { type: "string" },
            gateway_port: { type: "integer" },
            ssh_user: { type: "string" },
          },
        },
        SendRequest: {
          type: "object",
          required: ["task"],
          properties: {
            task: { type: "string", description: "Task objective to send to H2" },
            peer: { type: "string", description: "Target peer name (defaults to primary)" },
            wait: { type: "boolean", description: "Block until task completes (default false)" },
            timeout: {
              type: "integer",
              description: "Timeout in seconds when wait=true (default 120)",
            },
          },
        },
        SendResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            task_id: { type: "string" },
            peer: { type: "string" },
            result: { oneOf: [{ $ref: "#/components/schemas/TaskResult" }, { type: "null" }] },
            duration_ms: { type: "integer" },
          },
        },
        BroadcastRequest: {
          type: "object",
          required: ["task"],
          properties: {
            task: { type: "string" },
            peers: {
              type: "array",
              items: { type: "string" },
              description: "Peer names to broadcast to. Defaults to all.",
            },
            strategy: {
              type: "string",
              enum: ["all", "first"],
              description: "'all' waits for all peers; 'first' stops at first response.",
            },
            wait: { type: "boolean" },
            timeout: { type: "integer" },
          },
        },
        Error: {
          type: "object",
          properties: {
            error: { type: "string" },
            hint: { type: "string" },
          },
        },
      },
    },
    paths: {
      "/": {
        get: {
          summary: "API root",
          operationId: "getRoot",
          security: [],
          responses: {
            "200": {
              description: "API info",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
      "/health": {
        get: {
          summary: "Liveness check",
          operationId: "getHealth",
          security: [],
          responses: {
            "200": { description: "OK" },
          },
        },
      },
      "/openapi.json": {
        get: {
          summary: "OpenAPI 3.1 spec",
          operationId: "getOpenApiSpec",
          security: [],
          responses: {
            "200": { description: "OpenAPI specification" },
          },
        },
      },
      "/peers": {
        get: {
          summary: "List configured peers",
          operationId: "listPeers",
          responses: {
            "200": {
              description: "List of peer configurations",
              content: {
                "application/json": {
                  schema: { type: "array", items: { $ref: "#/components/schemas/Peer" } },
                },
              },
            },
          },
        },
      },
      "/peers/{name}": {
        get: {
          summary: "Get a specific peer",
          operationId: "getPeer",
          parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description: "Peer configuration",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Peer" } } },
            },
            "404": { description: "Peer not found" },
          },
        },
      },
      "/peers/{name}/ping": {
        post: {
          summary: "Ping a peer (live Tailscale check)",
          operationId: "pingPeer",
          parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Ping result with reachability and RTT" },
          },
        },
      },
      "/peers/{name}/wake": {
        post: {
          summary: "Wake a peer via WOL or SSH",
          operationId: "wakePeer",
          parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Wake result" },
          },
        },
      },
      "/status": {
        get: {
          summary: "All peers: gateway health + ping",
          operationId: "getStatus",
          responses: {
            "200": { description: "Status for each peer" },
          },
        },
      },
      "/tasks": {
        get: {
          summary: "List tasks",
          operationId: "listTasks",
          parameters: [
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "peer", in: "query", schema: { type: "string" } },
            { name: "since", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer" } },
          ],
          responses: {
            "200": {
              description: "Task list",
              content: {
                "application/json": {
                  schema: { type: "array", items: { $ref: "#/components/schemas/Task" } },
                },
              },
            },
          },
        },
        post: {
          summary: "Send a task to a peer",
          operationId: "sendTask",
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/SendRequest" } },
            },
          },
          responses: {
            "200": {
              description: "Send result",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/SendResponse" } },
              },
            },
          },
        },
      },
      "/tasks/{id}": {
        get: {
          summary: "Get a specific task",
          operationId: "getTask",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description: "Task state",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Task" } } },
            },
            "404": { description: "Task not found" },
          },
        },
        delete: {
          summary: "Cancel a task",
          operationId: "cancelTask",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Cancellation result" },
            "404": { description: "Task not found" },
          },
        },
      },
      "/broadcast": {
        post: {
          summary: "Broadcast a task to multiple peers",
          operationId: "broadcast",
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/BroadcastRequest" } },
            },
          },
          responses: {
            "200": { description: "Broadcast result per peer" },
          },
        },
      },
      "/budget": {
        get: {
          summary: "Budget summary (weekly spend by peer + provider)",
          operationId: "getBudget",
          responses: {
            "200": { description: "Budget summary" },
          },
        },
      },
      "/capabilities": {
        get: {
          summary: "Cached peer capabilities (GPU, Ollama models, skills)",
          operationId: "getCapabilities",
          responses: {
            "200": { description: "Capabilities per peer" },
          },
        },
      },
      "/events": {
        get: {
          summary: "Server-sent events stream (task updates, peer status)",
          operationId: "getEvents",
          responses: {
            "200": {
              description: "SSE stream",
              content: { "text/event-stream": {} },
            },
          },
        },
      },
    },
  };
}

// ─── Route handlers ───────────────────────────────────────────────────────────

async function handleListTasks(
  url: URL,
  res: ServerResponse,
): Promise<void> {
  const statusFilter = url.searchParams.get("status") as TaskStatus | null;
  const peerFilter = url.searchParams.get("peer");
  const sinceParam = url.searchParams.get("since");
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : 50;

  let tasks = await listTaskStates();

  if (statusFilter) {
    tasks = tasks.filter((t) => t.status === statusFilter);
  }
  if (peerFilter) {
    tasks = tasks.filter((t) => t.to.toLowerCase() === peerFilter.toLowerCase());
  }
  if (sinceParam) {
    const sinceMs = parseSinceMs(sinceParam);
    if (sinceMs > 0) {
      const cutoff = new Date(Date.now() - sinceMs).toISOString();
      tasks = tasks.filter((t) => t.created_at >= cutoff);
    }
  }

  // Sort newest first
  tasks.sort((a, b) => b.created_at.localeCompare(a.created_at));
  tasks = tasks.slice(0, limit);

  json(res, 200, tasks);
}

async function handleGetTask(id: string, res: ServerResponse): Promise<void> {
  // Try exact match first, then prefix match
  const all = await listTaskStates();
  const task =
    all.find((t) => t.id === id) ?? all.find((t) => t.id.startsWith(id)) ?? null;
  if (!task) {
    notFound(res, `Task '${id}' not found`);
    return;
  }
  json(res, 200, task);
}

async function handleCancelTask(id: string, res: ServerResponse): Promise<void> {
  const all = await listTaskStates();
  const task =
    all.find((t) => t.id === id) ?? all.find((t) => t.id.startsWith(id)) ?? null;
  if (!task) {
    notFound(res, `Task '${id}' not found`);
    return;
  }
  if (task.status !== "pending" && task.status !== "running") {
    json(res, 409, {
      error: `Task is ${task.status}, can only cancel pending/running tasks`,
    });
    return;
  }
  await updateTaskState(task.id, { status: "cancelled" });
  broadcastSSEServe("task_cancelled", { task_id: task.id });
  json(res, 200, { ok: true, task_id: task.id, status: "cancelled" });
}

async function handleSendTask(
  req: IncomingMessage,
  res: ServerResponse,
  isReadonly: boolean,
): Promise<void> {
  if (isReadonly) { readonlyError(res); return; }

  const body = await readBody(req);
  let parsed: { task?: string; peer?: string; wait?: boolean; timeout?: number };
  try {
    parsed = JSON.parse(body);
  } catch {
    json(res, 400, { error: "Invalid JSON body" });
    return;
  }

  if (!parsed.task || typeof parsed.task !== "string" || !parsed.task.trim()) {
    json(res, 400, { error: "task field is required" });
    return;
  }

  const config = await loadConfig();
  if (!config) {
    json(res, 500, { error: "No hh config found. Run hh onboard first." });
    return;
  }

  const peerName = parsed.peer;
  const peer = peerName
    ? findPeerByName(config, peerName)
    : getAllPeers(config)[0] ?? null;

  if (!peer) {
    json(res, 404, { error: `Peer '${peerName}' not found` });
    return;
  }

  const timeoutMs = (parsed.timeout ?? 120) * 1000;
  const wait = parsed.wait ?? false;
  const startAt = Date.now();

  try {
    const from = config.this_node.name;
    const context = await loadContextSummary(peer.name, 1).catch(() => null);
    const msg = createTaskMessage(from, peer.name, {
      objective: parsed.task,
      constraints: [],
      attachments: [],
    }, context ? { context_summary: context } : undefined);

    await createTaskState({
      id: msg.id,
      from: msg.from,
      to: msg.to,
      objective: parsed.task,
      constraints: [],
    });

    broadcastSSEServe("task_sent", { task_id: msg.id, peer: peer.name, objective: parsed.task });

    if (!peer.gateway_token) {
      await updateTaskState(msg.id, { status: "failed" });
      json(res, 500, { ok: false, task_id: msg.id, peer: peer.name, error: "Peer gateway token not configured. Run hh pair first." });
      return;
    }

    const peerIp = peer.tailscale_ip ?? peer.tailscale_hostname;
    const peerPort = peer.gateway_port ?? 18789;
    const wakeText = buildServeWakeText(from, msg.id, parsed.task);

    const wakeResult = await withRetry(() =>
      wakeAgent({
        url: `ws://${peerIp}:${peerPort}`,
        token: peer.gateway_token!,
        text: wakeText,
        mode: "now",
      })
    );

    if (!wakeResult.ok) {
      await updateTaskState(msg.id, { status: "failed" });
      broadcastSSEServe("task_failed", { task_id: msg.id, peer: peer.name });
      json(res, 502, { ok: false, task_id: msg.id, peer: peer.name, error: wakeResult.error });
      return;
    }

    if (!wait) {
      json(res, 200, {
        ok: true,
        task_id: msg.id,
        peer: peer.name,
        result: null,
        duration_ms: Date.now() - startAt,
      });
      return;
    }

    // Wait for result
    const finalState = await pollTaskCompletion(msg.id, { timeoutMs });
    broadcastSSEServe("task_completed", {
      task_id: msg.id,
      peer: peer.name,
      status: finalState?.status,
    });

    json(res, 200, {
      ok: finalState?.result?.success ?? false,
      task_id: msg.id,
      peer: peer.name,
      result: finalState?.result ?? null,
      duration_ms: Date.now() - startAt,
    });
  } catch (err) {
    json(res, 500, { ok: false, error: String(err) });
  }
}

async function handleBroadcast(
  req: IncomingMessage,
  res: ServerResponse,
  isReadonly: boolean,
): Promise<void> {
  if (isReadonly) { readonlyError(res); return; }

  const body = await readBody(req);
  let parsed: {
    task?: string;
    peers?: string[];
    strategy?: "all" | "first";
    wait?: boolean;
    timeout?: number;
  };
  try {
    parsed = JSON.parse(body);
  } catch {
    json(res, 400, { error: "Invalid JSON body" });
    return;
  }

  if (!parsed.task || typeof parsed.task !== "string") {
    json(res, 400, { error: "task field is required" });
    return;
  }

  const config = await loadConfig();
  if (!config) {
    json(res, 500, { error: "No hh config found" });
    return;
  }

  const allPeers = getAllPeers(config);
  const targetPeers = parsed.peers
    ? allPeers.filter((p) =>
        parsed.peers!.some((n) => n.toLowerCase() === p.name.toLowerCase())
      )
    : allPeers;

  if (targetPeers.length === 0) {
    json(res, 400, { error: "No matching peers found" });
    return;
  }

  const strategy = parsed.strategy ?? "all";
  const timeoutMs = (parsed.timeout ?? 120) * 1000;
  const wait = parsed.wait ?? false;
  const startAt = Date.now();
  const broadcastId = randomBytes(8).toString("hex");

  const sendToPeer = async (peer: (typeof allPeers)[0]) => {
    const from = config.this_node.name;
    const msg = createTaskMessage(from, peer.name, {
      objective: parsed.task!,
      constraints: [],
      attachments: [],
    });

    await createTaskState({
      id: msg.id,
      from: msg.from,
      to: msg.to,
      objective: parsed.task!,
      constraints: [],
    });

    if (!peer.gateway_token) {
      return { peer: peer.name, task_id: msg.id, ok: false, error: "No gateway token" };
    }
    const peerIp = peer.tailscale_ip ?? peer.tailscale_hostname;
    const wakeResult = await withRetry(() =>
      wakeAgent({
        url: `ws://${peerIp}:${peer.gateway_port ?? 18789}`,
        token: peer.gateway_token!,
        text: buildServeWakeText(config.this_node.name, msg.id, parsed.task!),
        mode: "now",
      })
    );

    if (!wakeResult.ok) {
      return { peer: peer.name, task_id: msg.id, ok: false, error: wakeResult.error };
    }

    if (!wait) {
      return { peer: peer.name, task_id: msg.id, ok: true, result: null };
    }

    const finalState = await pollTaskCompletion(msg.id, { timeoutMs });
    return {
      peer: peer.name,
      task_id: msg.id,
      ok: finalState?.result?.success ?? false,
      result: finalState?.result ?? null,
    };
  };

  if (strategy === "first") {
    // Race: return as soon as first peer responds successfully
    try {
      const result = await Promise.race(targetPeers.map(sendToPeer));
      json(res, 200, {
        broadcast_id: broadcastId,
        strategy,
        task: parsed.task,
        first_response: result,
        duration_ms: Date.now() - startAt,
      });
    } catch (err) {
      json(res, 502, { error: String(err) });
    }
  } else {
    // All: wait for all peers
    const results = await Promise.allSettled(targetPeers.map(sendToPeer));
    const outcomes = results.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : { peer: targetPeers[i]!.name, ok: false, error: String((r as PromiseRejectedResult).reason) }
    );
    const ok = outcomes.filter((o) => o.ok).length;
    json(res, 200, {
      broadcast_id: broadcastId,
      strategy,
      task: parsed.task,
      results: outcomes,
      summary: {
        total: outcomes.length,
        ok,
        failed: outcomes.length - ok,
        duration_ms: Date.now() - startAt,
      },
    });
  }
}

async function handleGetStatus(res: ServerResponse): Promise<void> {
  const config = await loadConfig();
  if (!config) {
    json(res, 500, { error: "No hh config found" });
    return;
  }

  const peers = getAllPeers(config);
  const checks = await Promise.allSettled(
    peers.map(async (peer) => {
      const peerIp = peer.tailscale_ip ?? peer.tailscale_hostname;
      const peerPort = peer.gateway_port ?? 18789;
      const [gateway, ping] = await Promise.allSettled([
        checkGatewayHealth(`http://${peerIp}:${peerPort}/health`),
        pingPeer(peerIp, 5000),
      ]);
      return {
        name: peer.name,
        gateway_healthy: gateway.status === "fulfilled" ? gateway.value : false,
        ping_reachable: ping.status === "fulfilled" ? ping.value : false,
        ping_rtt_ms: null, // pingPeer returns boolean only
      };
    })
  );

  const results = checks.map((c, i) =>
    c.status === "fulfilled"
      ? c.value
      : { name: peers[i]!.name, gateway_healthy: false, ping_reachable: false, ping_rtt_ms: null }
  );
  json(res, 200, results);
}

async function handleListPeers(res: ServerResponse): Promise<void> {
  const config = await loadConfig();
  if (!config) {
    json(res, 200, []);
    return;
  }
  const peers = getAllPeers(config).map((p) => ({
    name: p.name,
    tailscale_hostname: p.tailscale_hostname ?? p.tailscale_ip ?? null,
    gateway_port: p.gateway_port,
    ssh_user: p.ssh_user ?? null,
    wol_enabled: !!(p.wol_mac || p.wol_enabled),
  }));
  json(res, 200, peers);
}

async function handleGetPeer(name: string, res: ServerResponse): Promise<void> {
  const config = await loadConfig();
  if (!config) { notFound(res, "No config"); return; }
  const peer = findPeerByName(config, name);
  if (!peer) { notFound(res, `Peer '${name}' not found`); return; }
  json(res, 200, {
    name: peer.name,
    tailscale_hostname: peer.tailscale_hostname ?? peer.tailscale_ip ?? null,
    gateway_port: peer.gateway_port,
    ssh_user: peer.ssh_user ?? null,
    wol_enabled: !!(peer.wol_mac || peer.wol_enabled),
  });
}

async function handlePingPeer(
  name: string,
  req: IncomingMessage,
  res: ServerResponse,
  isReadonly: boolean,
): Promise<void> {
  if (isReadonly) { readonlyError(res); return; }
  const config = await loadConfig();
  if (!config) { json(res, 500, { error: "No config" }); return; }
  const peer = findPeerByName(config, name);
  if (!peer) { notFound(res, `Peer '${name}' not found`); return; }
  const peerIp = peer.tailscale_ip ?? peer.tailscale_hostname;
  const reachable = await pingPeer(peerIp, 5000).catch(() => false);
  json(res, 200, { reachable, ip: peerIp });
}

async function handleWakePeer(
  name: string,
  req: IncomingMessage,
  res: ServerResponse,
  isReadonly: boolean,
): Promise<void> {
  if (isReadonly) { readonlyError(res); return; }
  const config = await loadConfig();
  if (!config) { json(res, 500, { error: "No config" }); return; }
  const peer = findPeerByName(config, name);
  if (!peer) { notFound(res, `Peer '${name}' not found`); return; }

  if (!peer.gateway_token) {
    json(res, 500, { ok: false, error: "Peer gateway token not configured. Run hh pair first." });
    return;
  }

  const peerIp = peer.tailscale_ip ?? peer.tailscale_hostname;
  const peerPort = peer.gateway_port ?? 18789;
  // Send a minimal ping wake text to the peer gateway
  const wakeText = `[HHMessage:heartbeat from ${config.this_node.name}] ping`;
  const result = await wakeAgent({
    url: `ws://${peerIp}:${peerPort}`,
    token: peer.gateway_token,
    text: wakeText,
    mode: "now",
  }).catch((e) => ({
    ok: false,
    error: String(e),
  }));
  json(res, 200, result);
}

async function handleGetBudget(res: ServerResponse): Promise<void> {
  const summary = await buildBudgetSummary("week").catch(() => null);
  json(res, 200, summary ?? { error: "No task history found" });
}

async function handleGetCapabilities(res: ServerResponse): Promise<void> {
  // loadPeerCapabilities() reads ~/.his-and-hers/peer-capabilities.json
  // (populated by `hh capabilities fetch` — no per-peer arg in current API)
  const caps = await loadPeerCapabilities().catch(() => null);
  json(res, 200, caps ?? { error: "No cached capabilities. Run: hh capabilities fetch" });
}

function handleSSE(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  // Heartbeat every 15s to keep connection alive
  const keepAlive = setInterval(() => {
    try {
      res.write(": keep-alive\n\n");
    } catch {
      clearInterval(keepAlive);
      sseClients.delete(res);
    }
  }, 15_000);

  sseClients.add(res);
  res.write("event: connected\ndata: {\"ok\":true}\n\n");

  req.on("close", () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseSinceMs(since: string): number {
  const match = /^(\d+)(s|m|h|d|w)$/.exec(since);
  if (!match) return 0;
  const n = parseInt(match[1]!, 10);
  const unit = match[2];
  const factors: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };
  return n * (factors[unit!] ?? 0);
}

// ─── Main router ──────────────────────────────────────────────────────────────

async function router(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
  opts: ServeOptions,
  baseUrl: string,
): Promise<void> {
  const rawUrl = req.url ?? "/";
  const url = new URL(rawUrl, baseUrl);
  const method = (req.method ?? "GET").toUpperCase();
  const pathname = url.pathname.replace(/\/$/, "") || "/";

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-HH-Token",
    });
    res.end();
    return;
  }

  // No-auth endpoints
  if (pathname === "/health") {
    json(res, 200, { ok: true, service: "his-and-hers", version: API_VERSION });
    return;
  }
  if (pathname === "/openapi.json") {
    json(res, 200, buildOpenApiSpec(baseUrl));
    return;
  }
  if (pathname === "/") {
    json(res, 200, {
      service: "his-and-hers",
      version: API_VERSION,
      docs: `${baseUrl}/openapi.json`,
      endpoints: [
        "GET /health",
        "GET /openapi.json",
        "GET /peers",
        "GET /peers/:name",
        "POST /peers/:name/ping",
        "POST /peers/:name/wake",
        "GET /status",
        "GET /tasks",
        "POST /tasks",
        "GET /tasks/:id",
        "DELETE /tasks/:id",
        "POST /broadcast",
        "GET /budget",
        "GET /capabilities",
        "GET /events",
      ],
    });
    return;
  }

  // Auth check for everything else
  if (!checkAuth(req, url, token, opts.noAuth ?? false)) {
    unauthorized(res);
    return;
  }

  const isReadonly = opts.readonly ?? false;

  // Route matching
  if (pathname === "/peers" && method === "GET") {
    await handleListPeers(res);
  } else if (pathname === "/status" && method === "GET") {
    await handleGetStatus(res);
  } else if (pathname === "/tasks" && method === "GET") {
    await handleListTasks(url, res);
  } else if (pathname === "/tasks" && method === "POST") {
    await handleSendTask(req, res, isReadonly);
  } else if (pathname === "/broadcast" && method === "POST") {
    await handleBroadcast(req, res, isReadonly);
  } else if (pathname === "/budget" && method === "GET") {
    await handleGetBudget(res);
  } else if (pathname === "/capabilities" && method === "GET") {
    await handleGetCapabilities(res);
  } else if (pathname === "/events" && method === "GET") {
    handleSSE(req, res);
  } else {
    // Parameterised routes
    const peerMatch = /^\/peers\/([^/]+)$/.exec(pathname);
    const peerActionMatch = /^\/peers\/([^/]+)\/(ping|wake)$/.exec(pathname);
    const taskIdMatch = /^\/tasks\/([^/]+)$/.exec(pathname);

    if (peerMatch && method === "GET") {
      await handleGetPeer(decodeURIComponent(peerMatch[1]!), res);
    } else if (peerActionMatch && method === "POST") {
      const [, name, action] = peerActionMatch;
      if (action === "ping") {
        await handlePingPeer(decodeURIComponent(name!), req, res, isReadonly);
      } else {
        await handleWakePeer(decodeURIComponent(name!), req, res, isReadonly);
      }
    } else if (taskIdMatch && method === "GET") {
      await handleGetTask(decodeURIComponent(taskIdMatch[1]!), res);
    } else if (taskIdMatch && method === "DELETE") {
      if (isReadonly) { readonlyError(res); return; }
      await handleCancelTask(decodeURIComponent(taskIdMatch[1]!), res);
    } else {
      notFound(res);
    }
  }
}

// ─── Main entry ──────────────────────────────────────────────────────────────

export async function serve(opts: ServeOptions = {}): Promise<void> {
  const port = parseInt(opts.port ?? process.env["HH_SERVE_PORT"] ?? String(DEFAULT_PORT), 10);
  const token = opts.token ?? process.env["HH_SERVE_TOKEN"] ?? (await getOrCreateToken());
  const baseUrl = `http://localhost:${port}`;

  const server = createServer(async (req, res) => {
    try {
      await router(req, res, token, opts, baseUrl);
    } catch (err) {
      try {
        json(res, 500, { error: "Internal server error", detail: String(err) });
      } catch {
        // response already sent
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, "127.0.0.1", resolve as () => void);
    server.on("error", reject);
  });

  p.intro(`${pc.cyan("hh serve")} — REST API server`);
  p.log.success(`Listening on ${pc.bold(baseUrl)}`);
  p.log.info(`OpenAPI spec: ${pc.dim(`${baseUrl}/openapi.json`)}`);

  if (opts.noAuth) {
    p.log.warn("Auth disabled — do not expose this server publicly");
  } else {
    p.log.info(`Token: ${pc.bold(token)}`);
    p.log.info(`  X-HH-Token: ${token}`);
    p.log.info(`  or ?token=${token}`);
    p.log.info(`Token stored at: ${pc.dim(TOKEN_FILE)}`);
  }

  if (opts.readonly) {
    p.log.warn("Read-only mode — POST/DELETE endpoints disabled");
  }

  p.log.message(`\n${pc.dim("Press Ctrl+C to stop")}`);

  // Graceful shutdown
  process.on("SIGINT", () => {
    p.outro("Shutting down");
    server.close(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    server.close(() => process.exit(0));
  });

  // Keep alive
  await new Promise<never>(() => {});
}
