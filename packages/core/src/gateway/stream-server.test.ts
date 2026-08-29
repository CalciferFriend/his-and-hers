/**
 * stream-server.test.ts — Unit tests for H1-side streaming chunk receiver
 * and H2-side stream client helpers.
 */

import { describe, it, expect } from "vitest";
import {
  startStreamServer,
  parseStreamUrl,
  parseStreamToken,
  type StreamChunkPayload,
} from "./stream-server.ts";
import { postChunk, createChunkStreamer } from "./stream-client.ts";

// ─── HTTP helper ─────────────────────────────────────────────────────────────

async function post(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
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

const TASK_ID = "stream-task-abc123";
const TOKEN = "stream-gateway-token";

// ─── startStreamServer ────────────────────────────────────────────────────────

describe("startStreamServer", () => {
  it("starts and returns a URL + port", async () => {
    const handle = await startStreamServer({
      taskId: TASK_ID,
      token: TOKEN,
      bindAddress: "127.0.0.1",
      timeoutMs: 5_000,
    });

    expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/stream$/);
    expect(handle.port).toBeGreaterThan(0);
    handle.close();
  });

  it("accepts a valid chunk and emits a 'chunk' event", async () => {
    const handle = await startStreamServer({
      taskId: TASK_ID,
      token: TOKEN,
      bindAddress: "127.0.0.1",
      timeoutMs: 5_000,
    });

    const received: string[] = [];
    handle.on("chunk", (chunk: string) => received.push(chunk));

    const payload: StreamChunkPayload = {
      task_id: TASK_ID,
      seq: 0,
      chunk: "hello from H2",
    };

    const { status, body } = await post(handle.url, payload, {
      "X-HH-Token": TOKEN,
    });

    expect(status).toBe(200);
    expect(JSON.parse(body)).toMatchObject({ ok: true, seq: 0 });
    expect(received).toContain("hello from H2");

    handle.close();
  });

  it("rejects unauthenticated requests with 401", async () => {
    const handle = await startStreamServer({
      taskId: TASK_ID,
      token: TOKEN,
      bindAddress: "127.0.0.1",
      timeoutMs: 5_000,
    });

    const { status } = await post(handle.url, {
      task_id: TASK_ID,
      seq: 0,
      chunk: "sneaky",
    });

    expect(status).toBe(401);
    handle.close();
  });

  it("accepts Bearer token auth as well as X-HH-Token", async () => {
    const handle = await startStreamServer({
      taskId: TASK_ID,
      token: TOKEN,
      bindAddress: "127.0.0.1",
      timeoutMs: 5_000,
    });

    const received: string[] = [];
    handle.on("chunk", (text: string) => received.push(text));

    const { status } = await post(
      handle.url,
      { task_id: TASK_ID, seq: 0, chunk: "bearer-auth-chunk" },
      { Authorization: `Bearer ${TOKEN}` },
    );

    expect(status).toBe(200);
    expect(received).toContain("bearer-auth-chunk");
    handle.close();
  });

  it("rejects a chunk with a mismatched task_id (409)", async () => {
    const handle = await startStreamServer({
      taskId: TASK_ID,
      token: TOKEN,
      bindAddress: "127.0.0.1",
      timeoutMs: 5_000,
    });

    const { status, body } = await post(
      handle.url,
      { task_id: "wrong-task-id", seq: 0, chunk: "mismatch" },
      { "X-HH-Token": TOKEN },
    );

    expect(status).toBe(409);
    expect(JSON.parse(body)).toMatchObject({ error: "task_id mismatch" });
    handle.close();
  });

  it("closes and resolves .done when done:true chunk arrives", async () => {
    const handle = await startStreamServer({
      taskId: TASK_ID,
      token: TOKEN,
      bindAddress: "127.0.0.1",
      timeoutMs: 5_000,
    });

    const chunks: string[] = [];
    handle.on("chunk", (c: string) => chunks.push(c));

    // Post a regular chunk
    await post(handle.url, { task_id: TASK_ID, seq: 0, chunk: "partial" }, {
      "X-HH-Token": TOKEN,
    });

    // Post done marker
    await post(
      handle.url,
      { task_id: TASK_ID, seq: 1, chunk: "", done: true },
      { "X-HH-Token": TOKEN },
    );

    // .done should resolve shortly
    await handle.done;

    expect(chunks).toEqual(["partial"]);
  });

  it("auto-closes after timeout", async () => {
    const handle = await startStreamServer({
      taskId: TASK_ID,
      token: TOKEN,
      bindAddress: "127.0.0.1",
      timeoutMs: 50, // very short
    });

    const start = Date.now();
    await handle.done;
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(2_000);
  });

  it("returns 404 for non-/stream paths", async () => {
    const handle = await startStreamServer({
      taskId: TASK_ID,
      token: TOKEN,
      bindAddress: "127.0.0.1",
      timeoutMs: 5_000,
    });

    const otherUrl = handle.url.replace("/stream", "/other");
    const { status } = await post(otherUrl, {}, { "X-HH-Token": TOKEN });
    expect(status).toBe(404);
    handle.close();
  });

  it("returns 400 for invalid JSON body", async () => {
    const handle = await startStreamServer({
      taskId: TASK_ID,
      token: TOKEN,
      bindAddress: "127.0.0.1",
      timeoutMs: 5_000,
    });

    // Send raw string via low-level fetch
    const res = await fetch(handle.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-HH-Token": TOKEN,
      },
      body: "not-json",
    });

    expect(res.status).toBe(400);
    handle.close();
  });

  it("does not emit chunk event when chunk is empty (done:true marker)", async () => {
    const handle = await startStreamServer({
      taskId: TASK_ID,
      token: TOKEN,
      bindAddress: "127.0.0.1",
      timeoutMs: 5_000,
    });

    const chunks: string[] = [];
    handle.on("chunk", (c: string) => chunks.push(c));

    await post(
      handle.url,
      { task_id: TASK_ID, seq: 0, chunk: "", done: true },
      { "X-HH-Token": TOKEN },
    );

    await handle.done;
    expect(chunks).toHaveLength(0);
  });
});

