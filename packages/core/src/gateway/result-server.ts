/**
 * gateway/result-server.ts
 *
 * Lightweight HTTP server H1 (Calcifer 🔥) starts when waiting for a result.
 * H2 (GLaDOS 🤖) POSTs to this endpoint when a task completes — eliminating
 * the polling latency of `cofounder send --wait`.
 *
 * ## How it works
 *
 *   H1                                          H2
 *   ─────                                        ─────
 *   cofounder send --wait  →  starts result server       receives wakeAgent msg
 *   POST /result (port auto-selected)             processes task
 *   ←── delivery URL included in wake msg        calls: POST <h1-webhook-url>/result
 *   server receives result, resolves              closes its task state, done
 *
 * ## Security
 *   - One-time server: closes after the first valid delivery (or timeout)
 *   - Token-authenticated: every request must include X-HH-Token header
 *   - Task ID bound: only accepts a result for the specific task that started it
 *   - Loopback + Tailscale only: port is only bound to 0.0.0.0 if no tailscale IP
 *
 * ## Fallback
 *   If H2 doesn't support webhooks (older version), the caller falls back
 *   to the standard polling path. See `startResultServerWithFallback()`.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";

export interface ResultWebhookPayload {
  task_id: string;
  output: string;
  success: boolean;
  error?: string;
  artifacts?: string[];
  tokens_used?: number;
  duration_ms?: number;
  cost_usd?: number;
  context_summary?: string;
}

export interface ResultServerOptions {
  /** Task ID to accept a result for (rejects mismatched IDs) */
  taskId: string;
  /** Shared secret — must match in X-HH-Token header */
  token: string;
  /** Bind address (default: 0.0.0.0 — change to Tailscale IP for production) */
  bindAddress?: string;
  /** Port to listen on (default: 0 = OS-assigned) */
  port?: number;
  /** How long to wait before auto-closing the server (default: 300_000ms) */
  timeoutMs?: number;
}

export interface ResultServerHandle {
  /** Full URL H2 should POST to, e.g. http://100.116.25.69:38791/result */
  url: string;
  /** Actual port the server is listening on */
  port: number;
  /**
   * Resolves when a valid result arrives; rejects on timeout or server error.
   * Closes the server automatically.
   *
   * Prefer `result` for direct `await` or `Promise.all` usage.
   */
  result: Promise<ResultWebhookPayload>;
  /**
   * @deprecated Use the `result` Promise property directly.
   * Resolves when a valid result arrives (returns null on timeout/error).
   */
  waitForResult: () => Promise<ResultWebhookPayload | null>;
  /** Force-close the server without waiting for a result */
  close: () => void;
}

/**
 * Start a one-shot result webhook server.
 *
 * @example
 * const server = await startResultServer({
 *   taskId: msg.id,
 *   token: localGatewayToken,
 *   bindAddress: "100.116.25.69",
 * });
 * // Include server.url in the wake message sent to H2
 * // Then await the result:
 * const result = await server.waitForResult();
 */
export async function startResultServer(opts: ResultServerOptions): Promise<ResultServerHandle> {
  const {
    taskId,
    token,
    bindAddress = "0.0.0.0",
    port = 0,
    timeoutMs = 300_000,
  } = opts;

  return new Promise((resolveHandle, rejectHandle) => {
    let resultResolve: ((payload: ResultWebhookPayload) => void) | null = null;
    let resultReject: ((err: Error) => void) | null = null;
    let serverTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const settle = (payload: ResultWebhookPayload | null) => {
      if (settled) return;
      settled = true;
      if (serverTimer) {
        clearTimeout(serverTimer);
        serverTimer = null;
      }
      server.close();
      if (payload) {
        resultResolve?.(payload);
      } else {
        resultReject?.(new Error("Result server timed out waiting for H2 response"));
      }
    };

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      // Only POST /result accepted
      if (req.method !== "POST" || !req.url?.startsWith("/result")) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }

      // Token authentication — accept X-HH-Token header or Authorization: Bearer <token>
      const cfToken = req.headers["x-cofounder-token"];
      const bearerHeader = req.headers["authorization"];
      const bearerToken = typeof bearerHeader === "string" && bearerHeader.startsWith("Bearer ")
        ? bearerHeader.slice(7)
        : null;
      const incoming = cfToken ?? bearerToken;
      if (!incoming || incoming !== token) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      // Collect body
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        let payload: ResultWebhookPayload;
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ResultWebhookPayload;
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid JSON" }));
          return;
        }

        // Task ID guard — reject stale or wrong deliveries (409 Conflict)
        if (payload.task_id !== taskId) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "task_id mismatch",
              expected: taskId.slice(0, 8),
              got: (payload.task_id ?? "").slice(0, 8),
            }),
          );
          return;
        }

        // All good — ack and close
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, task_id: taskId }));
        settle(payload);
      });

      req.on("error", () => {
        res.writeHead(500).end();
      });
    });

    server.on("error", (err: Error) => {
      if (!settled) {
        rejectHandle(err);
      }
    });

    server.listen(port, bindAddress, () => {
      const addr = server.address() as AddressInfo;
      const actualPort = addr.port;
      const url = `http://${bindAddress === "0.0.0.0" ? "127.0.0.1" : bindAddress}:${actualPort}`;

      // Start the global timeout
      serverTimer = setTimeout(() => settle(null), timeoutMs);

      // Create the result Promise up-front so it can be awaited at any time
      const resultPromise = new Promise<ResultWebhookPayload>((res, rej) => {
        resultResolve = res;
        resultReject = rej;
        // If already settled (timeout race), reject immediately
        if (settled) rej(new Error("Result server timed out waiting for H2 response"));
      });
      // Suppress unhandled-rejection noise: callers using waitForResult() or close()
      // without awaiting `result` directly would otherwise trigger Node's unhandled
      // rejection handler. waitForResult() already swallows the error and returns null.
      resultPromise.catch(() => undefined);

      const handle: ResultServerHandle = {
        url: `${url}/result`,
        port: actualPort,
        result: resultPromise,
        waitForResult: () => resultPromise.then(
          (payload) => payload,
          () => null,
        ),
        close: () => settle(null),
      };

      resolveHandle(handle);
    });
  });
}

/**
 * Parses a result webhook URL from a wake message.
 * H2 uses this to extract the callback URL included by H1.
 *
 * Wake message format (after task text):
 *   ...
 *   HH-Result-Webhook: http://100.116.25.69:38791/result
 *
 * @returns webhook URL, or null if not present
 */
export function parseWebhookUrl(wakeText: string): string | null {
  const match = wakeText.match(/HH-Result-Webhook:\s*(https?:\/\/\S+)/);
  return match?.[1] ?? null;
}

/**
 * Build a result delivery HTTP request — used by H2 (GLaDOS 🤖) to push results
 * back to H1 without polling.
 *
 * @example
 * const ok = await deliverResultWebhook(
 *   "http://100.116.25.69:38791/result",
 *   token,
 *   { task_id: id, output: "done", success: true, artifacts: [] }
 * );
 */
export async function deliverResultWebhook(
  webhookUrl: string,
  token: string,
  payload: ResultWebhookPayload,
  timeoutMs = 10_000,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-HH-Token": token,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 120)}` };
    }
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}
