/**
 * gateway/stream-server.ts
 *
 * Lightweight H1-side streaming chunk receiver.
 *
 * While H2 processes a delegated task, it periodically POSTs stdout chunks
 * back here so `cofounder send --wait` can display partial output in real-time —
 * instead of waiting silently until the task finishes.
 *
 * ## How it works
 *
 *   H1                                          H2
 *   ─────                                        ─────
 *   startStreamServer()  →  starts server        receives wake msg with HH-Stream-URL
 *   POST /stream (chunks arrive)  ←─────────    executor stdout → postChunk() calls
 *   EventEmitter fires "chunk" events            final chunk has done: true
 *   server auto-closes after done/timeout        continues to POST /result
 *
 * ## Security
 *   - Token-authenticated: every request must include X-HH-Token header
 *   - Task ID scoped: rejects chunks for wrong task IDs
 *   - Auto-closes after `done: true` chunk OR timeout (default: 300s)
 *
 * ## Integration with send.ts
 *   1. Start stream server before delivering task:
 *        const streamHandle = await startStreamServer({ taskId, token, bindAddress })
 *   2. Include stream URL in wake message:
 *        `HH-Stream-URL: ${streamHandle.url}`
 *   3. Display chunks as they arrive:
 *        streamHandle.on("chunk", (chunk) => process.stdout.write(chunk))
 *   4. Wait for stream to finish:
 *        await streamHandle.done  // resolves when done:true arrives or timeout
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import { AddressInfo } from "node:net";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StreamChunkPayload {
  /** Task ID this chunk belongs to */
  task_id: string;
  /** Monotonic sequence number (0-indexed) */
  seq: number;
  /** Partial output text */
  chunk: string;
  /** Set true on the final chunk — server closes after this */
  done?: boolean;
}

export interface StreamServerOptions {
  /** Task ID to accept chunks for (rejects mismatched IDs) */
  taskId: string;
  /** Shared secret — must match in X-HH-Token header */
  token: string;
  /** Bind address (default: 0.0.0.0) */
  bindAddress?: string;
  /** Port to listen on (default: 0 = OS-assigned) */
  port?: number;
  /** How long to wait before auto-closing the server (default: 300_000ms) */
  timeoutMs?: number;
}

export interface StreamServerHandle extends EventEmitter {
  /** Full URL H2 should POST chunks to, e.g. http://100.116.25.69:39200/stream */
  url: string;
  /** Actual port the server is listening on */
  port: number;
  /**
   * Resolves when a chunk with `done: true` arrives, or when timeout fires.
   * Never rejects.
   */
  done: Promise<void>;
  /** Force-close the server */
  close: () => void;
}

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Start a streaming chunk receiver server.
 *
 * @example
 * const stream = await startStreamServer({
 *   taskId: msg.id,
 *   token: gatewayToken,
 *   bindAddress: "100.116.25.69",
 * });
 *
 * stream.on("chunk", (chunk: string) => process.stdout.write(chunk));
 * await stream.done;
 */
export async function startStreamServer(
  opts: StreamServerOptions,
): Promise<StreamServerHandle> {
  const {
    taskId,
    token,
    bindAddress = "0.0.0.0",
    port = 0,
    timeoutMs = 300_000,
  } = opts;

  return new Promise<StreamServerHandle>((resolveHandle, rejectHandle) => {
    const emitter = new EventEmitter() as StreamServerHandle;

    let doneResolve!: () => void;
    const donePromise = new Promise<void>((res) => { doneResolve = res; });

    let serverTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const closeServer = () => {
      if (closed) return;
      closed = true;
      if (serverTimer) {
        clearTimeout(serverTimer);
        serverTimer = null;
      }
      server.close();
      doneResolve();
    };

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      // Only POST /stream accepted
      if (req.method !== "POST" || !req.url?.startsWith("/stream")) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }

      // Token authentication
      const cfToken = req.headers["x-cofounder-token"];
      const bearerHeader = req.headers["authorization"];
      const bearerToken =
        typeof bearerHeader === "string" && bearerHeader.startsWith("Bearer ")
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
        let payload: StreamChunkPayload;
        try {
          payload = JSON.parse(
            Buffer.concat(chunks).toString("utf8"),
          ) as StreamChunkPayload;
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid JSON" }));
          return;
        }

        // Task ID guard
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

        // Ack first, then emit (non-blocking for H2)
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, seq: payload.seq }));

        // Emit chunk to consumers
        if (payload.chunk) {
          emitter.emit("chunk", payload.chunk, payload.seq);
        }

        // Final chunk — close the server
        if (payload.done) {
          emitter.emit("done");
          closeServer();
        }
      });

      req.on("error", () => {
        res.writeHead(500).end();
      });
    });

    server.on("error", (err: Error) => {
      if (!closed) {
        rejectHandle(err);
      }
    });

    server.listen(port, bindAddress, () => {
      const addr = server.address() as AddressInfo;
      const actualPort = addr.port;
      const displayAddr = bindAddress === "0.0.0.0" ? "127.0.0.1" : bindAddress;
      const url = `http://${displayAddr}:${actualPort}/stream`;

      // Start timeout
      serverTimer = setTimeout(() => {
        emitter.emit("timeout");
        closeServer();
      }, timeoutMs);

      // Wire up the StreamServerHandle interface
      emitter.url = url;
      emitter.port = actualPort;
      emitter.done = donePromise;
      emitter.close = closeServer;

      resolveHandle(emitter);
    });
  });
}

// ─── Parse helpers (used by watch.ts to extract URLs from wake messages) ──────

/**
 * Parses the HH-Stream-URL from a wake message.
 *
 * Wake message format:
 *   HH-Stream-URL: http://100.116.25.69:39200/stream
 *
 * @returns stream URL, or null if not present
 */
export function parseStreamUrl(wakeText: string): string | null {
  const match = wakeText.match(/HH-Stream-URL:\s*(https?:\/\/\S+)/);
  return match?.[1] ?? null;
}

/**
 * Parses the HH-Stream-Token from a wake message.
 *
 * @returns token string, or null if not present
 */
export function parseStreamToken(wakeText: string): string | null {
  const match = wakeText.match(/HH-Stream-Token:\s*(\S+)/);
  return match?.[1] ?? null;
}
