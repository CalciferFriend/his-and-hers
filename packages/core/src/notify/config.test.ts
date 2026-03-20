/**
 * notify/config.test.ts
 *
 * Unit tests for the persistent notification webhook registry.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  loadNotifyWebhooks,
  saveNotifyWebhooks,
  addNotifyWebhook,
  removeNotifyWebhook,
  filterWebhooksByEvent,
  getActiveWebhooks,
  type HHNotifyWebhook,
} from "./config.ts";

// ─── Mock fs helpers ──────────────────────────────────────────────────────────

const mockFiles = new Map<string, string>();

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async (p: string) => {
    const content = mockFiles.get(p);
    if (content === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return content;
  }),
  writeFile: vi.fn(async (p: string, data: string) => {
    mockFiles.set(p, data);
  }),
  mkdir: vi.fn(async () => undefined),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn((p: string) => mockFiles.has(p)),
}));

// Stable UUID for test isolation
let uuidCounter = 0;
vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => `00000000-0000-0000-0000-${String(uuidCounter++).padStart(12, "0")}`),
}));

beforeEach(() => {
  mockFiles.clear();
  uuidCounter = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── loadNotifyWebhooks ───────────────────────────────────────────────────────

describe("loadNotifyWebhooks", () => {
  it("returns empty array when file does not exist", async () => {
    const result = await loadNotifyWebhooks();
    expect(result).toEqual([]);
  });

  it("returns parsed webhooks when file exists", async () => {
    const webhooks: HHNotifyWebhook[] = [
      {
        id: "00000000-0000-0000-0000-000000000000",
        url: "https://discord.com/api/webhooks/123/abc",
        name: "Discord",
        events: "all",
        created_at: "2026-03-14T06:00:00.000Z",
      },
    ];
    // Manually prime the mock
    const { join } = await import("node:path");
    const { homedir } = await import("node:os");
    mockFiles.set(join(homedir(), ".cofounder", "notify-webhooks.json"), JSON.stringify(webhooks));

    const result = await loadNotifyWebhooks();
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://discord.com/api/webhooks/123/abc");
  });

  it("returns empty array on parse error", async () => {
    const { join } = await import("node:path");
    const { homedir } = await import("node:os");
    mockFiles.set(join(homedir(), ".cofounder", "notify-webhooks.json"), "not-json{{{");
    const result = await loadNotifyWebhooks();
    expect(result).toEqual([]);
  });
});

// ─── addNotifyWebhook ─────────────────────────────────────────────────────────

describe("addNotifyWebhook", () => {
  it("adds a webhook and returns the entry", async () => {
    const webhook = await addNotifyWebhook({
      url: "https://discord.com/api/webhooks/999/xyz",
      name: "My Discord",
      events: "all",
    });

    expect(webhook.url).toBe("https://discord.com/api/webhooks/999/xyz");
    expect(webhook.name).toBe("My Discord");
    expect(webhook.events).toBe("all");
    expect(webhook.id).toMatch(/^[0-9a-f-]+$/);
    expect(webhook.created_at).toBeTruthy();
  });

  it("defaults events to 'all' when not specified", async () => {
    const webhook = await addNotifyWebhook({ url: "https://example.com/hook" });
    expect(webhook.events).toBe("all");
  });

  it("throws when the same URL is added twice", async () => {
    await addNotifyWebhook({ url: "https://example.com/hook" });
    await expect(addNotifyWebhook({ url: "https://example.com/hook" })).rejects.toThrow(
      "already registered",
    );
  });

  it("persists multiple webhooks independently", async () => {
    await addNotifyWebhook({ url: "https://example.com/hook1" });
    await addNotifyWebhook({ url: "https://example.com/hook2", events: "failure" });

    const all = await loadNotifyWebhooks();
    expect(all).toHaveLength(2);
    expect(all[1].events).toBe("failure");
  });
});

// ─── removeNotifyWebhook ──────────────────────────────────────────────────────

describe("removeNotifyWebhook", () => {
  it("removes a webhook by full ID", async () => {
    const w = await addNotifyWebhook({ url: "https://example.com/hook" });
    const removed = await removeNotifyWebhook(w.id);
    expect(removed).toBe(true);

    const all = await loadNotifyWebhooks();
    expect(all).toHaveLength(0);
  });

  it("removes a webhook by ID prefix", async () => {
    const w = await addNotifyWebhook({ url: "https://example.com/hook" });
    const prefix = w.id.slice(0, 8);
    const removed = await removeNotifyWebhook(prefix);
    expect(removed).toBe(true);
  });

  it("returns false for unknown ID", async () => {
    const removed = await removeNotifyWebhook("nonexistent");
    expect(removed).toBe(false);
  });

  it("only removes the matched webhook", async () => {
    const w1 = await addNotifyWebhook({ url: "https://example.com/hook1" });
    await addNotifyWebhook({ url: "https://example.com/hook2" });

    await removeNotifyWebhook(w1.id);
    const all = await loadNotifyWebhooks();
    expect(all).toHaveLength(1);
    expect(all[0].url).toBe("https://example.com/hook2");
  });
});

// ─── filterWebhooksByEvent ────────────────────────────────────────────────────

describe("filterWebhooksByEvent", () => {
  const webhooks: HHNotifyWebhook[] = [
    {
      id: "id-all",
      url: "https://example.com/all",
      events: "all",
      created_at: "2026-03-14T00:00:00.000Z",
    },
    {
      id: "id-complete",
      url: "https://example.com/complete",
      events: "complete",
      created_at: "2026-03-14T00:00:00.000Z",
    },
    {
      id: "id-failure",
      url: "https://example.com/failure",
      events: "failure",
      created_at: "2026-03-14T00:00:00.000Z",
    },
  ];

  it("returns 'all' + 'complete' webhooks on success", () => {
    const result = filterWebhooksByEvent(webhooks, true);
    expect(result.map((w) => w.events)).toEqual(["all", "complete"]);
  });

  it("returns 'all' + 'failure' webhooks on failure", () => {
    const result = filterWebhooksByEvent(webhooks, false);
    expect(result.map((w) => w.events)).toEqual(["all", "failure"]);
  });

  it("returns empty array when no webhooks", () => {
    expect(filterWebhooksByEvent([], true)).toEqual([]);
    expect(filterWebhooksByEvent([], false)).toEqual([]);
  });
});

// ─── getActiveWebhooks ────────────────────────────────────────────────────────

describe("getActiveWebhooks", () => {
  it("loads from disk and filters by event", async () => {
    const webhooks: HHNotifyWebhook[] = [
      {
        id: "00000000-0000-0000-0000-000000000001",
        url: "https://example.com/all",
        events: "all",
        created_at: "2026-03-14T00:00:00.000Z",
      },
      {
        id: "00000000-0000-0000-0000-000000000002",
        url: "https://example.com/failure",
        events: "failure",
        created_at: "2026-03-14T00:00:00.000Z",
      },
    ];
    const { join } = await import("node:path");
    const { homedir } = await import("node:os");
    mockFiles.set(join(homedir(), ".cofounder", "notify-webhooks.json"), JSON.stringify(webhooks));

    const active = await getActiveWebhooks(true); // success=true
    expect(active).toHaveLength(1);
    expect(active[0].url).toBe("https://example.com/all");
  });
});
