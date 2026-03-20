/**
 * core/webhook/server.ts
 *
 * Inbound webhook HTTP server.
 *
 * Listens on a configurable port and dispatches tasks to peers when
 * registered webhook paths receive POST requests.
 *
 * Features:
 *   - HMAC-SHA256 signature verification (GitHub-style) when secret is set
 *   - Template interpolation: {{body.*}}, {{headers.*}}, {{query.*}}, {{body_raw}}
 *   - Per-webhook enable/disable state
 *   - Trigger count + last_triggered_at tracking
 *   - JSON response bodies (ok/error/task_id)
 *   - Health endpoint: GET /health → { ok: true, webhooks: N }
 *   - Spec endpoint: GET /webhooks → list of registered paths (no secrets)
 *
 * Designed to run as a background daemon (`cofounder webhook start`).
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type Server,
} from "node:http";
import { parse as parseUrl } from "node:url";
import { loadWebhooks, recordWebhookTrigger, findWebhookByPath } from "./store.ts";
import { interpolateTemplate } from "./interpolate.ts";
import { verifyHmacSignature } from "./hmac.ts";
import type { WebhookRequestContext, WebhookDeliveryResult, HHWebhook } from "./schema.ts";

export const DEFAULT_WEBHOOK_PORT = 3848;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WebhookServerOptions {
  port?: number;
  /** Override base dir for loading webhook config (for tests) */
  baseDir?: string;
  /**
   * Dispatch function — called when a webhook fires with the interpolated task.
   * In production this calls wakeAgent; in tests it can be stubbed.
   */
  dispatch?: (task: string, peer: string | undefined) => Promise<{ ok: boolean; task_id?: string; error?: string }>;
  /** If true, suppress console output (for tests) */
  silent?: boolean;
}

export interface WebhookServerHandle {
  server: Server;
  port: number;
  close: () => Promise<void>;
}

// ─── Body reader ─────────────────────────────────────────────────────────────

const MAX_BODY_BYTES = 1_000_000; // 1 MB

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("Request body too large (max 1 MB)"));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

// ─── Query string parser ──────────────────────────────────────────────────────

function parseQuery(search: string | null | undefined): Record<string, string> {
  if (!search) return {};
  const result: Record<string, string> = {};
  const params = new URLSearchParams(search);
  for (const [k, v] of params.entries()) {
    result[k] = v;
  }
  return result;
}

// ─── Response helpers ─────────────────────────────────────────────────────────

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

// ─── Request handler ──────────────────────────────────────────────────────────

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: WebhookServerOptions,
): Promise<void> {
  const parsed = parseUrl(req.url ?? "/");
  const pathname = parsed.pathname ?? "/";
  const query = parseQuery(parsed.search);
  const method = req.method?.toUpperCase() ?? "GET";

  // ── Health check ──
  if (method === "GET" && pathname === "/health") {
    const webhooks = await loadWebhooks(opts.baseDir);
    json(res, 200, { ok: true, webhooks: webhooks.length });
    return;
  }

  // ── Webhook listing (no secrets exposed) ──
  if (method === "GET" && pathname === "/webhooks") {
    const webhooks = await loadWebhooks(opts.baseDir);
    json(res, 200, {
      webhooks: webhooks.map((w) => ({
        id: w.id.slice(0, 8),
        path: w.path,
        name: w.name ?? null,
        peer: w.peer ?? null,
        enabled: w.enabled,
        trigger_count: w.trigger_count,
        last_triggered_at: w.last_triggered_at,
      })),
    });
    return;
  }

  // ── Webhook dispatch ──
  if (method !== "POST") {
    json(res, 405, { ok: false, error: "Method not allowed. Use POST." });
    return;
  }

  // Read body first (needed for HMAC)
  let bodyRaw: string;
  try {
    bodyRaw = await readBody(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to read body";
    json(res, 400, { ok: false, error: msg });
    return;
  }

  // Find matching webhook
  const webhooks = await loadWebhooks(opts.baseDir);
  const webhook = findWebhookByPath(webhooks, pathname);

  if (!webhook) {
    json(res, 404, { ok: false, error: `No webhook registered for path: ${pathname}` });
    return;
  }

  // HMAC verification
  if (webhook.secret) {
    const sigHeader = webhook.secret_header ?? "X-Hub-Signature-256";
    const sig = req.headers[sigHeader.toLowerCase()] as string | undefined;

    if (!sig) {
      json(res, 401, {
        ok: false,
        error: `Missing signature header: ${sigHeader}`,
      });
      return;
    }

    if (!verifyHmacSignature(webhook.secret, bodyRaw, sig)) {
      json(res, 401, { ok: false, error: "Invalid signature" });
      return;
    }
  }

  // Parse body as JSON (graceful fallback to empty object)
  let body: Record<string, unknown> = {};
  if (bodyRaw.trim()) {
    try {
      const parsed2 = JSON.parse(bodyRaw);
      if (typeof parsed2 === "object" && parsed2 !== null && !Array.isArray(parsed2)) {
        body = parsed2 as Record<string, unknown>;
      }
    } catch {
      // Non-JSON body — body stays {}; body_raw is still available in template
    }
  }

  // Build headers map (lowercase keys)
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers[k.toLowerCase()] = v;
    else if (Array.isArray(v)) headers[k.toLowerCase()] = v[0] ?? "";
  }

  // Interpolate task template
  const ctx: WebhookRequestContext = {
    body,
    headers,
    query,
    body_raw: bodyRaw,
    webhook,
  };

  const task = interpolateTemplate(webhook.task_template, ctx);

  if (!opts.silent) {
    const label = webhook.name ?? webhook.path;
    console.log(`[cofounder webhook] ${label} → ${task.slice(0, 80)}${task.length > 80 ? "…" : ""}`);
  }

  // Dispatch
  let result: WebhookDeliveryResult;
  if (opts.dispatch) {
    const dispatchResult = await opts.dispatch(task, webhook.peer);
    result = {
      ok: dispatchResult.ok,
      task_id: dispatchResult.task_id,
      peer: webhook.peer,
      task,
      error: dispatchResult.error,
    };
  } else {
    // No dispatch function — for embedded use
    result = { ok: true, task, peer: webhook.peer };
  }

  // Record trigger
  if (result.ok) {
    await recordWebhookTrigger(webhook.id, opts.baseDir);
  }

  const status = result.ok ? 200 : 500;
  json(res, status, result);
}

// ─── Server factory ───────────────────────────────────────────────────────────

/**
 * Start the inbound webhook HTTP server.
 * Returns a handle with close() for graceful shutdown.
 */
export function startWebhookServer(
  opts: WebhookServerOptions = {},
): Promise<WebhookServerHandle> {
  const port = opts.port ?? DEFAULT_WEBHOOK_PORT;

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      handleRequest(req, res, opts).catch((err) => {
        if (!opts.silent) {
          console.error("[cofounder webhook] Unhandled error:", err);
        }
        if (!res.headersSent) {
          json(res, 500, { ok: false, error: "Internal server error" });
        }
      });
    });

    server.on("error", reject);

    server.listen(port, "127.0.0.1", () => {
      if (!opts.silent) {
        console.log(`[cofounder webhook] listening on http://127.0.0.1:${port}`);
      }
      resolve({
        server,
        port,
        close: () =>
          new Promise<void>((res2, rej2) =>
            server.close((err) => (err ? rej2(err) : res2())),
          ),
      });
    });
  });
}
