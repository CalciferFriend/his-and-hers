/**
 * result-server.test.ts — Unit tests for Phase 5d webhook result server
 */

import { describe, it, expect, vi } from "vitest";
import { startResultServer, type ResultWebhookPayload } from "./result-server.ts";

// Minimal HTTP POST helper (no external deps)
async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  const { request } = await import("node:http");
  const parsed = new URL(url);
  const bodyStr = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: parsed.hostname,
        port: parseInt(parsed.port, 10),
        path: parsed.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(bodyStr),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}

const TASK_ID = "test-task-abc123";
const TOKEN = "test-gateway-token";

describe("startResultServer", () => {
  it("starts a server and returns a URL on localhost", async () => {
    const handle = await startResultServer({
      taskId: TASK_ID,
      token: TOKEN,
      bindAddress: "127.0.0.1",
      timeoutMs: 5_000,
    });

    expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/result$/);
    expect(handle.port).toBeGreaterThan(0);
    handle.close();
  });

  it("accepts a valid result payload and resolves waitForResult", async () => {
    const handle = await startResultServer({
      taskId: TASK_ID,
      token: TOKEN,
      bindAddress: "127.0.0.1",
      timeoutMs: 5_000,
    });

    const payload: ResultWebhookPayload = {
      task_id: TASK_ID,
      output: "Here is the result",
      success: true,
      tokens_used: 1234,
      cost_usd: 0.002,
    };

    const [res, webhookResult] = await Promise.all([
      post(handle.url, payload, { "X-TJ-Token": TOKEN }),
      handle.waitForResult(),
    ]);

    expect(res.status).toBe(200);
    expect(webhookResult).not.toBeNull();
    expect(webhookResult!.output).toBe("Here is the result");
    expect(webhookResult!.success).toBe(true);
    expect(webhookResult!.tokens_used).toBe(1234);
  });

  it("rejects requests with wrong token (401)", async () => {
    const handle = await startResultServer({
      taskId: TASK_ID,
      token: TOKEN,
      bindAddress: "127.0.0.1",
      timeoutMs: 5_000,
    });

    const res = await post(
      handle.url,
      { task_id: TASK_ID, output: "x", success: true },
      { "X-TJ-Token": "wrong-token" },
    );

    expect(res.status).toBe(401);
    handle.close();
  });

  it("rejects requests with mismatched task_id (400)", async () => {
    const handle = await startResultServer({
      taskId: TASK_ID,
      token: TOKEN,
      bindAddress: "127.0.0.1",
      timeoutMs: 5_000,
    });

    const res = await post(
      handle.url,
      { task_id: "different-task", output: "x", success: true },
      { "X-TJ-Token": TOKEN },
    );

    expect(res.status).toBe(409);
    handle.close();
  });

  it("rejects non-POST requests with 404", async () => {
    const handle = await startResultServer({
      taskId: TASK_ID,
      token: TOKEN,
      bindAddress: "127.0.0.1",
      timeoutMs: 5_000,
    });

    const { request } = await import("node:http");
    const parsed = new URL(handle.url);

    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        { hostname: parsed.hostname, port: parseInt(parsed.port, 10), path: parsed.pathname, method: "GET" },
        (res) => resolve(res.statusCode ?? 0),
      );
      req.on("error", reject);
      req.end();
    });

    expect(status).toBe(404);
    handle.close();
  });

  it("returns null from waitForResult on timeout", async () => {
    const handle = await startResultServer({
      taskId: TASK_ID,
      token: TOKEN,
      bindAddress: "127.0.0.1",
      timeoutMs: 100, // very short timeout
    });

    const result = await handle.waitForResult();
    expect(result).toBeNull();
  });

  it("closes server after receiving result (one-shot)", async () => {
    const handle = await startResultServer({
      taskId: TASK_ID,
      token: TOKEN,
      bindAddress: "127.0.0.1",
      timeoutMs: 5_000,
    });

    const payload: ResultWebhookPayload = {
      task_id: TASK_ID,
      output: "done",
      success: true,
    };

    const [, _result] = await Promise.all([
      post(handle.url, payload, { "X-TJ-Token": TOKEN }),
      handle.waitForResult(),
    ]);

    // After the server closes, further requests should fail (ECONNREFUSED)
    await expect(
      post(handle.url, payload, { "X-TJ-Token": TOKEN }),
    ).rejects.toThrow();
  });
});

describe("parseWebhookUrl", () => {
  it("extracts webhook URL from wake message", async () => {
    const { parseWebhookUrl } = await import("./result-server.ts");
    const msg = `[HHMessage:task from Calcifer id=abc] do something\n\nWhen done, run: tj result abc "..."\n\nTJ-Result-Webhook: http://100.116.25.69:38791/result\nTJ-Result-Token: (use your token)`;
    expect(parseWebhookUrl(msg)).toBe("http://100.116.25.69:38791/result");
  });

  it("returns null when no webhook URL present", async () => {
    const { parseWebhookUrl } = await import("./result-server.ts");
    const msg = `[HHMessage:task from Calcifer id=abc] do something`;
    expect(parseWebhookUrl(msg)).toBeNull();
  });
});
