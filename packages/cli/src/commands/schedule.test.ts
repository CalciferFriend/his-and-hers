/**
 * commands/schedule.test.ts
 *
 * Unit tests for the `cofounder schedule` CLI commands.
 * All filesystem + crontab side-effects are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  scheduleAdd,
  scheduleList,
  scheduleRemove,
  scheduleEnable,
  scheduleDisable,
  scheduleRun,
} from "./schedule.ts";

// ─── Shared test fixtures ──────────────────────────────────────────────────────

const MOCK_SCHEDULE = {
  id: "aaaabbbb-cccc-dddd-eeee-ffffaaaabbbb",
  cron: "0 2 * * *",
  task: "summarise yesterday's work",
  peer: "glados",
  enabled: true,
  latent: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  last_run: null as string | null,
  next_run: null as string | null,
  notify_webhook: null as string | null,
  name: "nightly-summary",
};

const DISABLED_SCHEDULE = { ...MOCK_SCHEDULE, id: "dddd-0001", enabled: false };
const ENABLED_SCHEDULE = { ...MOCK_SCHEDULE, id: "eeee-0001", enabled: true };

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), success: vi.fn() },
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
}));

vi.mock("picocolors", () => ({
  default: {
    bold: (s: string) => s,
    cyan: (s: string) => s,
    green: (s: string) => s,
    red: (s: string) => s,
    yellow: (s: string) => s,
    dim: (s: string) => s,
  },
}));

const {
  mockLoadSchedules,
  mockAddSchedule,
  mockFindSchedule,
  mockRemoveSchedule,
  mockEnableSchedule,
  mockDisableSchedule,
  mockUpdateLastRun,
  mockUpdateNextRun,
  mockInstallCronEntry,
  mockRemoveCronEntry,
  mockValidateCron,
  mockCalculateNextRun,
} = vi.hoisted(() => ({
  mockLoadSchedules: vi.fn(),
  mockAddSchedule: vi.fn(),
  mockFindSchedule: vi.fn(),
  mockRemoveSchedule: vi.fn(),
  mockEnableSchedule: vi.fn(),
  mockDisableSchedule: vi.fn(),
  mockUpdateLastRun: vi.fn(),
  mockUpdateNextRun: vi.fn(),
  mockInstallCronEntry: vi.fn(),
  mockRemoveCronEntry: vi.fn(),
  mockValidateCron: vi.fn(),
  mockCalculateNextRun: vi.fn(),
}));

vi.mock("@cofounder/core", async (importActual) => {
  const actual = await importActual<typeof import("@cofounder/core")>();
  return {
    ...actual,
    loadSchedules: mockLoadSchedules,
    addSchedule: mockAddSchedule,
    findSchedule: mockFindSchedule,
    removeSchedule: mockRemoveSchedule,
    enableSchedule: mockEnableSchedule,
    disableSchedule: mockDisableSchedule,
    updateLastRun: mockUpdateLastRun,
    updateNextRun: mockUpdateNextRun,
    installCronEntry: mockInstallCronEntry,
    removeCronEntry: mockRemoveCronEntry,
    validateCron: mockValidateCron,
    calculateNextRun: mockCalculateNextRun,
  };
});

vi.mock("./send.ts", () => ({
  send: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults
  mockValidateCron.mockReturnValue(true);
  mockCalculateNextRun.mockReturnValue(new Date(Date.now() + 86400_000));
  mockAddSchedule.mockResolvedValue(MOCK_SCHEDULE);
  mockFindSchedule.mockResolvedValue(MOCK_SCHEDULE);
  mockRemoveSchedule.mockResolvedValue(true);
  mockEnableSchedule.mockResolvedValue({ ...DISABLED_SCHEDULE, enabled: true });
  mockDisableSchedule.mockResolvedValue({ ...ENABLED_SCHEDULE, enabled: false });
  mockInstallCronEntry.mockResolvedValue(undefined);
  mockRemoveCronEntry.mockResolvedValue(undefined);
  mockUpdateLastRun.mockResolvedValue(undefined);
  mockUpdateNextRun.mockResolvedValue(undefined);
  mockLoadSchedules.mockResolvedValue([MOCK_SCHEDULE]);
});

afterEach(() => vi.restoreAllMocks());

// ─── scheduleAdd ───────────────────────────────────────────────────────────────

describe("scheduleAdd()", () => {
  it("validates cron and rejects invalid expressions", async () => {
    mockValidateCron.mockReturnValue(false);
    await scheduleAdd({ cron: "not-a-cron", task: "do stuff" });
    expect(mockAddSchedule).not.toHaveBeenCalled();
  });

  it("calls addSchedule with correct input", async () => {
    await scheduleAdd({
      cron: "0 2 * * *",
      task: "summarise work",
      peer: "glados",
      name: "nightly",
    });
    expect(mockAddSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        cron: "0 2 * * *",
        task: "summarise work",
        peer: "glados",
        name: "nightly",
      }),
    );
  });

  it("installs crontab entry after adding", async () => {
    await scheduleAdd({ cron: "0 2 * * *", task: "ping peer" });
    expect(mockInstallCronEntry).toHaveBeenCalledOnce();
  });

  it("updates next_run after adding", async () => {
    await scheduleAdd({ cron: "0 2 * * *", task: "ping peer" });
    expect(mockUpdateNextRun).toHaveBeenCalledWith(MOCK_SCHEDULE.id, expect.any(String));
  });

  it("handles crontab installation failure gracefully", async () => {
    mockInstallCronEntry.mockRejectedValue(new Error("crontab: permission denied"));
    // Should not throw
    await expect(scheduleAdd({ cron: "0 2 * * *", task: "test" })).resolves.toBeUndefined();
  });

  it("passes notify_webhook when provided", async () => {
    await scheduleAdd({
      cron: "0 2 * * *",
      task: "alert",
      notify: "https://hooks.slack.com/abc",
    });
    expect(mockAddSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ notify_webhook: "https://hooks.slack.com/abc" }),
    );
  });

  it("passes latent flag when provided", async () => {
    await scheduleAdd({ cron: "30 9 * * 1", task: "wake GLaDOS", latent: true });
    expect(mockAddSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ latent: true }),
    );
  });
});

// ─── scheduleList ──────────────────────────────────────────────────────────────

describe("scheduleList()", () => {
  it("lists schedules (no error)", async () => {
    await expect(scheduleList({})).resolves.toBeUndefined();
    expect(mockLoadSchedules).toHaveBeenCalledOnce();
  });

  it("outputs JSON when --json is set", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await scheduleList({ json: true });
    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe(MOCK_SCHEDULE.id);
    logSpy.mockRestore();
  });

  it("shows empty message when no schedules", async () => {
    mockLoadSchedules.mockResolvedValue([]);
    await expect(scheduleList({})).resolves.toBeUndefined();
  });

  it("outputs empty array JSON when no schedules + --json", async () => {
    mockLoadSchedules.mockResolvedValue([]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await scheduleList({ json: true });
    const output = logSpy.mock.calls[0][0] as string;
    expect(JSON.parse(output)).toEqual([]);
    logSpy.mockRestore();
  });
});

// ─── scheduleRemove ────────────────────────────────────────────────────────────

describe("scheduleRemove()", () => {
  it("calls removeCronEntry + removeSchedule on success", async () => {
    await scheduleRemove("aaaabbbb");
    expect(mockRemoveCronEntry).toHaveBeenCalledOnce();
    expect(mockRemoveSchedule).toHaveBeenCalledWith(MOCK_SCHEDULE.id);
  });

  it("handles schedule not found gracefully", async () => {
    mockFindSchedule.mockResolvedValue(null);
    await expect(scheduleRemove("notexist")).resolves.toBeUndefined();
    expect(mockRemoveSchedule).not.toHaveBeenCalled();
  });

  it("handles crontab removal failure gracefully", async () => {
    mockRemoveCronEntry.mockRejectedValue(new Error("crontab: not found"));
    await expect(scheduleRemove("aaaabbbb")).resolves.toBeUndefined();
    // Still calls removeSchedule
    expect(mockRemoveSchedule).toHaveBeenCalled();
  });

  it("handles removeSchedule returning false", async () => {
    mockRemoveSchedule.mockResolvedValue(false);
    await expect(scheduleRemove("aaaabbbb")).resolves.toBeUndefined();
  });
});

// ─── scheduleEnable ────────────────────────────────────────────────────────────

describe("scheduleEnable()", () => {
  beforeEach(() => {
    mockFindSchedule.mockResolvedValue(DISABLED_SCHEDULE);
    mockEnableSchedule.mockResolvedValue({ ...DISABLED_SCHEDULE, enabled: true });
  });

  it("enables a disabled schedule", async () => {
    await scheduleEnable("dddd-0001");
    expect(mockEnableSchedule).toHaveBeenCalledWith(DISABLED_SCHEDULE.id);
  });

  it("reinstalls crontab entry on enable", async () => {
    await scheduleEnable("dddd-0001");
    expect(mockInstallCronEntry).toHaveBeenCalledOnce();
  });

  it("skips if already enabled", async () => {
    mockFindSchedule.mockResolvedValue(ENABLED_SCHEDULE);
    await scheduleEnable("eeee-0001");
    expect(mockEnableSchedule).not.toHaveBeenCalled();
  });

  it("handles not-found gracefully", async () => {
    mockFindSchedule.mockResolvedValue(null);
    await expect(scheduleEnable("nope")).resolves.toBeUndefined();
  });

  it("handles enableSchedule returning null gracefully", async () => {
    mockEnableSchedule.mockResolvedValue(null);
    await expect(scheduleEnable("dddd-0001")).resolves.toBeUndefined();
  });

  it("handles crontab reinstall failure gracefully", async () => {
    mockInstallCronEntry.mockRejectedValue(new Error("crontab write failed"));
    await expect(scheduleEnable("dddd-0001")).resolves.toBeUndefined();
  });
});

// ─── scheduleDisable ───────────────────────────────────────────────────────────

describe("scheduleDisable()", () => {
  it("disables an enabled schedule", async () => {
    await scheduleDisable("aaaa-test");
    expect(mockDisableSchedule).toHaveBeenCalledWith(MOCK_SCHEDULE.id);
  });

  it("removes crontab entry on disable", async () => {
    await scheduleDisable("aaaa-test");
    expect(mockRemoveCronEntry).toHaveBeenCalledOnce();
  });

  it("skips if already disabled", async () => {
    mockFindSchedule.mockResolvedValue(DISABLED_SCHEDULE);
    await scheduleDisable("dddd-0001");
    expect(mockDisableSchedule).not.toHaveBeenCalled();
  });

  it("handles not-found gracefully", async () => {
    mockFindSchedule.mockResolvedValue(null);
    await expect(scheduleDisable("nope")).resolves.toBeUndefined();
  });

  it("handles disableSchedule returning null gracefully", async () => {
    mockDisableSchedule.mockResolvedValue(null);
    await expect(scheduleDisable("aaaa-test")).resolves.toBeUndefined();
  });

  it("handles crontab removal failure gracefully", async () => {
    mockRemoveCronEntry.mockRejectedValue(new Error("crontab: error"));
    await expect(scheduleDisable("aaaa-test")).resolves.toBeUndefined();
  });
});

// ─── scheduleRun ───────────────────────────────────────────────────────────────

describe("scheduleRun()", () => {
  it("updates last_run before sending", async () => {
    const { send: mockSend } = await import("./send.ts");
    await scheduleRun("aaaabbbb");
    expect(mockUpdateLastRun).toHaveBeenCalledWith(MOCK_SCHEDULE.id);
    expect(mockSend).toHaveBeenCalled();
  });

  it("passes peer from schedule to send", async () => {
    const { send: mockSend } = await import("./send.ts");
    await scheduleRun("aaaabbbb");
    expect(mockSend).toHaveBeenCalledWith(
      MOCK_SCHEDULE.task,
      expect.objectContaining({ peer: MOCK_SCHEDULE.peer }),
    );
  });

  it("handles not-found gracefully", async () => {
    mockFindSchedule.mockResolvedValue(null);
    await expect(scheduleRun("notexist")).resolves.toBeUndefined();
    expect(mockUpdateLastRun).not.toHaveBeenCalled();
  });

  it("passes notify_webhook when schedule has one", async () => {
    const withNotify = {
      ...MOCK_SCHEDULE,
      notify_webhook: "https://discord.com/api/webhooks/x/y",
    };
    mockFindSchedule.mockResolvedValue(withNotify);
    const { send: mockSend } = await import("./send.ts");
    await scheduleRun("aaaabbbb");
    expect(mockSend).toHaveBeenCalledWith(
      withNotify.task,
      expect.objectContaining({ notify: withNotify.notify_webhook }),
    );
  });
});