// ─── parseStreamUrl / parseStreamToken ───────────────────────────────────────

describe("parseStreamUrl", () => {
  it("parses HH-Stream-URL from wake text", () => {
    const text = [
      "Task: summarise this PR",
      "HH-Stream-URL: http://100.116.25.69:39200/stream",
      "HH-Stream-Token: tok123",
    ].join("\n");

    expect(parseStreamUrl(text)).toBe("http://100.116.25.69:39200/stream");
  });

  it("returns null when URL is absent", () => {
    expect(parseStreamUrl("no url here")).toBeNull();
  });

  it("handles extra whitespace after colon", () => {
    const text = "HH-Stream-URL:   http://127.0.0.1:5000/stream";
    expect(parseStreamUrl(text)).toBe("http://127.0.0.1:5000/stream");
  });
});

describe("parseStreamToken", () => {
  it("parses HH-Stream-Token from wake text", () => {
    const text = "HH-Stream-Token: abc-xyz-789";
    expect(parseStreamToken(text)).toBe("abc-xyz-789");
  });

  it("returns null when token is absent", () => {
    expect(parseStreamToken("HH-Stream-URL: http://example.com/stream")).toBeNull();
  });
});

// ─── postChunk ────────────────────────────────────────────────────────────────

describe("postChunk", () => {
  it("successfully POSTs a chunk and returns ok:true", async () => {
    const handle = await startStreamServer({
      taskId: TASK_ID,
      token: TOKEN,
      bindAddress: "127.0.0.1",
      timeoutMs: 5_000,
    });

    const result = await postChunk(handle.url, TOKEN, {
      task_id: TASK_ID,
      seq: 0,
      chunk: "via postChunk",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    handle.close();
  });

  it("returns ok:false (not throw) on 401", async () => {
    const handle = await startStreamServer({
      taskId: TASK_ID,
      token: TOKEN,
      bindAddress: "127.0.0.1",
      timeoutMs: 5_000,
    });

    const result = await postChunk(handle.url, "wrong-token", {
      task_id: TASK_ID,
      seq: 0,
      chunk: "sneaky",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    handle.close();
  });

  it("returns ok:false on network error (server closed)", async () => {
    const handle = await startStreamServer({
      taskId: TASK_ID,
      token: TOKEN,
      bindAddress: "127.0.0.1",
      timeoutMs: 5_000,
    });
    const url = handle.url;
    handle.close();
    await new Promise((r) => setTimeout(r, 50)); // let server stop

    const result = await postChunk(url, TOKEN, {
      task_id: TASK_ID,
      seq: 0,
      chunk: "ghost chunk",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
  });

  it("throws when throwOnError=true and server returns error", async () => {
    const handle = await startStreamServer({
      taskId: TASK_ID,
      token: TOKEN,
      bindAddress: "127.0.0.1",
      timeoutMs: 5_000,
    });

    await expect(
      postChunk(
        handle.url,
        "bad-token",
        { task_id: TASK_ID, seq: 0, chunk: "throw test" },
        true, // throwOnError
      ),
    ).rejects.toThrow();

    handle.close();
  });
});

// ─── createChunkStreamer ───────────────────────────────────────────────────────

describe("createChunkStreamer", () => {
  it("delivers multiple chunks and a done marker", async () => {
    const handle = await startStreamServer({
      taskId: TASK_ID,
      token: TOKEN,
      bindAddress: "127.0.0.1",
      timeoutMs: 5_000,
    });

    const received: string[] = [];
    handle.on("chunk", (c: string) => received.push(c));

    const streamer = createChunkStreamer(handle.url, TOKEN, TASK_ID);

    streamer.push("chunk one");
    streamer.push("chunk two");
    streamer.push("chunk three");
    await streamer.finish();

    await handle.done;

    expect(received).toEqual(["chunk one", "chunk two", "chunk three"]);
    expect(streamer.getSeq()).toBe(4); // 3 chunks + 1 done marker
  });

  it("ignores empty pushes (no chunk event for empty string)", async () => {
    const handle = await startStreamServer({
      taskId: TASK_ID,
      token: TOKEN,
      bindAddress: "127.0.0.1",
      timeoutMs: 5_000,
    });

    const received: string[] = [];
    handle.on("chunk", (c: string) => received.push(c));

    const streamer = createChunkStreamer(handle.url, TOKEN, TASK_ID);
    streamer.push(""); // should be skipped
    streamer.push("real chunk");
    await streamer.finish();
    await handle.done;

    expect(received).toEqual(["real chunk"]);
    expect(streamer.getSeq()).toBe(2); // only "real chunk" + done
  });

  it("increments seq numbers monotonically", async () => {
    const handle = await startStreamServer({
      taskId: TASK_ID,
      token: TOKEN,
      bindAddress: "127.0.0.1",
      timeoutMs: 5_000,
    });


    const streamer = createChunkStreamer(handle.url, TOKEN, TASK_ID);
    streamer.push("a");
    streamer.push("b");
    await streamer.finish();
    await handle.done;

    // seq starts at 0, so after 2 pushes + done = seq 3
    expect(streamer.getSeq()).toBe(3);
  });
});
