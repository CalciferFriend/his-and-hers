/**
 * gateway/mock-gateway.test.ts
 *
 * E2E tests for wakeAgent() against MockGateway — no real network required.
 *
 * Phase 8d — Calcifer ✅ (2026-03-15)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockGateway } from "./mock-gateway.ts";
import { wakeAgent } from "./wake.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function withGateway(
  opts: ConstructorParameters<typeof MockGateway>[0],
  fn: (gw: MockGateway) => Promise<void>,
): Promise<void> {
  const gw = new MockGateway(opts);
  await gw.start();
  try {
    await fn(gw);
  } finally {
    await gw.stop();
  }
}

// ─── MockGateway unit tests ───────────────────────────────────────────────────

describe("MockGateway", () => {
  it("starts and stops cleanly", async () => {
    const gw = new MockGateway({ token: "tok" });
    await gw.start();
    expect(gw.port).toBeGreaterThan(0);
    expect(gw.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/);
    await gw.stop();
  });

  it("binds to a random port by default (no collision)", async () => {
    const gw1 = new MockGateway({ token: "tok" });
    const gw2 = new MockGateway({ token: "tok" });
    await gw1.start();
    await gw2.start();
    expect(gw1.port).not.toBe(gw2.port);
    await gw1.stop();
    await gw2.stop();
  });

  it("clearWakes resets the received wake list", async () => {
    await withGateway({ token: "tok" }, async (gw) => {
      await wakeAgent({ url: gw.url, token: "tok", text: "hello" });
      expect(gw.receivedWakes).toHaveLength(1);
      gw.clearWakes();
      expect(gw.receivedWakes).toHaveLength(0);
    });
  });

  it("emits 'wake' event for each received wake", async () => {
    await withGateway({ token: "tok" }, async (gw) => {
      const received: string[] = [];
      gw.on("wake", (w) => received.push(w.text));

      await wakeAgent({ url: gw.url, token: "tok", text: "task 1" });
      await wakeAgent({ url: gw.url, token: "tok", text: "task 2" });

      expect(received).toEqual(["task 1", "task 2"]);
    });
  });

  it("emits 'connect' event on successful handshake", async () => {
    await withGateway({ token: "tok" }, async (gw) => {
      let connectFired = false;
      gw.on("connect", () => { connectFired = true; });
      await wakeAgent({ url: gw.url, token: "tok", text: "ping" });
      expect(connectFired).toBe(true);
    });
  });
});

// ─── wakeAgent happy path ─────────────────────────────────────────────────────

describe("wakeAgent — happy path", () => {
  it("sends a wake and receives ok:true", async () => {
    await withGateway({ token: "secret" }, async (gw) => {
      const result = await wakeAgent({ url: gw.url, token: "secret", text: "do work" });
      expect(result.ok).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  it("records the wake text correctly", async () => {
    await withGateway({ token: "tok" }, async (gw) => {
      const text = "Write unit tests for auth.ts";
      await wakeAgent({ url: gw.url, token: "tok", text });
      expect(gw.receivedWakes).toHaveLength(1);
      expect(gw.receivedWakes[0]!.text).toBe(text);
    });
  });

  it("records the wake mode (default: now)", async () => {
    await withGateway({ token: "tok" }, async (gw) => {
      await wakeAgent({ url: gw.url, token: "tok", text: "hi", mode: "now" });
      expect(gw.receivedWakes[0]!.mode).toBe("now");
    });
  });

  it("records next-heartbeat mode when specified", async () => {
    await withGateway({ token: "tok" }, async (gw) => {
      await wakeAgent({ url: gw.url, token: "tok", text: "later", mode: "next-heartbeat" });
      expect(gw.receivedWakes[0]!.mode).toBe("next-heartbeat");
    });
  });

  it("handles multiple sequential wakes correctly", async () => {
    await withGateway({ token: "tok" }, async (gw) => {
      await wakeAgent({ url: gw.url, token: "tok", text: "first" });
      await wakeAgent({ url: gw.url, token: "tok", text: "second" });
      await wakeAgent({ url: gw.url, token: "tok", text: "third" });
      expect(gw.receivedWakes).toHaveLength(3);
      expect(gw.receivedWakes.map((w) => w.text)).toEqual(["first", "second", "third"]);
    });
  });

  it("timestamps the wake with a recent Date", async () => {
    const before = Date.now();
    await withGateway({ token: "tok" }, async (gw) => {
      await wakeAgent({ url: gw.url, token: "tok", text: "ts check" });
      const after = Date.now();
      const ts = gw.receivedWakes[0]!.receivedAt.getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });
});

// ─── wakeAgent auth failures ──────────────────────────────────────────────────

describe("wakeAgent — auth failures", () => {
  it("returns ok:false with wrong token", async () => {
    await withGateway({ token: "correct-token" }, async (gw) => {
      const result = await wakeAgent({ url: gw.url, token: "wrong-token", text: "hi" });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/auth/i);
    });
  });

  it("returns ok:false when server rejects auth", async () => {
    await withGateway({ token: "tok", rejectAuth: true }, async (gw) => {
      const result = await wakeAgent({ url: gw.url, token: "tok", text: "hi" });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/auth/i);
    });
  });

  it("does not record the wake when auth fails", async () => {
    await withGateway({ token: "tok", rejectAuth: true }, async (gw) => {
      await wakeAgent({ url: gw.url, token: "tok", text: "sneaky" });
      expect(gw.receivedWakes).toHaveLength(0);
    });
  });
});

// ─── wakeAgent connection failures ───────────────────────────────────────────

describe("wakeAgent — connection failures", () => {
  it("returns ok:false when server drops connection immediately", async () => {
    await withGateway({ token: "tok", dropConnection: true }, async (gw) => {
      const result = await wakeAgent({ url: gw.url, token: "tok", text: "hi", timeoutMs: 2000 });
      expect(result.ok).toBe(false);
    });
  });

  it("returns ok:false with error when connecting to a dead port", async () => {
    const result = await wakeAgent({
      url: "ws://127.0.0.1:1", // Port 1 should be unreachable
      token: "tok",
      text: "hi",
      timeoutMs: 2000,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ─── wakeAgent timeout ────────────────────────────────────────────────────────

describe("wakeAgent — timeout", () => {
  it("returns ok:false with 'timeout' when hello-ok is delayed beyond timeoutMs", async () => {
    // hello delayed by 300ms, but we set a 100ms timeout → should time out
    await withGateway({ token: "tok", helloDelayMs: 300 }, async (gw) => {
      const result = await wakeAgent({ url: gw.url, token: "tok", text: "hi", timeoutMs: 100 });
      expect(result.ok).toBe(false);
      expect(result.error).toBe("timeout");
    });
  });

  it("succeeds when delay is within timeoutMs", async () => {
    // hello delayed 50ms, timeout 500ms → should succeed
    await withGateway({ token: "tok", helloDelayMs: 50 }, async (gw) => {
      const result = await wakeAgent({ url: gw.url, token: "tok", text: "hi", timeoutMs: 500 });
      expect(result.ok).toBe(true);
    });
  });
});

// ─── MockGateway + result-server round-trip ───────────────────────────────────

describe("MockGateway + result-server round-trip", () => {
  it("wake text embeds HH-Result-URL when one is included", async () => {
    await withGateway({ token: "tok" }, async (gw) => {
      const taskId = "task-abc123";
      const webhookUrl = "http://127.0.0.1:9999/result";
      const text = `[HH Task]\nid: ${taskId}\nHH-Result-URL: ${webhookUrl}\nDo something.`;

      await wakeAgent({ url: gw.url, token: "tok", text });

      expect(gw.receivedWakes).toHaveLength(1);
      expect(gw.receivedWakes[0]!.text).toContain("HH-Result-URL");
      expect(gw.receivedWakes[0]!.text).toContain(webhookUrl);
    });
  });

  it("captures full CofounderTaskMessage payload in wake text", async () => {
    await withGateway({ token: "tok" }, async (gw) => {
      const payload = JSON.stringify({
        type: "task",
        id: "t-xyz",
        from: "calcifer",
        to: "glados",
        objective: "Summarise the repo",
        constraints: ["< 200 words"],
        priority: "normal",
        created_at: new Date().toISOString(),
      });

      await wakeAgent({ url: gw.url, token: "tok", text: payload });

      const received = gw.receivedWakes[0]!;
      const parsed = JSON.parse(received.text) as Record<string, unknown>;
      expect(parsed["type"]).toBe("task");
      expect(parsed["id"]).toBe("t-xyz");
      expect(parsed["objective"]).toBe("Summarise the repo");
    });
  });
});

// ─── Pipeline simulation ──────────────────────────────────────────────────────

describe("MockGateway — pipeline simulation", () => {
  it("receives sequential pipeline steps as separate wakes", async () => {
    await withGateway({ token: "tok" }, async (gw) => {
      // Simulate how cofounder pipeline sends steps sequentially
      const steps = [
        "step:1 — Write tests for auth.ts",
        "step:2 — Review {{previous.output}}",
        "step:3 — Summarise findings",
      ];

      for (const text of steps) {
        const result = await wakeAgent({ url: gw.url, token: "tok", text });
        expect(result.ok).toBe(true);
      }

      expect(gw.receivedWakes).toHaveLength(3);
      expect(gw.receivedWakes.map((w) => w.text)).toEqual(steps);
    });
  });

  it("handles concurrent wakes from cluster broadcast", async () => {
    await withGateway({ token: "tok" }, async (gw) => {
      // Simulate cofounder cluster / broadcast sending to multiple peers simultaneously
      const results = await Promise.all([
        wakeAgent({ url: gw.url, token: "tok", text: "peer:alpha task" }),
        wakeAgent({ url: gw.url, token: "tok", text: "peer:beta task" }),
        wakeAgent({ url: gw.url, token: "tok", text: "peer:gamma task" }),
      ]);

      for (const r of results) {
        expect(r.ok).toBe(true);
      }

      expect(gw.receivedWakes).toHaveLength(3);
      const texts = gw.receivedWakes.map((w) => w.text).sort();
      expect(texts).toEqual([
        "peer:alpha task",
        "peer:beta task",
        "peer:gamma task",
      ]);
    });
  });
});
