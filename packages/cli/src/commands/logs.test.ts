/**
 * logs.test.ts — unit tests for `cofounder logs`
 *
 * Tests filter/sort helpers (parseDuration, applyFilters), the JSON output
 * path, and the empty-state path. The clack/prompts and console side-effects
 * are mocked so tests stay fast and side-effect-free.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks (vi.hoisted ensures vars are available when factories run)
// ---------------------------------------------------------------------------

const { mockListTaskStates } = vi.hoisted(() => ({
  mockListTaskStates: vi.fn(),
}));

vi.mock("../state/tasks.ts", () => ({
  listTaskStates: mockListTaskStates,
}));

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    step: vi.fn(),
    message: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

import type { TaskState } from "../state/tasks.ts";

function makeTask(overrides: Partial<TaskState> & { id: string }): TaskState {
  return {
    id: overrides.id,
    objective: overrides.objective ?? "Do something useful",
    status: overrides.status ?? "completed",
    from: overrides.from ?? "h1",
    to: overrides.to ?? "glados",
    routing_hint: overrides.routing_hint,
    created_at: overrides.created_at ?? new Date().toISOString(),
    updated_at: overrides.updated_at ?? new Date().toISOString(),
    result: overrides.result,
  } as TaskState;
}

const NOW = new Date("2026-03-15T12:00:00Z").getTime();

// ---------------------------------------------------------------------------
// Import under test (after mocks are wired)
// ---------------------------------------------------------------------------

// We need to call logs() but also test internal helpers indirectly through it.
// Import lazily after mock wiring.
let logsModule: typeof import("./logs.ts");

beforeEach(async () => {
  vi.clearAllMocks();
  logsModule = await import("./logs.ts");
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// JSON output
// ---------------------------------------------------------------------------

describe("cofounder logs --json", () => {
  it("prints JSON array of all tasks", async () => {
    const tasks = [
      makeTask({ id: "aaa111", status: "completed" }),
      makeTask({ id: "bbb222", status: "failed" }),
    ];
    mockListTaskStates.mockResolvedValue(tasks);

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await logsModule.logs({ json: true });

    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(spy.mock.calls[0][0] as string) as TaskState[];
    expect(parsed).toHaveLength(2);
    expect(parsed.map((t) => t.id)).toContain("aaa111");
    expect(parsed.map((t) => t.id)).toContain("bbb222");
  });

  it("applies status filter before JSON output", async () => {
    const tasks = [
      makeTask({ id: "aaa111", status: "completed" }),
      makeTask({ id: "bbb222", status: "failed" }),
      makeTask({ id: "ccc333", status: "pending" }),
    ];
    mockListTaskStates.mockResolvedValue(tasks);

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await logsModule.logs({ json: true, status: "failed" });

    const parsed = JSON.parse(spy.mock.calls[0][0] as string) as TaskState[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("bbb222");
  });

  it("applies peer filter before JSON output (substring match)", async () => {
    const tasks = [
      makeTask({ id: "aaa111", to: "glados" }),
      makeTask({ id: "bbb222", to: "piper" }),
      makeTask({ id: "ccc333", to: "glados-gpu" }),
    ];
    mockListTaskStates.mockResolvedValue(tasks);

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await logsModule.logs({ json: true, peer: "glados" });

    const parsed = JSON.parse(spy.mock.calls[0][0] as string) as TaskState[];
    // "glados" and "glados-gpu" should match, "piper" should not
    expect(parsed).toHaveLength(2);
    expect(parsed.map((t) => t.id)).not.toContain("bbb222");
  });

  it("applies limit", async () => {
    const tasks = Array.from({ length: 30 }, (_, i) =>
      makeTask({ id: `t${String(i).padStart(3, "0")}` }),
    );
    mockListTaskStates.mockResolvedValue(tasks);

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await logsModule.logs({ json: true, limit: "5" });

    const parsed = JSON.parse(spy.mock.calls[0][0] as string) as TaskState[];
    expect(parsed).toHaveLength(5);
  });

  it("sorts newest-first in JSON output", async () => {
    const tasks = [
      makeTask({ id: "old", created_at: "2026-03-10T00:00:00Z" }),
      makeTask({ id: "new", created_at: "2026-03-15T00:00:00Z" }),
      makeTask({ id: "mid", created_at: "2026-03-12T00:00:00Z" }),
    ];
    mockListTaskStates.mockResolvedValue(tasks);

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await logsModule.logs({ json: true });

    const parsed = JSON.parse(spy.mock.calls[0][0] as string) as TaskState[];
    expect(parsed[0].id).toBe("new");
    expect(parsed[1].id).toBe("mid");
    expect(parsed[2].id).toBe("old");
  });
});

// ---------------------------------------------------------------------------
// Since filter
// ---------------------------------------------------------------------------

describe("since filter", () => {
  it("filters tasks older than --since window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));

    const tasks = [
      makeTask({ id: "recent", created_at: "2026-03-15T11:00:00Z" }),   // 1h ago
      makeTask({ id: "old",    created_at: "2026-03-14T10:00:00Z" }),   // 26h ago
    ];
    mockListTaskStates.mockResolvedValue(tasks);

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await logsModule.logs({ json: true, since: "24h" });

    const parsed = JSON.parse(spy.mock.calls[0][0] as string) as TaskState[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("recent");

    vi.useRealTimers();
  });

  it("handles minutes (30m)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));

    const tasks = [
      makeTask({ id: "fresh",  created_at: "2026-03-15T11:45:00Z" }),   // 15m ago
      makeTask({ id: "stale",  created_at: "2026-03-15T11:00:00Z" }),   // 60m ago
    ];
    mockListTaskStates.mockResolvedValue(tasks);

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await logsModule.logs({ json: true, since: "30m" });

    const parsed = JSON.parse(spy.mock.calls[0][0] as string) as TaskState[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("fresh");

    vi.useRealTimers();
  });

  it("ignores invalid since string", async () => {
    const tasks = [
      makeTask({ id: "t1" }),
      makeTask({ id: "t2" }),
    ];
    mockListTaskStates.mockResolvedValue(tasks);

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    // "yesterday" is not a valid duration string — should show all tasks
    await logsModule.logs({ json: true, since: "yesterday" });

    const parsed = JSON.parse(spy.mock.calls[0][0] as string) as TaskState[];
    expect(parsed).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe("empty state", () => {
  it("shows empty message when no tasks exist", async () => {
    mockListTaskStates.mockResolvedValue([]);

    const { log } = await import("@clack/prompts");

    await logsModule.logs({});

    // Should have called p.log.info with "No tasks found" message
    const infoCalls = (log.info as ReturnType<typeof vi.fn>).mock.calls;
    const msgs = infoCalls.map((c: unknown[]) => c[0] as string);
    expect(msgs.some((m) => m.includes("No tasks found"))).toBe(true);
  });

  it("shows hint to run cofounder send when no tasks at all", async () => {
    mockListTaskStates.mockResolvedValue([]);

    const { log } = await import("@clack/prompts");

    await logsModule.logs({});

    const infoCalls = (log.info as ReturnType<typeof vi.fn>).mock.calls;
    const msgs = infoCalls.map((c: unknown[]) => c[0] as string);
    expect(msgs.some((m) => m.includes("cofounder send"))).toBe(true);
  });

  it("shows filter-match empty when tasks exist but none match filter", async () => {
    const tasks = [makeTask({ id: "t1", status: "completed" })];
    mockListTaskStates.mockResolvedValue(tasks);

    const { log } = await import("@clack/prompts");

    await logsModule.logs({ status: "failed" });

    const infoCalls = (log.info as ReturnType<typeof vi.fn>).mock.calls;
    const msgs = infoCalls.map((c: unknown[]) => c[0] as string);
    // No tasks match "failed" — should say "No tasks found"
    expect(msgs.some((m) => m.includes("No tasks found"))).toBe(true);
    // But should NOT show the "cofounder send" hint (tasks do exist)
    expect(msgs.some((m) => m.includes("cofounder send"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Status filter
// ---------------------------------------------------------------------------

describe("status filter", () => {
  const allStatuses = ["pending", "running", "completed", "failed", "timeout", "cancelled"] as const;

  for (const status of allStatuses) {
    it(`filters to ${status} tasks`, async () => {
      const tasks = allStatuses.map((s) => makeTask({ id: s, status: s }));
      mockListTaskStates.mockResolvedValue(tasks);

      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      await logsModule.logs({ json: true, status });

      const parsed = JSON.parse(spy.mock.calls[0][0] as string) as TaskState[];
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe(status);
    });
  }
});

// ---------------------------------------------------------------------------
// Peer filter
// ---------------------------------------------------------------------------

describe("peer filter", () => {
  it("is case-insensitive", async () => {
    const tasks = [
      makeTask({ id: "t1", to: "GLaDOS" }),
      makeTask({ id: "t2", to: "Piper" }),
    ];
    mockListTaskStates.mockResolvedValue(tasks);

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await logsModule.logs({ json: true, peer: "glados" });

    const parsed = JSON.parse(spy.mock.calls[0][0] as string) as TaskState[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("t1");
  });

  it("matches on from field too", async () => {
    const tasks = [
      makeTask({ id: "t1", from: "glados", to: "h1" }),
      makeTask({ id: "t2", from: "h1",     to: "piper" }),
    ];
    mockListTaskStates.mockResolvedValue(tasks);

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await logsModule.logs({ json: true, peer: "glados" });

    const parsed = JSON.parse(spy.mock.calls[0][0] as string) as TaskState[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("t1");
  });
});
