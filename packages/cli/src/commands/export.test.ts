/**
 * commands/export.test.ts — Tests for `cofounder export`
 *
 * Covers: parseDuration, applyFilters, buildSummary, renderMarkdown, renderCsv, renderJson.
 */

import { describe, it, expect } from "vitest";
import {
  parseDuration,
  applyFilters,
  buildSummary,
  renderMarkdown,
  renderCsv,
  renderJson,
  type ExportOptions,
} from "./export.ts";
import type { TaskState } from "../state/tasks.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<TaskState> = {}): TaskState {
  return {
    id: "abc12345-0000-0000-0000-000000000000",
    from: "Calcifer",
    to: "GLaDOS",
    objective: "Write unit tests for core module",
    constraints: [],
    status: "completed",
    created_at: new Date(Date.now() - 3_600_000).toISOString(), // 1h ago
    updated_at: new Date(Date.now() - 3_500_000).toISOString(),
    result: {
      output: "Done! Added 42 tests.",
      success: true,
      artifacts: ["packages/core/src/core.test.ts"],
      tokens_used: 1500,
      duration_ms: 12_400,
      cost_usd: 0.003,
    },
    ...overrides,
  };
}

function makeFailedTask(overrides: Partial<TaskState> = {}): TaskState {
  return makeTask({
    id: "fail5678-0000-0000-0000-000000000000",
    status: "failed",
    result: {
      output: "",
      success: false,
      error: "Timeout connecting to ollama",
      artifacts: [],
      tokens_used: 200,
      duration_ms: 30_000,
      cost_usd: 0,
    },
    ...overrides,
  });
}

// ─── parseDuration ────────────────────────────────────────────────────────────

describe("parseDuration", () => {
  it("parses seconds", () => expect(parseDuration("30s")).toBe(30_000));
  it("parses minutes", () => expect(parseDuration("5m")).toBe(300_000));
  it("parses hours", () => expect(parseDuration("2h")).toBe(7_200_000));
  it("parses days", () => expect(parseDuration("7d")).toBe(604_800_000));
  it("parses weeks", () => expect(parseDuration("1w")).toBe(7 * 86_400_000));
  it("handles decimals", () => expect(parseDuration("1.5h")).toBe(5_400_000));
  it("returns null for invalid input", () => expect(parseDuration("bad")).toBeNull());
  it("returns null for empty string", () => expect(parseDuration("")).toBeNull());
  it("is case-insensitive", () => expect(parseDuration("3D")).toBe(3 * 86_400_000));
});

// ─── applyFilters ─────────────────────────────────────────────────────────────

