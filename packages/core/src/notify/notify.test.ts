/**
 * notify/notify.test.ts
 *
 * Unit tests for deliverNotification() — covers Discord, Slack, generic flavour
 * detection and payload shape without making real HTTP calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { deliverNotification, type NotificationContext } from "./notify.ts";

const baseCtx: NotificationContext = {
  task: "summarise the quarterly report",
  taskId: "550e8400-e29b-41d4-a716-446655440000",
  success: true,
  output: "Here is the summary: Lorem ipsum dolor sit amet.",
  peer: "glados",
  durationMs: 12_300,
  costUsd: 0.0042,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(status = 200, ok = true) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok,
    status,
  } as Response);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Discord flavour
// ---------------------------------------------------------------------------

describe("deliverNotification — Discord", () => {
  const discordUrl = "https://discord.com/api/webhooks/1234/abcdef";

  it("returns true on HTTP 200", async () => {
    const spy = mockFetch(200);
    const result = await deliverNotification(discordUrl, baseCtx);
    expect(result).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("posts JSON with embeds array", async () => {
    const spy = mockFetch(200);
    await deliverNotification(discordUrl, baseCtx);
    const [, init] = spy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toHaveProperty("embeds");
    expect(Array.isArray(body.embeds)).toBe(true);
    expect(body.embeds[0]).toHaveProperty("title");
    expect(body.embeds[0].color).toBe(0x57f287); // green
  });

  it("uses red colour on failure", async () => {
    const spy = mockFetch(200);
    await deliverNotification(discordUrl, { ...baseCtx, success: false });
    const [, init] = spy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.embeds[0].color).toBe(0xed4245); // red
  });

  it("truncates task description longer than 100 chars", async () => {
    const spy = mockFetch(200);
    const longTask = "a".repeat(150);
    await deliverNotification(discordUrl, { ...baseCtx, task: longTask });
    const [, init] = spy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.embeds[0].description.length).toBeLessThanOrEqual(100);
    expect(body.embeds[0].description).toMatch(/\.\.\.$/);
  });

  it("includes peer, duration, and cost fields when provided", async () => {
    const spy = mockFetch(200);
    await deliverNotification(discordUrl, baseCtx);
    const [, init] = spy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    const fields: Array<{ name: string }> = body.embeds[0].fields;
    const names = fields.map((f) => f.name);
    expect(names).toContain("Peer");
    expect(names).toContain("Duration");
    expect(names).toContain("Cost");
  });

  it("omits cost field when costUsd is 0 (local task)", async () => {
    const spy = mockFetch(200);
    await deliverNotification(discordUrl, { ...baseCtx, costUsd: 0 });
    const [, init] = spy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    const fields: Array<{ name: string }> = body.embeds[0].fields;
    expect(fields.find((f) => f.name === "Cost")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Slack flavour
// ---------------------------------------------------------------------------

describe("deliverNotification — Slack", () => {
  const slackUrl = "https://hooks.slack.com/services/T0000/B0000/abcdef";

  it("returns true on HTTP 200", async () => {
    const spy = mockFetch(200);
    const result = await deliverNotification(slackUrl, baseCtx);
    expect(result).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("posts JSON with top-level text property", async () => {
    const spy = mockFetch(200);
    await deliverNotification(slackUrl, baseCtx);
    const [, init] = spy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toHaveProperty("text");
    expect(typeof body.text).toBe("string");
  });

  it("includes success checkmark in text", async () => {
    const spy = mockFetch(200);
    await deliverNotification(slackUrl, baseCtx);
    const [, init] = spy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.text).toContain(":white_check_mark:");
  });

  it("includes failure icon on task failure", async () => {
    const spy = mockFetch(200);
    await deliverNotification(slackUrl, { ...baseCtx, success: false });
    const [, init] = spy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.text).toContain(":x:");
  });
});

// ---------------------------------------------------------------------------
// Generic flavour
// ---------------------------------------------------------------------------

describe("deliverNotification — generic webhook", () => {
  const genericUrl = "https://example.com/my-webhook";

  it("returns true on HTTP 200", async () => {
    const spy = mockFetch(200);
    const result = await deliverNotification(genericUrl, baseCtx);
    expect(result).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("posts event='task_complete' JSON with snake_case fields", async () => {
    const spy = mockFetch(200);
    await deliverNotification(genericUrl, baseCtx);
    const [, init] = spy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.event).toBe("task_complete");
    expect(body.task_id).toBe(baseCtx.taskId);
    expect(body.success).toBe(true);
    expect(body.peer).toBe("glados");
    expect(body.duration_ms).toBe(12_300);
    expect(body.cost_usd).toBe(0.0042);
    expect(body.timestamp).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Error / edge cases
// ---------------------------------------------------------------------------

describe("deliverNotification — error handling", () => {
  it("returns false when fetch throws (network error)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));
    const result = await deliverNotification("https://example.com/hook", baseCtx);
    expect(result).toBe(false);
  });

  it("returns false when HTTP response is not ok (e.g. 404)", async () => {
    mockFetch(404, false);
    const result = await deliverNotification("https://example.com/hook", baseCtx);
    expect(result).toBe(false);
  });

  it("returns false for empty webhook URL", async () => {
    const spy = mockFetch(200);
    const result = await deliverNotification("", baseCtx);
    expect(result).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("sets Content-Type application/json on all requests", async () => {
    const spy = mockFetch(200);
    await deliverNotification("https://discord.com/api/webhooks/1/x", baseCtx);
    const [, init] = spy.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({
      "Content-Type": "application/json",
    });
  });
});

// ---------------------------------------------------------------------------
// Duration formatting (indirectly via Discord payload)
// ---------------------------------------------------------------------------

describe("duration formatting", () => {
  const discordUrl = "https://discord.com/api/webhooks/1/x";

  it.each([
    [500, "500ms"],
    [1500, "1.5s"],
    [90_000, "1m 30s"],
    [60_000, "1m"],
  ])("formats %dms as '%s'", async (ms, expected) => {
    const spy = mockFetch(200);
    await deliverNotification(discordUrl, { ...baseCtx, durationMs: ms });
    const [, init] = spy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    const durationField = body.embeds[0].fields.find((f: { name: string }) => f.name === "Duration");
    expect(durationField?.value).toBe(expected);
  });
});
