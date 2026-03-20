/**
 * context.test.ts — unit tests for `cofounder context` subcommands
 *
 * Tests: list, show, clear, prune with various scenarios.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Hoist mock fns so they're available before module evaluation ────────────

const {
  mockReaddir,
  mockLoadContextEntries,
  mockClearContextEntries,
  mockWriteFile,
} = vi.hoisted(() => ({
  mockReaddir: vi.fn(),
  mockLoadContextEntries: vi.fn(),
  mockClearContextEntries: vi.fn(),
  mockWriteFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readdir: mockReaddir,
  writeFile: mockWriteFile,
}));

vi.mock("@cofounder/core/context/store", () => ({
  loadContextEntries: mockLoadContextEntries,
  clearContextEntries: mockClearContextEntries,
}));

// Suppress clack output in tests
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), step: vi.fn(), success: vi.fn() },
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

import type { ContextEntry } from "@cofounder/core/context/store";

const ENTRY_1: ContextEntry = {
  task_id: "task-001",
  summary: "Task: First task\nResult: Done",
  created_at: "2026-03-10T12:00:00Z",
};

const ENTRY_2: ContextEntry = {
  task_id: "task-002",
  summary: "Task: Second task\nResult: Complete",
  created_at: "2026-03-15T14:00:00Z",
};

const OLD_ENTRY: ContextEntry = {
  task_id: "task-old",
  summary: "Task: Old task\nResult: Ancient",
  created_at: "2026-01-01T00:00:00Z",
};

// Suppress console output
const origLog = console.log;
const origError = console.error;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("cofounder context list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    console.log = vi.fn();
    console.error = vi.fn();
    process.exitCode = undefined;
  });

  afterEach(() => {
    console.log = origLog;
    console.error = origError;
  });

  it("shows 'No peers' when context directory is empty", async () => {
    mockReaddir.mockRejectedValue(new Error("ENOENT"));

    const { contextList } = await import("./context.ts");
    await contextList();

    const p = await import("@clack/prompts");
    expect(p.log.info).toHaveBeenCalledWith("No peers with stored context.");
  });

  it("lists single peer with entry count and timestamp", async () => {
    mockReaddir.mockResolvedValue(["glados.json"]);
    mockLoadContextEntries.mockResolvedValue([ENTRY_1, ENTRY_2]);

    const { contextList } = await import("./context.ts");
    await contextList();

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("glados"),
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("2 entries"),
    );
  });

  it("lists multiple peers sorted by most recent first", async () => {
    mockReaddir.mockResolvedValue(["glados.json", "calcifer.json"]);
    mockLoadContextEntries
      .mockResolvedValueOnce([ENTRY_2]) // glados (Mar 15)
      .mockResolvedValueOnce([ENTRY_1]); // calcifer (Mar 10)

    const { contextList } = await import("./context.ts");
    await contextList();

    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .filter((s) => typeof s === "string" && s.includes("entry"));

    // glados (Mar 15) should come before calcifer (Mar 10)
    const gladosIdx = calls.findIndex((s: string) => s.includes("glados"));
    const calciferIdx = calls.findIndex((s: string) => s.includes("calcifer"));

    expect(gladosIdx).toBeGreaterThanOrEqual(0);
    expect(calciferIdx).toBeGreaterThanOrEqual(0);
    expect(gladosIdx).toBeLessThan(calciferIdx);
  });

  it("handles peer with zero entries", async () => {
    mockReaddir.mockResolvedValue(["empty.json"]);
    mockLoadContextEntries.mockResolvedValue([]);

    const { contextList } = await import("./context.ts");
    await contextList();

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("0 entries"),
    );
  });
});

describe("cofounder context show", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    console.log = vi.fn();
    console.error = vi.fn();
    process.exitCode = undefined;
  });

  afterEach(() => {
    console.log = origLog;
    console.error = origError;
  });

  it("shows all entries for a peer", async () => {
    mockLoadContextEntries.mockResolvedValue([ENTRY_1, ENTRY_2]);

    const { contextShow } = await import("./context.ts");
    await contextShow("glados");

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("2 entries"),
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("task-001"),
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("task-002"),
    );
  });

  it("shows 'No context stored' when peer has no entries", async () => {
    mockLoadContextEntries.mockResolvedValue([]);

    const { contextShow } = await import("./context.ts");
    await contextShow("unknown-peer");

    const p = await import("@clack/prompts");
    expect(p.log.info).toHaveBeenCalledWith(
      expect.stringContaining("No context stored"),
    );
  });

  it("displays task summaries with correct formatting", async () => {
    mockLoadContextEntries.mockResolvedValue([ENTRY_1]);

    const { contextShow } = await import("./context.ts");
    await contextShow("glados");

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("First task"),
    );
  });
});

describe("cofounder context clear", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    console.log = vi.fn();
    console.error = vi.fn();
    process.exitCode = undefined;
  });

  afterEach(() => {
    console.log = origLog;
    console.error = origError;
  });

  it("calls clearContextEntries and shows success message", async () => {
    mockClearContextEntries.mockResolvedValue(undefined);

    const { contextClear } = await import("./context.ts");
    await contextClear("glados");

    expect(mockClearContextEntries).toHaveBeenCalledWith("glados");

    const p = await import("@clack/prompts");
    expect(p.log.success).toHaveBeenCalledWith(
      expect.stringContaining("Context cleared"),
    );
  });

  it("sets exitCode on error", async () => {
    mockClearContextEntries.mockRejectedValue(new Error("Write failed"));

    const { contextClear } = await import("./context.ts");
    await contextClear("glados");

    expect(process.exitCode).toBe(1);
  });
});

describe("cofounder context prune", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    console.log = vi.fn();
    console.error = vi.fn();
    process.exitCode = undefined;
    mockWriteFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    console.log = origLog;
    console.error = origError;
  });

  it("removes entries older than cutoff date", async () => {
    mockReaddir.mockResolvedValue(["glados.json"]);
    mockLoadContextEntries.mockResolvedValue([OLD_ENTRY, ENTRY_2]);

    const { contextPrune } = await import("./context.ts");
    await contextPrune(30); // 30 days

    // Should have written filtered entries (only ENTRY_2 remains)
    expect(mockWriteFile).toHaveBeenCalledOnce();
    const writtenData = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
    expect(writtenData).toHaveLength(1);
    expect(writtenData[0].task_id).toBe("task-002");
  });

  it("keeps all recent entries when none are old enough", async () => {
    mockReaddir.mockResolvedValue(["glados.json"]);
    mockLoadContextEntries.mockResolvedValue([ENTRY_1, ENTRY_2]);

    const { contextPrune } = await import("./context.ts");
    await contextPrune(30);

    // No files should be modified
    expect(mockWriteFile).not.toHaveBeenCalled();

    const p = await import("@clack/prompts");
    expect(p.log.info).toHaveBeenCalledWith(
      expect.stringContaining("No entries older"),
    );
  });

  it("shows 'No context files' when directory is empty", async () => {
    mockReaddir.mockResolvedValue([]);

    const { contextPrune } = await import("./context.ts");
    await contextPrune(30);

    const p = await import("@clack/prompts");
    expect(p.log.info).toHaveBeenCalledWith("No context files to prune.");
  });

  it("prunes entries from multiple peers", async () => {
    mockReaddir.mockResolvedValue(["peer1.json", "peer2.json"]);
    mockLoadContextEntries
      .mockResolvedValueOnce([OLD_ENTRY, ENTRY_1]) // peer1
      .mockResolvedValueOnce([OLD_ENTRY, ENTRY_2]); // peer2

    const { contextPrune } = await import("./context.ts");
    await contextPrune(30);

    expect(mockWriteFile).toHaveBeenCalledTimes(2);

    const p = await import("@clack/prompts");
    expect(p.log.success).toHaveBeenCalledWith(
      expect.stringContaining("Removed 2"),
    );
  });

  it("uses custom days parameter correctly", async () => {
    mockReaddir.mockResolvedValue(["glados.json"]);
    // Entry from 10 days ago
    const recentEntry: ContextEntry = {
      task_id: "task-recent",
      summary: "Recent",
      created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    };
    mockLoadContextEntries.mockResolvedValue([recentEntry]);

    const { contextPrune } = await import("./context.ts");
    await contextPrune(7); // 7 days cutoff

    // Should prune the 10-day-old entry
    expect(mockWriteFile).toHaveBeenCalledOnce();
    const writtenData = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
    expect(writtenData).toHaveLength(0);
  });

  it("logs step for each peer with removed entries", async () => {
    mockReaddir.mockResolvedValue(["glados.json"]);
    mockLoadContextEntries.mockResolvedValue([OLD_ENTRY, ENTRY_2]);

    const { contextPrune } = await import("./context.ts");
    await contextPrune(30);

    const p = await import("@clack/prompts");
    expect(p.log.step).toHaveBeenCalledWith(
      expect.stringContaining("removed 1 entry"),
    );
  });
});
