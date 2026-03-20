import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadSchedules,
  saveSchedules,
  addSchedule,
  findSchedule,
  removeSchedule,
  enableSchedule,
  disableSchedule,
  updateLastRun,
  updateNextRun,
  type HHSchedule,
} from "./store.ts";

describe.sequential("schedule store", () => {
  let testDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    // Create a unique temporary directory for each test
    testDir = join(tmpdir(), `cofounder-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });

    // Override HOME to point to test directory
    originalHome = process.env.HOME;
    process.env.HOME = testDir;

    // Wait a bit to ensure unique timestamps
    await new Promise((resolve) => setTimeout(resolve, 5));
  });

  afterEach(async () => {
    // Restore original HOME
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });
  });

  it("loads empty array when no schedules file exists", async () => {
    const schedules = await loadSchedules();
    expect(schedules).toEqual([]);
  });

  it("adds a new schedule", async () => {
    const schedule = await addSchedule({
      cron: "0 2 * * *",
      task: "Test task",
    });

    expect(schedule.id).toBeDefined();
    expect(schedule.cron).toBe("0 2 * * *");
    expect(schedule.task).toBe("Test task");
    expect(schedule.enabled).toBe(true);
    expect(schedule.created_at).toBeDefined();

    const loaded = await loadSchedules();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(schedule.id);
  });

  it("adds schedule with optional fields", async () => {
    const schedule = await addSchedule({
      cron: "*/5 * * * *",
      task: "Test task",
      peer: "GLaDOS",
      latent: true,
      name: "My Schedule",
    });

    expect(schedule.peer).toBe("GLaDOS");
    expect(schedule.latent).toBe(true);
    expect(schedule.name).toBe("My Schedule");
  });

  it("finds schedule by exact ID", async () => {
    const schedule = await addSchedule({
      cron: "0 0 * * *",
      task: "Daily task",
    });

    const found = await findSchedule(schedule.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(schedule.id);
  });

  it("finds schedule by ID prefix", async () => {
    const schedule = await addSchedule({
      cron: "0 0 * * *",
      task: "Daily task",
    });

    const prefix = schedule.id.slice(0, 8);
    const found = await findSchedule(prefix);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(schedule.id);
  });

  it("returns null for non-existent schedule", async () => {
    const found = await findSchedule("nonexistent");
    expect(found).toBeNull();
  });

  it("removes a schedule", async () => {
    const schedule = await addSchedule({
      cron: "0 0 * * *",
      task: "Daily task",
    });

    const removed = await removeSchedule(schedule.id);
    expect(removed).toBe(true);

    const schedules = await loadSchedules();
    expect(schedules).toHaveLength(0);
  });

  it("returns false when removing non-existent schedule", async () => {
    const removed = await removeSchedule("nonexistent");
    expect(removed).toBe(false);
  });

  it("enables a disabled schedule", async () => {
    const schedule = await addSchedule({
      cron: "0 0 * * *",
      task: "Daily task",
    });

    // First disable it
    await disableSchedule(schedule.id);
    let found = await findSchedule(schedule.id);
    expect(found?.enabled).toBe(false);

    // Then enable it
    const enabled = await enableSchedule(schedule.id);
    expect(enabled).toBe(true);

    found = await findSchedule(schedule.id);
    expect(found?.enabled).toBe(true);
  });

  it("disables an enabled schedule", async () => {
    const schedule = await addSchedule({
      cron: "0 0 * * *",
      task: "Daily task",
    });

    const disabled = await disableSchedule(schedule.id);
    expect(disabled).toBe(true);

    const found = await findSchedule(schedule.id);
    expect(found?.enabled).toBe(false);
  });

  it("updates last_run timestamp", async () => {
    const schedule = await addSchedule({
      cron: "0 0 * * *",
      task: "Daily task",
    });

    const timestamp = "2026-03-13T10:00:00Z";
    const updated = await updateLastRun(schedule.id, timestamp);
    expect(updated).toBe(true);

    const found = await findSchedule(schedule.id);
    expect(found?.last_run).toBe(timestamp);
  });

  it("updates last_run with current time when no timestamp provided", async () => {
    const schedule = await addSchedule({
      cron: "0 0 * * *",
      task: "Daily task",
    });

    const updated = await updateLastRun(schedule.id);
    expect(updated).toBe(true);

    const found = await findSchedule(schedule.id);
    expect(found?.last_run).toBeDefined();

    // Verify it's a valid ISO timestamp
    const lastRun = new Date(found!.last_run!);
    expect(lastRun.getTime()).toBeGreaterThan(0);
  });

  it("updates next_run timestamp", async () => {
    const schedule = await addSchedule({
      cron: "0 0 * * *",
      task: "Daily task",
    });

    const timestamp = "2026-03-14T00:00:00Z";
    const updated = await updateNextRun(schedule.id, timestamp);
    expect(updated).toBe(true);

    const found = await findSchedule(schedule.id);
    expect(found?.next_run).toBe(timestamp);
  });

  it("saves and loads multiple schedules", async () => {
    await addSchedule({ cron: "0 0 * * *", task: "Task 1" });
    await addSchedule({ cron: "0 12 * * *", task: "Task 2" });
    await addSchedule({ cron: "*/15 * * * *", task: "Task 3" });

    const schedules = await loadSchedules();
    expect(schedules).toHaveLength(3);
    expect(schedules.map((s) => s.task)).toEqual(["Task 1", "Task 2", "Task 3"]);
  });

  it("persists schedules to disk", async () => {
    const schedule = await addSchedule({
      cron: "0 0 * * *",
      task: "Daily task",
    });

    // Load again (simulating a fresh process)
    const schedules = await loadSchedules();
    expect(schedules).toHaveLength(1);
    expect(schedules[0].id).toBe(schedule.id);
  });
});
