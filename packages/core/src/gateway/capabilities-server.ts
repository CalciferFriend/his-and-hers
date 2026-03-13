/**
 * gateway/capabilities-server.ts
 *
 * Lightweight persistent HTTP server that H2 (GLaDOS 🤖) runs to serve its
 * capability report to H1 (Calcifer 🔥).
 *
 * ## How it fits in
 *
 *   H1                                          H2
 *   ─────                                        ─────
 *   hh capabilities fetch  →  GET /capabilities ─►  capabilities-server
 *                              (X-HH-Token auth)     reads capabilities.json
 *                          ◄─  { report: HHCapabilityReport }
 *   saves peer-capabilities.json
 *   uses for routing decisions
 *
 * ## Security
 *   - Token-authenticated: every request must include X-HH-Token header
 *     or Authorization: Bearer <token>. Returns 401 on mismatch.
 *   - Read-only: only GET /capabilities and GET /health are served.
 *   - Graceful: CORS not enabled (Tailscale-only, no browser clients expected).
 *
 * ## Usage (H2 startup)
 *   Start alongside `hh watch`:
 *
 *     import { startCapabilitiesServer } from "@his-and-hers/core";
 *     const srv = await startCapabilitiesServer({ token, port: 18790 });
 *     // srv.close() to shut down
 *
 *   Or via `hh watch --serve-capabilities [port]` CLI flag (see commands/watch.ts).
 *
 * ## Endpoint
 *
 *   GET /capabilities
 *     → 200 { ok: true, report: HHCapabilityReport }
 *     → 404 { error: "no capabilities report found — run hh capabilities advertise" }
 *     → 401 { error: "unauthorized" }
 *
 *   GET /health
 *     → 200 { ok: true, service: "capabilities" }
 *     (no auth required — used by H1 for reachability checks)
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { type AddressInfo } from "node:net";
import { loadCapabilities } from "../capabilities/store.ts";

export interface CapabilitiesServerOptions {
  /** Gateway token — must match X-HH-Token header on incoming requests */
  token: string;
  /** Bind address (default: 0.0.0.0 — pin to Tailscale IP in production) */
  bindAddress?: string;
  /** Port to listen on. Use 0 for OS-assigned (default: 0) */
  port?: number;
}

export interface CapabilitiesServerHandle {
  /** Actual port the server is listening on */
  port: number;
  /** Full base URL, e.g. http://100.x.x.x:18790 */
  url: string;
  /** Gracefully close the server */
  close: () => Promise<void>;
}

/**
 * Start the capabilities HTTP server.
 *
 * @example
 * const srv = await startCapabilitiesServer({ token: "abc123", port: 18790 });
 * // Listens forever until srv.close() is called or process exits
 */
export async function startCapabilitiesServer(
  opts: CapabilitiesServerOptions,
): Promise<CapabilitiesServerHandle> {
  const { token, bindAddress = "0.0.0.0", port = 0 } = opts;

  return new Promise((resolve, reject) => {
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = req.url?.split("?")[0] ?? "/";

      // ── GET /health — no auth required ───────────────────────────────────
      if (req.method === "GET" && url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, service: "capabilities" }));
        return;
      }

      // ── All other routes require auth ─────────────────────────────────────
      const hhToken = req.headers["x-hh-token"];
      const bearerHeader = req.headers["authorization"];
      const bearerToken =
        typeof bearerHeader === "string" && bearerHeader.startsWith("Bearer ")
          ? bearerHeader.slice(7)
          : null;
      const incoming = hhToken ?? bearerToken;
      if (!incoming || incoming !== token) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      // ── GET /capabilities ─────────────────────────────────────────────────
      if (req.method === "GET" && url === "/capabilities") {
        try {
          const report = await loadCapabilities();
          if (!report) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: "no capabilities report found — run hh capabilities advertise",
              }),
            );
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, report }));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `internal error: ${msg}` }));
        }
        return;
      }

      // ── 404 fallthrough ───────────────────────────────────────────────────
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });

    server.on("error", reject);

    server.listen(port, bindAddress, () => {
      const addr = server.address() as AddressInfo;
      const actualPort = addr.port;
      const displayHost = bindAddress === "0.0.0.0" ? "127.0.0.1" : bindAddress;
      const url = `http://${displayHost}:${actualPort}`;

      const handle: CapabilitiesServerHandle = {
        port: actualPort,
        url,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      };

      resolve(handle);
    });
  });
}