describe("applyFilters", () => {
  const recent = makeTask({ id: "recent-a", created_at: new Date(Date.now() - 60_000).toISOString() }); // 1m ago
  const old = makeTask({ id: "old-b", created_at: new Date(Date.now() - 7 * 86_400_000 - 60_000).toISOString() }); // 7d+ ago
  const failed = makeFailedTask({ id: "fail-c" });
  const otherPeer = makeTask({ id: "peer-d", to: "SkyNet" });

  it("returns all tasks when no filters applied", () => {
    const tasks = [recent, old, failed];
    expect(applyFilters(tasks, {})).toHaveLength(3);
  });

  it("filters by since duration", () => {
    const result = applyFilters([recent, old], { since: "1d" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("recent-a");
  });

  it("ignores invalid since string", () => {
    const result = applyFilters([recent, old], { since: "invalid" });
    expect(result).toHaveLength(2); // no filter applied
  });

  it("filters by status", () => {
    const result = applyFilters([recent, failed], { status: "failed" });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("failed");
  });

  it("filters by peer (substring match)", () => {
    const result = applyFilters([recent, otherPeer], { peer: "sky" });
    expect(result).toHaveLength(1);
    expect(result[0].to).toBe("SkyNet");
  });

  it("peer filter is case-insensitive", () => {
    const result = applyFilters([recent, otherPeer], { peer: "GLADOS" });
    expect(result).toHaveLength(1);
    expect(result[0].to).toBe("GLaDOS");
  });

  it("combines multiple filters (AND logic)", () => {
    const result = applyFilters([recent, old, failed], { since: "1d", status: "completed" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("recent-a");
  });
});

// ─── buildSummary ─────────────────────────────────────────────────────────────

describe("buildSummary", () => {
  it("counts tasks by status", () => {
    const tasks = [makeTask(), makeFailedTask()];
    const summary = buildSummary(tasks);
    expect(summary.total).toBe(2);
    expect(summary.byStatus["completed"]).toBe(1);
    expect(summary.byStatus["failed"]).toBe(1);
  });

  it("sums cost and tokens", () => {
    const tasks = [makeTask(), makeTask()];
    const summary = buildSummary(tasks);
    expect(summary.totalCostUsd).toBeCloseTo(0.006, 6);
    expect(summary.totalTokens).toBe(3000);
  });

  it("collects unique peers", () => {
    const tasks = [makeTask(), makeTask({ to: "SkyNet" }), makeTask({ to: "SkyNet" })];
    const summary = buildSummary(tasks);
    expect(summary.peers).toEqual(["GLaDOS", "SkyNet"]);
  });

  it("handles tasks with no result", () => {
    const t = makeTask({ status: "pending", result: null });
    const summary = buildSummary([t]);
    expect(summary.totalCostUsd).toBe(0);
    expect(summary.totalTokens).toBe(0);
  });

  it("sums duration", () => {
    const tasks = [makeTask(), makeTask()];
    const summary = buildSummary(tasks);
    expect(summary.totalDurationMs).toBe(24_800);
  });
});

// ─── renderMarkdown ───────────────────────────────────────────────────────────

describe("renderMarkdown", () => {
  it("includes a header", () => {
    const md = renderMarkdown([], buildSummary([]), true);
    expect(md).toContain("# cofounder Task Report");
  });

  it("shows task count in summary table", () => {
    const tasks = [makeTask(), makeFailedTask()];
    const md = renderMarkdown(tasks, buildSummary(tasks), true);
    expect(md).toContain("| Total tasks | 2 |");
  });

  it("includes task objective as heading", () => {
    const task = makeTask();
    const md = renderMarkdown([task], buildSummary([task]), true);
    expect(md).toContain("Write unit tests for core module");
  });

  it("includes output when includeOutput=true", () => {
    const task = makeTask();
    const md = renderMarkdown([task], buildSummary([task]), true);
    expect(md).toContain("Done! Added 42 tests.");
  });

  it("omits output when includeOutput=false", () => {
    const task = makeTask();
    const md = renderMarkdown([task], buildSummary([task]), false);
    expect(md).not.toContain("Done! Added 42 tests.");
  });

  it("shows error for failed task", () => {
    const task = makeFailedTask();
    const md = renderMarkdown([task], buildSummary([task]), true);
    expect(md).toContain("Timeout connecting to ollama");
  });

  it("shows no-tasks message when empty", () => {
    const md = renderMarkdown([], buildSummary([]), true);
    expect(md).toContain("No tasks found");
  });

  it("truncates very long output", () => {
    const longOutput = "x".repeat(2000);
    const task = makeTask({ result: { output: longOutput, success: true, artifacts: [] } });
    const md = renderMarkdown([task], buildSummary([task]), true);
    expect(md).toContain("chars omitted");
  });

  it("lists peers in summary", () => {
    const task = makeTask();
    const md = renderMarkdown([task], buildSummary([task]), true);
    expect(md).toContain("Peers: GLaDOS");
  });
});

// ─── renderCsv ────────────────────────────────────────────────────────────────

describe("renderCsv", () => {
  it("includes header row", () => {
    const csv = renderCsv([], true);
    expect(csv.split("\n")[0]).toContain("id,status,peer");
  });

  it("produces one data row per task", () => {
    const csv = renderCsv([makeTask(), makeFailedTask()], false);
    const lines = csv.split("\n").filter(Boolean);
    expect(lines).toHaveLength(3); // header + 2 tasks
  });

  it("includes output column when includeOutput=true", () => {
    const csv = renderCsv([], true);
    expect(csv).toContain(",output");
  });

  it("omits output column when includeOutput=false", () => {
    const csv = renderCsv([], false);
    expect(csv).not.toContain(",output");
  });

  it("escapes commas in output text", () => {
    const task = makeTask({ result: { output: "hello, world", success: true, artifacts: [] } });
    const csv = renderCsv([task], true);
    expect(csv).toContain('"hello, world"');
  });

  it("escapes double-quotes in output text", () => {
    const task = makeTask({ result: { output: 'say "hi"', success: true, artifacts: [] } });
    const csv = renderCsv([task], true);
    expect(csv).toContain('"say ""hi"""');
  });

  it("handles task with no result", () => {
    const task = makeTask({ status: "pending", result: null });
    const csv = renderCsv([task], false);
    expect(csv).toContain("pending");
  });

  it("joins multiple artifacts with pipe", () => {
    const task = makeTask({
      result: {
        output: "done",
        success: true,
        artifacts: ["a.ts", "b.ts"],
        tokens_used: 100,
        duration_ms: 1000,
      },
    });
    const csv = renderCsv([task], false);
    expect(csv).toContain("a.ts|b.ts");
  });
});

// ─── renderJson ───────────────────────────────────────────────────────────────

describe("renderJson", () => {
  it("produces valid JSON", () => {
    const tasks = [makeTask()];
    const json = renderJson(tasks, buildSummary(tasks));
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("includes summary and tasks keys", () => {
    const tasks = [makeTask()];
    const parsed = JSON.parse(renderJson(tasks, buildSummary(tasks)));
    expect(parsed).toHaveProperty("summary");
    expect(parsed).toHaveProperty("tasks");
    expect(parsed.tasks).toHaveLength(1);
  });

  it("summary totals are correct", () => {
    const tasks = [makeTask(), makeTask()];
    const parsed = JSON.parse(renderJson(tasks, buildSummary(tasks)));
    expect(parsed.summary.total).toBe(2);
    expect(parsed.summary.totalTokens).toBe(3000);
  });

  it("returns empty tasks array for no tasks", () => {
    const parsed = JSON.parse(renderJson([], buildSummary([])));
    expect(parsed.tasks).toEqual([]);
    expect(parsed.summary.total).toBe(0);
  });
});
