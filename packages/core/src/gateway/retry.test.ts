/**
 * retry.test.ts — Unit tests for Phase 5e exponential backoff + retry
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withRetry, cronRetryDecision, setRetryState, clearRetryState, getRetryState, nextRetryAt } from "../retry.ts";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const RETRY_DIR = join(homedir(), ".his-and-hers", "retry");

describe("withRetry", () => {
  it("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxAttempts: 3 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and succeeds on second attempt", async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 2) throw new Error("transient failure");
      return "recovered";
    });

    const result = await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 10, // fast for tests
      jitter: false,
    });

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting all attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("permanent failure"));

    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 10, jitter: false }),
    ).rejects.toThrow("permanent failure");

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("calls onRetry callback on each failure except the last", async () => {
    const onRetry = vi.fn();
    const fn = vi.fn().mockRejectedValue(new Error("fail"));

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 10,
        jitter: false,
        onRetry,
      }),
    ).rejects.toThrow();

    // onRetry called after attempt 1 and 2 (not after final attempt 3)
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), expect.any(Number));
    expect(onRetry).toHaveBeenCalledWith(2, expect.any(Error), expect.any(Number));
  });

  it("does not retry non-retryable errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("auth failure"));

    await expect(
      withRetry(fn, {
        maxAttempts: 5,
        baseDelayMs: 10,
        isRetryable: (err) => !(err instanceof Error && err.message.includes("auth")),
      }),
    ).rejects.toThrow("auth failure");

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("respects maxDelayMs cap", async () => {
    const delays: number[] = [];
    const fn = vi.fn().mockRejectedValue(new Error("fail"));

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 500,
        jitter: false,
        onRetry: (_attempt, _err, delayMs) => delays.push(delayMs),
      }),
    ).rejects.toThrow();

    // All computed delays should be capped at maxDelayMs
    expect(delays.every((d) => d <= 500)).toBe(true);
  });
});

describe("RetryState persistence (cron safety)", () => {
  const TEST_TASK_ID = `test-retry-${Date.now()}`;

  afterEach(async () => {
    await clearRetryState(TEST_TASK_ID).catch(() => {});
  });

  it("returns null when no state exists", async () => {
    const state = await getRetryState(`nonexistent-${Date.now()}`);
    expect(state).toBeNull();
  });

  it("writes and reads retry state", async () => {
    await setRetryState(TEST_TASK_ID, { status: "pending", attempts: 0 });
    const state = await getRetryState(TEST_TASK_ID);
    expect(state).not.toBeNull();
    expect(state!.task_id).toBe(TEST_TASK_ID);
    expect(state!.status).toBe("pending");
  });

  it("merges patches without overwriting unrelated fields", async () => {
    await setRetryState(TEST_TASK_ID, { status: "pending", attempts: 1 });
    await setRetryState(TEST_TASK_ID, { attempts: 2 });
    const state = await getRetryState(TEST_TASK_ID);
    expect(state!.attempts).toBe(2);
    expect(state!.status).toBe("pending");
  });

  it("clearRetryState removes the file", async () => {
    await setRetryState(TEST_TASK_ID, { status: "completed" });
    await clearRetryState(TEST_TASK_ID);
    const state = await getRetryState(TEST_TASK_ID);
    expect(state).toBeNull();
  });
});

describe("cronRetryDecision", () => {
  const TASK = `cron-decision-${Date.now()}`;

  afterEach(async () => {
    await clearRetryState(TASK).catch(() => {});
  });

  it("returns 'send' when no state exists", async () => {
    const decision = await cronRetryDecision(`no-state-${Date.now()}`);
    expect(decision).toBe("send");
  });

  it("returns 'skip' when status is pending", async () => {
    await setRetryState(TASK, { status: "pending" });
    expect(await cronRetryDecision(TASK)).toBe("skip");
  });

  it("returns 'skip' when status is completed", async () => {
    await setRetryState(TASK, { status: "completed" });
    expect(await cronRetryDecision(TASK)).toBe("skip");
  });

  it("returns 'retry' when failed and no next_retry_at", async () => {
    await setRetryState(TASK, { status: "failed" });
    expect(await cronRetryDecision(TASK)).toBe("retry");
  });

  it("returns 'retry' when failed and next_retry_at is in the past", async () => {
    const past = new Date(Date.now() - 10_000).toISOString();
    await setRetryState(TASK, { status: "failed", next_retry_at: past });
    expect(await cronRetryDecision(TASK)).toBe("retry");
  });

  it("returns 'backoff' when failed and next_retry_at is in the future", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    await setRetryState(TASK, { status: "failed", next_retry_at: future });
    expect(await cronRetryDecision(TASK)).toBe("backoff");
  });
});

describe("nextRetryAt", () => {
  it("returns a future date", () => {
    const next = nextRetryAt(0);
    expect(next.getTime()).toBeGreaterThan(Date.now());
  });

  it("scales exponentially with attempt count", () => {
    const d0 = nextRetryAt(0, 1000, 60_000).getTime() - Date.now();
    const d1 = nextRetryAt(1, 1000, 60_000).getTime() - Date.now();
    const d2 = nextRetryAt(2, 1000, 60_000).getTime() - Date.now();
    // Each step roughly doubles (within 200ms tolerance)
    expect(d1).toBeGreaterThan(d0 * 1.5);
    expect(d2).toBeGreaterThan(d1 * 1.5);
  });

  it("caps at maxDelayMs", () => {
    const next = nextRetryAt(20, 1000, 5_000).getTime() - Date.now();
    expect(next).toBeLessThanOrEqual(5_100); // cap + tiny clock margin
  });
});
