/**
 * gateway/mock-gateway.ts
 *
 * A mock OpenClaw WebSocket gateway for E2E and integration testing.
 *
 * Implements the minimal subset of the OpenClaw gateway protocol needed to
 * test wakeAgent(), cofounder send, cofounder pipeline, and cofounder workflow without a real
 * network or real OpenClaw installation.
 *
 * Protocol summary (reverse-engineered from wake.ts + production observation):
 *   1. Client connects
 *   2. Server sends: { type: "event", event: "connect.challenge" }
 *   3. Client sends: { type: "req", id: "1", method: "connect", params: { auth: { token } } }
 *   4. Server sends: { type: "res", id: "1", ok: true, payload: { type: "hello-ok" } }
 *   5. Client sends: { type: "req", id: "2", method: "wake", params: { text, mode } }
 *   6. Server sends: { type: "res", id: "2", ok: true }
 *
 * ## Usage in tests
 *
 * ```ts
 * import { MockGateway } from "./mock-gateway.ts";
 *
 * const gw = new MockGateway({ token: "test-token" });
 * await gw.start();
 *
 * const result = await wakeAgent({ url: gw.url, token: "test-token", text: "hello" });
 * expect(result.ok).toBe(true);
 * expect(gw.receivedWakes).toHaveLength(1);
 *
 * await gw.stop();
 * ```
 *
 * Phase 8d — Calcifer ✅ (2026-03-15)
 */

import { WebSocketServer, WebSocket } from "ws";
import { EventEmitter } from "node:events";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MockGatewayOptions {
  /** Auth token clients must present to connect successfully */
  token: string;
  /** Port to listen on (default: 0 = OS-assigned) */
  port?: number;
  /** Bind host (default: "127.0.0.1") */
  host?: string;
  /**
   * If true, refuse the connect handshake with an auth error.
   * Useful for testing retry logic and auth-failure paths.
   */
  rejectAuth?: boolean;
  /**
   * If true, close the connection immediately after the client connects,
   * without sending the challenge. Tests connection-refused / WS error paths.
   */
  dropConnection?: boolean;
  /**
   * If set, delay the hello-ok response by this many ms.
   * Lets tests exercise the timeout path in wakeAgent().
   */
  helloDelayMs?: number;
  /**
   * If set, delay the wake ACK response by this many ms.
   */
  wakeDelayMs?: number;
}

export interface ReceivedWake {
  /** Raw text injected via the wake method */
  text: string;
  /** Delivery mode: "now" | "next-heartbeat" */
  mode: string;
  /** Wall-clock time the wake arrived */
  receivedAt: Date;
  /** All params from the wake request */
  params: Record<string, unknown>;
}

// ─── MockGateway ─────────────────────────────────────────────────────────────

/**
 * Lightweight in-process mock of the OpenClaw WebSocket gateway.
 *
 * Start it, point wakeAgent (or `cofounder send`) at `gw.url`, and inspect
 * `gw.receivedWakes` to assert what was delivered.
 *
 * Emits:
 *   "wake"       (wake: ReceivedWake)  — each time a wake request is received
 *   "connect"    ()                    — after a client handshake completes
 *   "disconnect" ()                    — after a WS connection closes
 */
export class MockGateway extends EventEmitter {
  private opts: Required<MockGatewayOptions>;
  private wss: WebSocketServer | null = null;
  private _port = 0;
  readonly receivedWakes: ReceivedWake[] = [];

  constructor(opts: MockGatewayOptions) {
    super();
    this.opts = {
      port: 0,
      host: "127.0.0.1",
      rejectAuth: false,
      dropConnection: false,
      helloDelayMs: 0,
      wakeDelayMs: 0,
      ...opts,
    };
  }

  /** The port the server is actually listening on (valid after start()). */
  get port(): number {
    return this._port;
  }

  /** ws:// URL to pass into wakeAgent (valid after start()). */
  get url(): string {
    return `ws://${this.opts.host}:${this._port}`;
  }

  /** Start the mock gateway server. Resolves when the port is bound. */
  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const wss = new WebSocketServer({
        host: this.opts.host,
        port: this.opts.port,
      });

      wss.on("error", reject);

      wss.on("listening", () => {
        this._port = (wss.address() as { port: number }).port;
        wss.removeListener("error", reject);
        resolve();
      });

      wss.on("connection", (ws) => this._handleConnection(ws));

      this.wss = wss;
    });
  }

  /** Stop the mock gateway, closing all connections. */
  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.wss) return resolve();
      this.wss.close(() => resolve());
      // Force-close any lingering connections
      this.wss.clients.forEach((c) => c.terminate());
    });
    this.wss = null;
  }

  /** Clear accumulated wake history. */
  clearWakes(): void {
    this.receivedWakes.splice(0, this.receivedWakes.length);
  }

  // ─── Private: protocol implementation ──────────────────────────────────────

  private _handleConnection(ws: WebSocket): void {
    const { dropConnection, rejectAuth, helloDelayMs, wakeDelayMs, token } =
      this.opts;

    if (dropConnection) {
      ws.terminate();
      return;
    }

    // Step 1: send challenge
    ws.send(JSON.stringify({ type: "event", event: "connect.challenge" }));

    ws.on("message", (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        return;
      }

      if (msg["type"] !== "req") return;
      const id = String(msg["id"]);
      const method = String(msg["method"]);

      if (method === "connect") {
        // Validate auth token
        const params = msg["params"] as Record<string, unknown> | undefined;
        const authToken = (params?.["auth"] as Record<string, string> | undefined)?.["token"];

        if (rejectAuth || authToken !== token) {
          ws.send(
            JSON.stringify({
              type: "res",
              id,
              ok: false,
              error: { message: "auth failed: invalid token" },
            }),
          );
          return;
        }

        // Optionally delay hello-ok
        const sendHello = () => {
          ws.send(
            JSON.stringify({
              type: "res",
              id,
              ok: true,
              payload: { type: "hello-ok" },
            }),
          );
          this.emit("connect");
        };

        if (helloDelayMs > 0) {
          setTimeout(sendHello, helloDelayMs);
        } else {
          sendHello();
        }
        return;
      }

      if (method === "wake") {
        const params = (msg["params"] as Record<string, unknown>) ?? {};
        const wake: ReceivedWake = {
          text: String(params["text"] ?? ""),
          mode: String(params["mode"] ?? "now"),
          receivedAt: new Date(),
          params,
        };
        this.receivedWakes.push(wake);
        this.emit("wake", wake);

        const sendAck = () => {
          ws.send(JSON.stringify({ type: "res", id, ok: true }));
        };

        if (wakeDelayMs > 0) {
          setTimeout(sendAck, wakeDelayMs);
        } else {
          sendAck();
        }
        return;
      }

      // Unknown method → generic error
      ws.send(
        JSON.stringify({
          type: "res",
          id,
          ok: false,
          error: { message: `unknown method: ${method}` },
        }),
      );
    });

    ws.on("close", () => this.emit("disconnect"));
  }
}
