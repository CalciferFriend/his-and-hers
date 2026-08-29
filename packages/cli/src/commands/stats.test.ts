import { describe, it, expect } from "vitest";
import { buildAnalytics } from "./stats.ts";
import type { TaskState } from "../state/tasks.ts";

describe("stats", () => {
  describe("buildAnalytics", () => {
    it("should return zero stats for empty task list", () => {
      const analytics = buildAnalytics([], 14);

      expect(analytics.total_tasks).toBe(0);
      expect(analytics.completed).toBe(0);
      expect(analytics.failed).toBe(0);
      expect(analytics.pending).toBe(0);
      expect(analytics.success_rate).toBe(0);
      expect(analytics.tasks_per_day).toHaveLength(14);
      expect(analytics.hourly_heatmap).toHaveLength(24);
      expect(analytics.peer_breakdown).toHaveLength(0);
      expect(analytics.top_task_types).toHaveLength(0);
    });

    it("should calculate total tasks correctly", () => {
      const tasks: TaskState[] = [
        createTask("1", "completed"),
        createTask("2", "failed"),
        createTask("3", "pending"),
      ];

      const analytics = buildAnalytics(tasks, 14);

      expect(analytics.total_tasks).toBe(3);
    });

    it("should count completed tasks", () => {
      const tasks: TaskState[] = [
        createTask("1", "completed"),
        createTask("2", "completed"),
        createTask("3", "failed"),
      ];

      const analytics = buildAnalytics(tasks, 14);

      expect(analytics.completed).toBe(2);
    });

    it("should count failed and timeout tasks as failed", () => {
      const tasks: TaskState[] = [
        createTask("1", "failed"),
        createTask("2", "timeout"),
        createTask("3", "completed"),
      ];

      const analytics = buildAnalytics(tasks, 14);

      expect(analytics.failed).toBe(2);
    });

    it("should count pending and running tasks as pending", () => {
      const tasks: TaskState[] = [
        createTask("1", "pending"),
        createTask("2", "running"),
        createTask("3", "completed"),
      ];

      const analytics = buildAnalytics(tasks, 14);

      expect(analytics.pending).toBe(2);
    });

    it("should calculate success rate correctly", () => {
      const tasks: TaskState[] = [
        createTask("1", "completed"),
        createTask("2", "completed"),
        createTask("3", "failed"),
        createTask("4", "pending"), // Excluded from success rate
      ];

      const analytics = buildAnalytics(tasks, 14);

      expect(analytics.success_rate).toBeCloseTo(66.67, 1);
    });

    it("should handle 100% success rate", () => {
      const tasks: TaskState[] = [
        createTask("1", "completed"),
        createTask("2", "completed"),
      ];

      const analytics = buildAnalytics(tasks, 14);

      expect(analytics.success_rate).toBe(100);
    });

    it("should handle 0% success rate", () => {
      const tasks: TaskState[] = [
        createTask("1", "failed"),
        createTask("2", "failed"),
      ];

      const analytics = buildAnalytics(tasks, 14);

      expect(analytics.success_rate).toBe(0);
    });

    it("should bucket tasks per day correctly", () => {
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);

      const tasks: TaskState[] = [
        createTask("1", "completed", today),
        createTask("2", "completed", today),
        createTask("3", "failed", yesterdayStr),
      ];

      const analytics = buildAnalytics(tasks, 7);

      const todayBucket = analytics.tasks_per_day.find((d) => d.date === today);
      const yesterdayBucket = analytics.tasks_per_day.find((d) => d.date === yesterdayStr);

      expect(todayBucket?.count).toBe(2);
      expect(yesterdayBucket?.count).toBe(1);
      expect(analytics.tasks_per_day).toHaveLength(7);
    });

    it("should initialize all day buckets even if no tasks", () => {
      const analytics = buildAnalytics([], 7);

      expect(analytics.tasks_per_day).toHaveLength(7);
      expect(analytics.tasks_per_day.every((d) => d.count === 0)).toBe(true);
    });

    it("should build hourly heatmap correctly", () => {
      const tasks: TaskState[] = [
        createTask("1", "completed", new Date("2024-01-01T09:30:00Z").toISOString()),
        createTask("2", "completed", new Date("2024-01-01T09:45:00Z").toISOString()),
        createTask("3", "failed", new Date("2024-01-01T14:00:00Z").toISOString()),
      ];

      const analytics = buildAnalytics(tasks, 14);

      expect(analytics.hourly_heatmap).toHaveLength(24);
      expect(analytics.hourly_heatmap[9]).toBe(2); // 9 AM
      expect(analytics.hourly_heatmap[14]).toBe(1); // 2 PM
      expect(analytics.hourly_heatmap[0]).toBe(0); // Midnight
    });

    it("should aggregate peer breakdown correctly", () => {
      const tasks: TaskState[] = [
        createTask("1", "completed", undefined, "glados", 5000, 0.05),
        createTask("2", "completed", undefined, "glados", 3000, 0.03),
        createTask("3", "failed", undefined, "glados"),
        createTask("4", "completed", undefined, "piper", 2000, 0.02),
      ];

      const analytics = buildAnalytics(tasks, 14);

      expect(analytics.peer_breakdown).toHaveLength(2);

      const glados = analytics.peer_breakdown.find((p) => p.peer === "glados");
      const piper = analytics.peer_breakdown.find((p) => p.peer === "piper");

      expect(glados?.tasks_sent).toBe(3);
      expect(glados?.success_rate).toBeCloseTo(66.67, 1);
      expect(glados?.avg_duration_ms).toBe(4000); // (5000 + 3000) / 2
      expect(glados?.avg_cost_usd).toBeCloseTo(0.04, 2); // (0.05 + 0.03) / 2

      expect(piper?.tasks_sent).toBe(1);
      expect(piper?.success_rate).toBe(100);
      expect(piper?.avg_duration_ms).toBe(2000);
      expect(piper?.avg_cost_usd).toBeCloseTo(0.02, 2);
    });

    it("should sort peer breakdown by task count descending", () => {
      const tasks: TaskState[] = [
        createTask("1", "completed", undefined, "alpha"),
        createTask("2", "completed", undefined, "beta"),
        createTask("3", "completed", undefined, "beta"),
        createTask("4", "completed", undefined, "beta"),
        createTask("5", "completed", undefined, "gamma"),
        createTask("6", "completed", undefined, "gamma"),
      ];

      const analytics = buildAnalytics(tasks, 14);

      expect(analytics.peer_breakdown[0].peer).toBe("beta"); // 3 tasks
      expect(analytics.peer_breakdown[1].peer).toBe("gamma"); // 2 tasks
      expect(analytics.peer_breakdown[2].peer).toBe("alpha"); // 1 task
    });

    it("should extract top task types from objective first word", () => {
      const tasks: TaskState[] = [
        createTaskWithObjective("1", "review PR #123"),
        createTaskWithObjective("2", "review code changes"),
        createTaskWithObjective("3", "deploy to production"),
        createTaskWithObjective("4", "fix bug in auth"),
        createTaskWithObjective("5", "review latest commit"),
      ];

      const analytics = buildAnalytics(tasks, 14);

      expect(analytics.top_task_types).toHaveLength(3);
      expect(analytics.top_task_types[0]).toEqual({ pattern: "review", count: 3 });
      expect(analytics.top_task_types[1]).toEqual({ pattern: "deploy", count: 1 });
      expect(analytics.top_task_types[2]).toEqual({ pattern: "fix", count: 1 });
    });

    it("should sort top task types by count descending", () => {
      const tasks: TaskState[] = [
        createTaskWithObjective("1", "fix bug"),
        createTaskWithObjective("2", "deploy app"),
        createTaskWithObjective("3", "fix issue"),
        createTaskWithObjective("4", "fix error"),
        createTaskWithObjective("5", "deploy service"),
      ];

      const analytics = buildAnalytics(tasks, 14);

      expect(analytics.top_task_types[0].pattern).toBe("fix"); // 3 occurrences
      expect(analytics.top_task_types[0].count).toBe(3);
      expect(analytics.top_task_types[1].pattern).toBe("deploy"); // 2 occurrences
      expect(analytics.top_task_types[1].count).toBe(2);
    });

    it("should handle tasks with empty objectives gracefully", () => {
      const tasks: TaskState[] = [
        createTaskWithObjective("1", ""),
        createTaskWithObjective("2", "   "),
        createTaskWithObjective("3", "fix bug"),
      ];

      const analytics = buildAnalytics(tasks, 14);

      expect(analytics.top_task_types).toHaveLength(2);
      const unknownPattern = analytics.top_task_types.find((t) => t.pattern === "unknown");
      expect(unknownPattern?.count).toBe(2);
    });

    it("should handle peer with no completed tasks in avg calculations", () => {
      const tasks: TaskState[] = [
        createTask("1", "pending", undefined, "glados"),
        createTask("2", "failed", undefined, "glados"),
      ];

      const analytics = buildAnalytics(tasks, 14);

      const glados = analytics.peer_breakdown.find((p) => p.peer === "glados");

      expect(glados?.avg_duration_ms).toBe(0);
      expect(glados?.avg_cost_usd).toBe(0);
    });

    it("should only count terminal tasks in success rate", () => {
      const tasks: TaskState[] = [
        createTask("1", "completed"),
        createTask("2", "failed"),
        createTask("3", "pending"),
        createTask("4", "running"),
        createTask("5", "cancelled"),
      ];

      const analytics = buildAnalytics(tasks, 14);

      // Success rate = 1 / (1 + 1) = 50%
      // Pending, running, cancelled are excluded
      expect(analytics.success_rate).toBe(50);
    });
  });
});

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createTask(
  id: string,
  status: TaskState["status"],
  created_at?: string,
  to = "glados",
  duration_ms?: number,
  cost_usd?: number,
): TaskState {
  const now = created_at ?? new Date().toISOString();
  return {
    id,
    from: "calcifer",
    to,
    objective: "test task",
    constraints: [],
    status,
    created_at: now,
    updated_at: now,
    result:
      duration_ms !== undefined || cost_usd !== undefined
        ? {
            output: "done",
            success: status === "completed",
            artifacts: [],
            duration_ms,
            cost_usd,
          }
        : null,
  };
}

function createTaskWithObjective(id: string, objective: string): TaskState {
  return {
    ...createTask(id, "completed"),
    objective,
  };
}
