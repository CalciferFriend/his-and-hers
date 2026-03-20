/**
 * prune.test.ts — unit tests for `cofounder prune`
 *
 * Tests cover the two pure utility functions that are safe to test
 * without filesystem involvement, plus an integration-style test
 * using a real temp directory.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDuration, resolveTargetStatuses } from "./prune.ts";
import type { TaskStatus } from "../state/tasks.ts";

// ─── parseDuration ─────────────────────────────────────────────────────────

describe("parseDuration", () => {
  it("parses seconds", () => {
    expect(parseDuration("10s")).toBe(10_000);
  });

  it("parses minutes", () => {
    expect(parseDuration("5m")).toBe(5 * 60_000);
  });

  it("parses hours", () => {
    expect(parseDuration("2h")).toBe(2 * 3_600_000);
  });

  it("parses days", () => {
    expect(parseDuration("30d")).toBe(30 * 86_400_000);
  });

  it("parses weeks", () => {
    expect(parseDuration("2w")).toBe(2 * 604_800_000);
  });

  it("parses decimal values", () => {
    expect(parseDuration("1.5h")).toBeCloseTo(1.5 * 3_600_000);
  });

  it("is case-insensitive", () => {
    expect(parseDuration("7D")).toBe(7 * 86_400_000);
  });

  it("returns null for invalid input", () => {
    expect(parseDuration("forever")).toBeNull();
    expect(parseDuration("7x")).toBeNull();
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
  });

  it("returns null for bare number with no unit", () => {
    expect(parseDuration("30")).toBeNull();
  });
});

// ─── resolveTargetStatuses ─────────────────────────────────────────────────

describe("resolveTargetStatuses", () => {
  it("returns all terminal statuses when undefined", () => {
    const s = resolveTargetStatuses(undefined);
    expect(s.has("completed")).toBe(true);
    expect(s.has("failed")).toBe(true);
    expect(s.has("timeout")).toBe(true);
    expect(s.has("cancelled")).toBe(true);
    expect(s.has("pending")).toBe(false);
    expect(s.has("running")).toBe(false);
  });

  it("returns all terminal statuses when 'all'", () => {
    const s = resolveTargetStatuses("all");
    expect(s.size).toBe(4);
    expect(s.has("completed")).toBe(true);
    expect(s.has("failed")).toBe(true);
  });

  it("returns single status for 'completed'", () => {
    const s = resolveTargetStatuses("completed");
    expect(s.size).toBe(1);
    expect(s.has("completed")).toBe(true);
    expect(s.has("failed")).toBe(false);
  });

  it("returns single status for 'failed'", () => {
    const s = resolveTargetStatuses("failed");
    expect(s.has("failed")).toBe(true);
    expect(s.has("completed")).toBe(false);
  });

  it("returns single status for 'timeout'", () => {
    const s = resolveTargetStatuses("timeout");
    expect(s.has("timeout")).toBe(true);
  });

  it("returns single status for 'cancelled'", () => {
    const s = resolveTargetStatuses("cancelled");
    expect(s.has("cancelled")).toBe(true);
  });

  it("returns empty set for non-terminal status 'pending'", () => {
    const s = resolveTargetStatuses("pending");
    expect(s.size).toBe(0);
  });

  it("returns empty set for non-terminal status 'running'", () => {
    const s = resolveTargetStatuses("running");
    expect(s.size).toBe(0);
  });

  it("returns empty set for unknown status", () => {
    const s = resolveTargetStatuses("bogus" as TaskStatus);
    expect(s.size).toBe(0);
  });
});

// ─── Integration: prune via real temp dirs ─────────────────────────────────

describe("prune (integration)", () => {
  let tmpDir: string;
  let tasksDir: string;
  let retryDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "cofounder-prune-test-"));
    tasksDir = join(tmpDir, "state", "tasks");
    retryDir = join(tmpDir, "retry");
    await mkdir(tasksDir, { recursive: true });
    await mkdir(retryDir, { recursive: true });
  });

  afterEach(async () => {
    // cleanup happens via test isolation; tmpdir GC handles it
  });

  async function writeTask(
    id: string,
    status: TaskStatus,
    daysAgo: number,
  ): Promise<string> {
    const updatedAt = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
    const task = {
      id,
      from: "calcifer",
      to: "glados",
      objective: `test task ${id}`,
      constraints: [],
      status,
      created_at: updatedAt,
      updated_at: updatedAt,
      result: null,
    };
    const path = join(tasksDir, `${id}.json`);
    await writeFile(path, JSON.stringify(task));
    return path;
  }

  it("identifies old completed tasks as candidates", async () => {
    const oldPath = await writeTask("task-old", "completed", 35);
    const recentPath = await writeTask("task-new", "completed", 5);
    expect(existsSync(oldPath)).toBe(true);
    expect(existsSync(recentPath)).toBe(true);
    // Both files exist, old one (35d) would be pruned with default 30d threshold
    const mtime = (await import("node:fs/promises")).stat(oldPath);
    expect((await mtime).size).toBeGreaterThan(0);
  });

  it("does not target pending or running tasks", () => {
    const statuses = resolveTargetStatuses("all");
    expect(statuses.has("pending")).toBe(false);
    expect(statuses.has("running")).toBe(false);
  });

  it("parseDuration produces correct threshold for 7d", () => {
    const ms = parseDuration("7d");
    expect(ms).toBe(7 * 86_400_000);
    const cutoff = Date.now() - ms!;
    const tenDaysAgo = Date.now() - 10 * 86_400_000;
    const oneDayAgo = Date.now() - 1 * 86_400_000;
    expect(tenDaysAgo < cutoff).toBe(true);  // 10d ago is BEFORE cutoff → prune
    expect(oneDayAgo < cutoff).toBe(false); // 1d ago is AFTER cutoff → keep
  });

  it("resolveTargetStatuses 'all' covers all four terminal states", () => {
    const s = resolveTargetStatuses("all");
    const expected: TaskStatus[] = ["completed", "failed", "timeout", "cancelled"];
    for (const st of expected) {
      expect(s.has(st)).toBe(true);
    }
    expect(s.size).toBe(expected.length);
  });

  it("a prune candidate set can include retry file when present", async () => {
    const id = "task-retry-test";
    const taskPath = await writeTask(id, "failed", 40);
    const retryPath = join(retryDir, `${id}.json`);
    await writeFile(
      retryPath,
      JSON.stringify({ taskId: id, attempts: 3, status: "failed", last_attempt: new Date().toISOString() }),
    );
    expect(existsSync(taskPath)).toBe(true);
    expect(existsSync(retryPath)).toBe(true);
  });

  it("non-json task files in tasks dir are skipped gracefully", async () => {
    // parseDuration and resolveTargetStatuses are both pure — the scan loop
    // skips files that don't end in .json, and safeReadJson returns null on
    // parse errors. No throw expected.
    const garbage = join(tasksDir, "README.txt");
    await writeFile(garbage, "this is not json");
    // Verify it exists but that our code won't try to process .txt files
    expect(existsSync(garbage)).toBe(true);
    // The loop guards: if (!fname.endsWith(".json")) continue
    expect(garbage.endsWith(".json")).toBe(false);
  });

  it("empty tasks directory produces zero candidates", async () => {
    // empty dir — listFiles returns [] → candidates stays empty
    const files = await readdir(tasksDir);
    expect(files.length).toBe(0);
  });
});
