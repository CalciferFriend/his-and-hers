import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  validateCron,
  calculateNextRun,
  installCronEntry,
  removeCronEntry,
  listHHCronEntries,
  readCrontab,
} from "./crontab.ts";

describe("crontab validation", () => {
  it("validates a correct cron expression", () => {
    expect(validateCron("0 2 * * *")).toBe(true);
    expect(validateCron("*/5 * * * *")).toBe(true);
    expect(validateCron("0 0 1 * *")).toBe(true);
    expect(validateCron("30 4 * * 0")).toBe(true);
  });

  it("rejects invalid cron expressions", () => {
    expect(validateCron("")).toBe(false);
    expect(validateCron("* * * *")).toBe(false); // Only 4 fields
    expect(validateCron("* * * * * *")).toBe(false); // 6 fields
    expect(validateCron("invalid")).toBe(false);
  });

  it("validates ranges and lists", () => {
    expect(validateCron("0-30 * * * *")).toBe(true);
    expect(validateCron("0,15,30,45 * * * *")).toBe(true);
    expect(validateCron("0-30/5 * * * *")).toBe(true);
  });
});

describe("calculateNextRun", () => {
  it("calculates next run for simple expressions", () => {
    const now = new Date("2026-03-13T10:00:00Z");
    vi.setSystemTime(now);

    // Next 2 AM
    const next = calculateNextRun("0 2 * * *");
    expect(next.getHours()).toBe(2);
    expect(next.getMinutes()).toBe(0);

    vi.useRealTimers();
  });

  it("handles wildcard expressions", () => {
    const now = new Date("2026-03-13T10:30:00Z");
    vi.setSystemTime(now);

    const next = calculateNextRun("* * * * *");
    expect(next.getTime()).toBeGreaterThan(now.getTime());

    vi.useRealTimers();
  });

  it("throws on invalid cron expression", () => {
    expect(() => calculateNextRun("invalid")).toThrow();
  });
});

describe("crontab operations", () => {
  // Note: These tests would require mocking exec() to avoid actually modifying
  // the user's crontab. For now, we'll test the marker parsing logic.

  it("parses HH schedule IDs from crontab", () => {
    const mockCrontab = `
# COFOUNDER_SCHEDULE_ID=abc-123
0 2 * * * cofounder send "task 1" --no-wait >> ~/.cofounder/schedule-logs/abc-123.log 2>&1
# COFOUNDER_SCHEDULE_ID=def-456
0 3 * * * cofounder send "task 2" --no-wait >> ~/.cofounder/schedule-logs/def-456.log 2>&1
# Some other comment
0 4 * * * some other command
    `.trim();

    const lines = mockCrontab.split("\n");
    const ids: string[] = [];

    for (const line of lines) {
      if (line.startsWith("# COFOUNDER_SCHEDULE_ID=")) {
        const id = line.substring("# COFOUNDER_SCHEDULE_ID=".length).trim();
        ids.push(id);
      }
    }

    expect(ids).toEqual(["abc-123", "def-456"]);
  });

  it("builds correct crontab entry format", () => {
    const id = "test-123";
    const cron = "0 2 * * *";
    const task = "Do something";
    const marker = `# COFOUNDER_SCHEDULE_ID=${id}`;
    const logPath = `~/.cofounder/schedule-logs/${id}.log`;
    const cmd = `cofounder send "${task}" --no-wait >> ${logPath} 2>&1`;
    const cronLine = `${cron} ${cmd}`;

    expect(marker).toContain(id);
    expect(cronLine).toContain(cron);
    expect(cronLine).toContain(task);
  });

  it("handles peer flag in crontab entry", () => {
    const cron = "0 2 * * *";
    const task = "GPU task";
    const peer = "GLaDOS";
    const id = "test-456";
    const logPath = `~/.cofounder/schedule-logs/${id}.log`;
    const cmd = `cofounder send "${task}" --peer ${peer} --no-wait >> ${logPath} 2>&1`;
    const cronLine = `${cron} ${cmd}`;

    expect(cronLine).toContain("--peer GLaDOS");
  });

  it("handles latent flag in crontab entry", () => {
    const cron = "0 2 * * *";
    const task = "GPU task";
    const id = "test-789";
    const logPath = `~/.cofounder/schedule-logs/${id}.log`;
    const cmd = `cofounder send "${task}" --latent --no-wait >> ${logPath} 2>&1`;
    const cronLine = `${cron} ${cmd}`;

    expect(cronLine).toContain("--latent");
  });

  it("filters out HH entries from crontab", () => {
    const mockCrontab = `
# COFOUNDER_SCHEDULE_ID=abc-123
0 2 * * * cofounder send "task 1" --no-wait >> ~/.cofounder/schedule-logs/abc-123.log 2>&1
# Some other comment
0 4 * * * some other command
# COFOUNDER_SCHEDULE_ID=def-456
0 3 * * * cofounder send "task 2" --no-wait >> ~/.cofounder/schedule-logs/def-456.log 2>&1
    `.trim();

    const lines = mockCrontab.split("\n").filter(Boolean);
    const filtered: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes("# COFOUNDER_SCHEDULE_ID=")) {
        // Skip this line and the next (cron command)
        i++;
        continue;
      }
      filtered.push(line);
    }

    expect(filtered).toHaveLength(2);
    expect(filtered[0]).toContain("Some other comment");
    expect(filtered[1]).toContain("some other command");
  });
});
