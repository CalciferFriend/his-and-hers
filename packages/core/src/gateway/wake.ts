/**
 * gateway/wake.ts
 *
 * Sends a wake (system event injection) to a remote OpenClaw gateway
 * over the WebSocket protocol.
 *
 * Reverse-engineered from the OpenClaw gateway protocol on 2026-03-11.
 * See: docs/reference/calcifer-glados.md for the full discovery notes.
 *
 * Protocol summary:
 *   1. Connect → server sends connect.challenge
 *   2. Client sends req(method: "connect") with auth + client params
 *   3. Server responds res(ok, payload: { type: "hello-ok" })
 *   4. Client sends req(method: "wake", params: { text, mode })
 *   5. Server responds res(ok: true) — message injected into active session
 *
 * Key gotchas discovered the hard way:
 *   - client.mode must be "cli" (not "operator" — enum in GATEWAY_CLIENT_MODES)
 *   - client.id must be "cli" (see GATEWAY_CLIENT_IDS in bundled source)
 *   - scopes must include "operator.admin" for the wake method
 *   - the method is "wake", NOT "cron.wake" (that doesn't exist)
 */

import WebSocket from "ws";

export interface WakeOptions {
  /** WebSocket URL, e.g. ws://100.119.44.38:18789 */
  url: string;
  /** Auth token from gateway.auth.token in openclaw.json */
  token: string;
  /** Message to inject into the agent's session */
  text: string;
  /** "now" (immediate) or "next-heartbeat" */
  mode?: "now" | "next-heartbeat";
  /** Timeout in ms (default: 10000) */
  timeoutMs?: number;
}

export interface WakeResult {
  ok: boolean;
  error?: string;
}

/**
 * Wake a remote OpenClaw agent by injecting a system event into its active session.
 *
 * @example
 * // H1 (Calcifer 🔥) sends a task to H2 (GLaDOS 🤖)
 * const result = await wakeAgent({
 *   url: "ws://100.119.44.38:18789",
 *   token: process.env.GLADOS_GATEWAY_TOKEN!,
 *   text: "[From Calcifer] Please run inference on attached prompt.",
 *   mode: "now",
 * });
 */
export async function wakeAgent(opts: WakeOptions): Promise<WakeResult> {
  const { url, token, text, mode = "now", timeoutMs = 10_000 } = opts;

  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let reqId = 1;
    let resolved = false;

    const finish = (result: WakeResult) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      ws.close();
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, error: "timeout" });
    }, timeoutMs);

    ws.on("message", (raw: import("ws").RawData) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      // Step 1: Server sends challenge → we respond with connect request
      if (msg["type"] === "event" && msg["event"] === "connect.challenge") {
        ws.send(
          JSON.stringify({
            type: "req",
            id: String(reqId++),
            method: "connect",
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              // client.id and client.mode are validated against GATEWAY_CLIENT_IDS
              // and GATEWAY_CLIENT_MODES enums in the gateway source.
              // "cli" + "cli" is the correct combo for operator access.
              client: {
                id: "cli",
                version: "2026.3.7",
                platform: process.platform,
                mode: "cli",
              },
              role: "operator",
              // operator.admin is required for the "wake" method
              scopes: ["operator.read", "operator.write", "operator.admin"],
              caps: [],
              commands: [],
              permissions: {},
              auth: { token },
              locale: "en-US",
              userAgent: "cofounder/0.1.0",
            },
          }),
        );
        return;
      }

      if (msg["type"] === "res") {
        const payload = msg["payload"] as Record<string, unknown> | undefined;
        const ok = msg["ok"] as boolean;

        // Step 2: hello-ok → send the wake, tracking its request id.
        // GLaDOS review (2026-03-11): don't resolve on any res — track the
        // wake request id specifically so we don't exit early if the gateway
        // emits other replies between connect and the wake acknowledgement.
        if (ok && payload?.["type"] === "hello-ok") {
          const wakeReqId = String(reqId++);
          ws.send(
            JSON.stringify({
              type: "req",
              id: wakeReqId,
              method: "wake",
              params: { text, mode },
            }),
          );
          // Swap to a targeted handler for the wake response
          const origOnMessage = ws.listeners("message").pop() as ((raw: Buffer) => void) | undefined;
          if (origOnMessage) ws.off("message", origOnMessage);
          ws.on("message", (raw2: Buffer) => {
            let reply: Record<string, unknown>;
            try { reply = JSON.parse(raw2.toString()); } catch { return; }
            if (reply["type"] === "res" && reply["id"] === wakeReqId) {
              if (reply["ok"]) {
                finish({ ok: true });
              } else {
                const err = reply["error"] as Record<string, string> | undefined;
                finish({ ok: false, error: err?.["message"] ?? "wake failed" });
              }
            }
          });
          return;
        }

        // Step 3: any other error response before wake
        if (!ok) {
          const err = msg["error"] as Record<string, string> | undefined;
          finish({ ok: false, error: err?.["message"] ?? "unknown error" });
        }
      }
    });

    ws.on("error", (err: Error) => {
      finish({ ok: false, error: err.message });
    });

    ws.on("close", (code: number) => {
      if (!resolved) {
        finish({ ok: false, error: `connection closed: ${code}` });
      }
    });
  });
}
