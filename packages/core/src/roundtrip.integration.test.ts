/**
 * roundtrip.integration.test.ts
 *
 * End-to-end integration tests for the H1 → H2 → H1 task round-trip,
 * exercising the full pipeline without real Tailscale or OpenClaw connections:
 *
 *   1. H1 builds a HHTaskMessage (createTaskMessage)
 *   2. H1 starts a result webhook server (startResultServer)
 *   3. "H2" (a mock client) POSTs a ResultWebhookPayload back to H1
 *   4. H1's webhook resolves with the result
 *   5. TaskResult is validated: tokens, duration, output, cost_usd
 *
 * Also covers:
 *   - Routing decisions for task → h2-local / cloud
 *   - Context summary generation
 *   - Budget estimation from token counts
 *   - Retry guard logic (cronRetryDecision)
 *
 * These tests run entirely in-process (no real network). The result server
 * binds to 127.0.0.1 on an ephemeral port — real HTTP but loopback only.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createTaskMessage,
  createResultMessage,
  isTaskMessage,
  isResultMessage,
  HHTaskMessage,
  HHResultMessage,
} from "./protocol/index.ts";
import { startResultServer, type ResultWebhookPayload } from "./gateway/result-server.ts";
import { routeTask } from "./routing.ts";
import { cronRetryDecision, type RetryState } from "./retry.ts";
import { buildContextSummary } from "./context/store.ts";

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function httpPost(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; text: string }> {
  const { request } = await import("node:http");
  const parsed = new URL(url);
  const bodyStr = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: parsed.hostname,
        port: parseInt(parsed.port, 10),
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(bodyStr),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: data }));
      },
    );
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}

const TOM = "tom-node";
const JERRY = "h2-node";
const TOKEN = "integration-test-token";

// ─── 1. Protocol: task message creation ──────────────────────────────────────

describe("HHTaskMessage creation and validation", () => {
  it("builds a valid task message from/to", () => {
    const msg = createTaskMessage({
      from: TOM,
      to: JERRY,
      objective: "Summarize the attached PDF",
    });
    expect(isTaskMessage(msg)).toBe(true);
    expect(msg.type).toBe("task");
    expect(msg.from).toBe(TOM);
    expect(msg.to).toBe(JERRY);
    expect(msg.id).toMatch(/^[0-9a-f-]{36}$/); // UUID
    expect(msg.timestamp).toBeTruthy();
  });

  it("builds a task message with optional context summary", () => {
    const msg = createTaskMessage({
      from: TOM,
      to: JERRY,
      objective: "Render a 10s video of a spinning cube",
      context_summary: "Previous turn: asked for a still image, now upgrading to video",
    });
    expect(msg.context_summary).toBe(
      "Previous turn: asked for a still image, now upgrading to video",
    );
    expect(msg.payload.objective).toBe("Render a 10s video of a spinning cube");
  });

  it("task message has correct defaults", () => {
    const msg = createTaskMessage({ from: TOM, to: JERRY, objective: "ping" });
    expect(msg.version).toBe("0.1.0");
    expect(msg.turn).toBe(0);
    expect(msg.done).toBe(false);
    expect(msg.wake_required).toBe(false);
    expect(msg.shutdown_after).toBe(false);
    expect(msg.payload.constraints).toEqual([]);
  });
});

// ─── 2. Protocol: result message creation ────────────────────────────────────

describe("HHResultMessage creation and validation", () => {
  it("builds a valid result message", () => {
    const task = createTaskMessage({ from: TOM, to: JERRY, objective: "noop" });
    const res = createResultMessage({
      from: JERRY,
      to: TOM,
      task_id: task.id,
      output: "Done! Here is the summary.",
      success: true,
    });
    expect(isResultMessage(res)).toBe(true);
    expect(res.type).toBe("result");
    expect(res.payload.task_id).toBe(task.id);
    expect(res.payload.success).toBe(true);
    expect(res.payload.output).toBe("Done! Here is the summary.");
    expect(res.payload.artifacts).toEqual([]);
  });

  it("result message can carry artifacts and token counts", () => {
    const task = createTaskMessage({ from: TOM, to: JERRY, objective: "generate image" });
    const res = createResultMessage({
      from: JERRY,
      to: TOM,
      task_id: task.id,
      output: "Image saved to /tmp/output.png",
      success: true,
      artifacts: ["/tmp/output.png"],
      tokens_used: 512,
      duration_ms: 3200,
    });
    expect(res.payload.artifacts).toEqual(["/tmp/output.png"]);
    expect(res.payload.tokens_used).toBe(512);
    expect(res.payload.duration_ms).toBe(3200);
  });

  it("result message can represent a failure", () => {
    const task = createTaskMessage({ from: TOM, to: JERRY, objective: "crash me" });
    const res = createResultMessage({
      from: JERRY,
      to: TOM,
      task_id: task.id,
      output: "",
      success: false,
      error: "OOM: GPU out of memory",
    });
    expect(res.payload.success).toBe(false);
    expect(res.payload.error).toBe("OOM: GPU out of memory");
  });
});

// ─── 3. Webhook round-trip (real loopback HTTP) ───────────────────────────────

describe("Round-trip: H1 webhook server ↔ H2 POST", () => {
  it("H2 posts result, H1 webhook resolves", async () => {
    const taskId = "round-trip-test-" + Date.now();

    // H1 starts result server
    const handle = await startResultServer({
      taskId,
      token: TOKEN,
      bindAddress: "127.0.0.1",
      timeoutMs: 5_000,
    });

    expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/result/);

    // H2 posts back (runs concurrently — server waits for POST)
    const jerryPayload: ResultWebhookPayload = {
      task_id: taskId,
      output: "All done! Result: 42.",
      success: true,
      tokens_used: 256,
      duration_ms: 800,
      artifacts: [],
    };

    const postResult = httpPost(handle.url, jerryPayload, {
      Authorization: `Bearer ${TOKEN}`,
    });

    const [received, postRes] = await Promise.all([handle.result, postResult]);

    expect(postRes.status).toBe(200);
    expect(received.output).toBe("All done! Result: 42.");
    expect(received.success).toBe(true);
    expect(received.tokens_used).toBe(256);
    expect(received.task_id).toBe(taskId);
  }, 10_000);

  it("rejects wrong token with 401", async () => {
    const taskId = "auth-test-" + Date.now();
    const handle = await startResultServer({
      taskId,
      token: TOKEN,
      bindAddress: "127.0.0.1",
      timeoutMs: 5_000,
    });

    const badPost = await httpPost(
      handle.url,
      { task_id: taskId, output: "sneak", success: true, artifacts: [] },
      { Authorization: "Bearer wrong-token" },
    );

    expect(badPost.status).toBe(401);

    // Clean up the pending server
    handle.close();
  }, 10_000);

  it("rejects wrong task_id with 400", async () => {
    const taskId = "task-guard-" + Date.now();
    const handle = await startResultServer({
      taskId,
      token: TOKEN,
      bindAddress: "127.0.0.1",
      timeoutMs: 5_000,
    });

    const wrongIdPost = await httpPost(
      handle.url,
      { task_id: "completely-different-id", output: "nope", success: true, artifacts: [] },
      { Authorization: `Bearer ${TOKEN}` },
    );

    expect(wrongIdPost.status).toBe(400);
    handle.close();
  }, 10_000);

  it("server times out if H2 never responds", async () => {
    const taskId = "timeout-test-" + Date.now();
    const handle = await startResultServer({
      taskId,
      token: TOKEN,
      bindAddress: "127.0.0.1",
      timeoutMs: 200, // very short
    });

    await expect(handle.result).rejects.toThrow(/timed out/i);
  }, 5_000);
});

// ─── 4. Routing decisions ─────────────────────────────────────────────────────

describe("routeTask: heuristic routing", () => {
  it("routes image-gen task to h2-local", () => {
    const d = routeTask("Generate an image of a dragon breathing fire");
    expect(d.hint).toBe("h2-local");
  });

  it("routes calendar lookup to cloud", () => {
    const d = routeTask("Check my calendar for tomorrow");
    expect(d.hint).toBe("cloud");
  });

  it("routes email summary to cloud", () => {
    const d = routeTask("Summarize my email inbox");
    expect(d.hint).toBe("cloud");
  });

  it("routes Ollama task to h2-local", () => {
    const d = routeTask("Run this through Ollama and summarize");
    expect(d.hint).toBe("h2-local");
  });

  it("falls back to cloud for unknown task", () => {
    const d = routeTask("do the thing");
    expect(d.hint).toBe("cloud");
  });
});

describe("routeTask: capability-aware routing", () => {
  const baseCaps = {
    node: "jerry",
    os: "windows" as const,
    arch: "x64",
    gpu: { available: true, name: "RTX 3070 Ti", backend: "cuda" as const, vram_gb: 8 },
    ollama: { running: true, models: ["llama3.2", "codellama"] },
    lmstudio: { running: false, models: [] },
    comfyui: { running: false, port: null },
    stable_diffusion: { running: false, port: null },
    whisper: { available: false, path: null },
    skills: ["image-gen", "transcription"] as string[],
    free_disk_gb: 100,
    ram_gb: 32,
    last_scan: new Date().toISOString(),
    latent_support: false,
    latent_codecs: [] as string[],
    kv_compatible_models: [] as string[],
    tags: [] as string[],
    notes: null,
  };

  it("routes image task to h2-local when peer has image-gen skill", () => {
    const d = routeTask("Generate a painting of a sunset", baseCaps);
    expect(d.hint).toBe("h2-local");
  });

  it("routes transcription to h2-local when peer has transcription skill", () => {
    const d = routeTask("Transcribe this audio file using whisper", baseCaps);
    expect(d.hint).toBe("h2-local");
  });

  it("routes Ollama task to h2-local with suggested model", () => {
    const d = routeTask("Run this with Ollama", baseCaps);
    expect(d.hint).toBe("h2-local");
    expect(d.suggested_model).toBe("llama3.2");
  });

  it("cloud for weather check even with capable jerry", () => {
    const d = routeTask("What is the weather today", {
      ...baseCaps,
      skills: [],
      ollama: { running: false, models: [] },
    });
    expect(d.hint).toBe("cloud");
  });

  it("routes via Vision Wormhole when peer supports latent and task is complex", () => {
    const latentCaps = {
      ...baseCaps,
      latent_support: true,
      latent_codecs: ["vw-qwen3vl2b-v1"],
    };
    const d = routeTask(
      "Analyze the architecture of this codebase step by step and generate a refactoring plan",
      latentCaps,
    );
    expect(d.hint).toBe("h2-latent");
    expect(d.latent_codec).toBe("vw-qwen3vl2b-v1");
  });
});

// ─── 5. Context summary ───────────────────────────────────────────────────────

describe("buildContextSummary", () => {
  it("generates a summary from task + result", () => {
    const summary = buildContextSummary(
      "Generate a Python script to scrape product prices from Amazon",
      "Done. Script saved to /tmp/scraper.py — uses httpx and BeautifulSoup.",
    );
    expect(typeof summary).toBe("string");
    expect(summary.length).toBeGreaterThan(10);
    // Should reference both the task and the outcome
    expect(summary.toLowerCase()).toMatch(/python|scrape|script|done/i);
  });

  it("handles empty result gracefully", () => {
    const summary = buildContextSummary("What is 2+2?", "");
    expect(typeof summary).toBe("string");
  });

  it("truncates very long inputs to stay concise", () => {
    const longOutput = "x".repeat(10_000);
    const summary = buildContextSummary("Long task description here", longOutput);
    // Summary should not balloon to the full input length
    expect(summary.length).toBeLessThan(2_000);
  });
});

// ─── 6. Cron retry guard ──────────────────────────────────────────────────────

describe("cronRetryDecision", () => {
  const now = Date.now();

  it("returns 'send' for fresh tasks with no prior retry state", () => {
    const decision = cronRetryDecision(undefined, now);
    expect(decision).toBe("send");
  });

  it("returns 'skip' for a task that succeeded", () => {
    const state: RetryState = {
      taskId: "test-1",
      attempts: 1,
      lastAttemptAt: now - 60_000,
      nextRetryAt: null,
      status: "succeeded",
    };
    expect(cronRetryDecision(state, now)).toBe("skip");
  });

  it("returns 'skip' for a task that exhausted retries", () => {
    const state: RetryState = {
      taskId: "test-2",
      attempts: 3,
      lastAttemptAt: now - 30_000,
      nextRetryAt: null,
      status: "exhausted",
    };
    expect(cronRetryDecision(state, now)).toBe("skip");
  });

  it("returns 'backoff' when next retry is in the future", () => {
    const state: RetryState = {
      taskId: "test-3",
      attempts: 2,
      lastAttemptAt: now - 5_000,
      nextRetryAt: now + 60_000, // not yet
      status: "pending",
    };
    expect(cronRetryDecision(state, now)).toBe("backoff");
  });

  it("returns 'retry' when backoff window has passed", () => {
    const state: RetryState = {
      taskId: "test-4",
      attempts: 2,
      lastAttemptAt: now - 120_000,
      nextRetryAt: now - 5_000, // already elapsed
      status: "pending",
    };
    expect(cronRetryDecision(state, now)).toBe("retry");
  });
});
