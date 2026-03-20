/**
 * commands/tag.test.ts — unit tests for `cofounder tag` subcommands
 *
 * Phase 17b — Calcifer (2026-03-16)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock state ──────────────────────────────────────────────────────────────

let _records: Record<string, any> = {};
let _tasks: any[] = [];

vi.mock("@cofounder/core", () => ({
  validateTag: (name: string) => {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) return "Tag name cannot be empty";
    if (trimmed.length > 32) return "Tag name exceeds 32 characters";
    if (!/^[a-z0-9-]+$/.test(trimmed)) return "Tag name must be lowercase alphanumeric + hyphen only";
    return null;
  },
  addTag: vi.fn(async (taskId: string, tags: string[], note?: string) => {
    const existing = _records[taskId];
    const normalised = tags.map((t) => t.trim().toLowerCase());
    const merged = existing
      ? [...new Set([...existing.tags, ...normalised])]
      : [...new Set(normalised)];
    if (merged.length > 20) throw new Error("Cannot exceed 20 tags per task");
    const rec = {
      task_id: taskId,
      tags: merged,
      note: note ?? existing?.note,
      tagged_at: existing?.tagged_at ?? new Date().toISOString(),
    };
    _records[taskId] = rec;
    return rec;
  }),
  removeTag: vi.fn(async (taskId: string, tags: string[]) => {
    const existing = _records[taskId];
    if (!existing) return { task_id: taskId, tags: [], tagged_at: new Date().toISOString() };
    const toRemove = new Set(tags.map((t) => t.trim().toLowerCase()));
    const remaining = existing.tags.filter((t: string) => !toRemove.has(t));
    const rec = { ...existing, tags: remaining };
    _records[taskId] = rec;
    return rec;
  }),
  getTagRecord: vi.fn(async (taskId: string) => _records[taskId] ?? null),
  listTagRecords: vi.fn(async () => Object.values(_records)),
  findByTag: vi.fn(async (tag: string) => {
    const norm = tag.trim().toLowerCase();
    return Object.values(_records).filter((r: any) => r.tags.includes(norm));
  }),
  clearTagRecord: vi.fn(async (taskId: string) => {
    if (_records[taskId]) {
      delete _records[taskId];
      return true;
    }
    return false;
  }),
}));

vi.mock("../state/tasks.ts", () => ({
  listTaskStates: vi.fn(() => _tasks),
}));

vi.mock("@clack/prompts", () => ({
  log: { success: vi.fn(), info: vi.fn(), warn: vi.fn() },
  confirm: vi.fn().mockResolvedValue(true),
  isCancel: (v: any) => v === Symbol.for("cancel"),
}));

// ─── Import after mocks ──────────────────────────────────────────────────────

const { tagAdd, tagRemove, tagList, tagSearch, tagClear } = await import("./tag.ts");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("tagAdd", () => {
  beforeEach(() => {
    _records = {};
    _tasks = [
      { id: "abc12345-full-id", objective: "Deploy the app to production", from: "calcifer", to: "glados", status: "completed", created_at: "2026-03-16T10:00:00Z", updated_at: "2026-03-16T10:00:00Z", result: null, constraints: [] },
      { id: "def67890-full-id", objective: "Review PR #42", from: "calcifer", to: "glados", status: "completed", created_at: "2026-03-16T11:00:00Z", updated_at: "2026-03-16T11:00:00Z", result: null, constraints: [] },
    ];
    process.exitCode = 0;
  });

  it("resolves prefix and adds tags", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await tagAdd("abc", ["deploy", "prod"], {});
    log.mockRestore();
    expect(_records["abc12345-full-id"]).toBeDefined();
    expect(_records["abc12345-full-id"].tags).toContain("deploy");
    expect(_records["abc12345-full-id"].tags).toContain("prod");
  });

  it("outputs JSON when --json set", async () => {
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((v) => out.push(v));
    await tagAdd("abc", ["deploy"], { json: true });
    vi.restoreAllMocks();
    const parsed = JSON.parse(out.join(""));
    expect(parsed.task_id).toBe("abc12345-full-id");
    expect(parsed.tags).toContain("deploy");
  });

  it("sets exitCode 1 for unknown task prefix", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await tagAdd("zzz", ["deploy"], {});
    err.mockRestore();
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it("sets exitCode 1 for invalid tag name", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await tagAdd("abc", ["BAD TAG!"], {});
    err.mockRestore();
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it("stores a note with the tag", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await tagAdd("abc", ["deploy"], { note: "Shipped v2" });
    log.mockRestore();
    expect(_records["abc12345-full-id"].note).toBe("Shipped v2");
  });
});

describe("tagRemove", () => {
  beforeEach(() => {
    _records = {};
    _tasks = [
      { id: "abc12345-full-id", objective: "Deploy", from: "calcifer", to: "glados", status: "completed", created_at: "2026-03-16T10:00:00Z", updated_at: "2026-03-16T10:00:00Z", result: null, constraints: [] },
    ];
    process.exitCode = 0;
  });

  it("removes specific tags", async () => {
    _records["abc12345-full-id"] = { task_id: "abc12345-full-id", tags: ["deploy", "hotfix", "urgent"], tagged_at: "2026-03-16T10:00:00Z" };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await tagRemove("abc", ["hotfix"]);
    log.mockRestore();
    expect(_records["abc12345-full-id"].tags).toEqual(["deploy", "urgent"]);
  });

  it("sets exitCode 1 for unknown task prefix", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await tagRemove("zzz", ["deploy"]);
    err.mockRestore();
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});

describe("tagList", () => {
  beforeEach(() => {
    _records = {};
    _tasks = [
      { id: "abc12345-full-id", objective: "Deploy the app", from: "calcifer", to: "glados", status: "completed", created_at: "2026-03-16T10:00:00Z", updated_at: "2026-03-16T10:00:00Z", result: null, constraints: [] },
    ];
    process.exitCode = 0;
  });

  it("lists all tagged tasks", async () => {
    _records["abc12345-full-id"] = { task_id: "abc12345-full-id", tags: ["deploy"], tagged_at: "2026-03-16T10:00:00Z" };
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((v) => out.push(v));
    await tagList(undefined, {});
    vi.restoreAllMocks();
    expect(out.some((l) => l.includes("1"))).toBe(true);
  });

  it("shows tags for a specific task", async () => {
    _records["abc12345-full-id"] = { task_id: "abc12345-full-id", tags: ["deploy", "prod"], tagged_at: "2026-03-16T10:00:00Z" };
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((v) => out.push(v));
    await tagList("abc", {});
    vi.restoreAllMocks();
    expect(out.some((l) => l.includes("deploy"))).toBe(true);
  });

  it("outputs JSON for all tasks", async () => {
    _records["abc12345-full-id"] = { task_id: "abc12345-full-id", tags: ["deploy"], tagged_at: "2026-03-16T10:00:00Z" };
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((v) => out.push(v));
    await tagList(undefined, { json: true });
    vi.restoreAllMocks();
    const parsed = JSON.parse(out.join(""));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].task_id).toBe("abc12345-full-id");
  });

  it("outputs JSON for a specific task", async () => {
    _records["abc12345-full-id"] = { task_id: "abc12345-full-id", tags: ["deploy"], tagged_at: "2026-03-16T10:00:00Z" };
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((v) => out.push(v));
    await tagList("abc", { json: true });
    vi.restoreAllMocks();
    const parsed = JSON.parse(out.join(""));
    expect(parsed.task_id).toBe("abc12345-full-id");
  });
});

describe("tagSearch", () => {
  beforeEach(() => {
    _records = {};
    _tasks = [
      { id: "abc12345-full-id", objective: "Deploy the app", from: "calcifer", to: "glados", status: "completed", created_at: "2026-03-16T10:00:00Z", updated_at: "2026-03-16T10:00:00Z", result: null, constraints: [] },
      { id: "def67890-full-id", objective: "Review PR", from: "calcifer", to: "glados", status: "completed", created_at: "2026-03-16T11:00:00Z", updated_at: "2026-03-16T11:00:00Z", result: null, constraints: [] },
    ];
  });

  it("returns matching tasks", async () => {
    _records["abc12345-full-id"] = { task_id: "abc12345-full-id", tags: ["deploy"], tagged_at: "2026-03-16T10:00:00Z" };
    _records["def67890-full-id"] = { task_id: "def67890-full-id", tags: ["review"], tagged_at: "2026-03-16T11:00:00Z" };
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((v) => out.push(v));
    await tagSearch("deploy", {});
    vi.restoreAllMocks();
    expect(out.some((l) => l.includes("abc12345"))).toBe(true);
  });

  it("outputs JSON when --json set", async () => {
    _records["abc12345-full-id"] = { task_id: "abc12345-full-id", tags: ["deploy"], tagged_at: "2026-03-16T10:00:00Z" };
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((v) => out.push(v));
    await tagSearch("deploy", { json: true });
    vi.restoreAllMocks();
    const parsed = JSON.parse(out.join(""));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].task_id).toBe("abc12345-full-id");
  });
});

describe("tagClear", () => {
  beforeEach(() => {
    _records = {};
    _tasks = [
      { id: "abc12345-full-id", objective: "Deploy", from: "calcifer", to: "glados", status: "completed", created_at: "2026-03-16T10:00:00Z", updated_at: "2026-03-16T10:00:00Z", result: null, constraints: [] },
    ];
    process.exitCode = 0;
  });

  it("clears tags with --force", async () => {
    _records["abc12345-full-id"] = { task_id: "abc12345-full-id", tags: ["deploy"], tagged_at: "2026-03-16T10:00:00Z" };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await tagClear("abc", { force: true });
    log.mockRestore();
    expect(_records["abc12345-full-id"]).toBeUndefined();
  });

  it("sets exitCode 1 for unknown task prefix", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await tagClear("zzz", { force: true });
    err.mockRestore();
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});
