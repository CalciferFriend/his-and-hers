/**
 * retry.ts — Exponential backoff + retry for transient failures
 *
 * Used by `tj send` to retry on:
 *   - Gateway not reachable (WS timeout, connection refused)
 *   - Tailscale peer temporarily offline
 *   - Gateway startup delay after WOL
 *
 * Backoff formula:
 *   delay = min(baseDelayMs × 2^(attempt - 1) + jitter, maxDelayMs)
 *
 * Cron safety:
 *   A RetryState file (~/.his-and-hers/retry/<task-id>.json) tracks in-flight
 *   retries, so a second cron invocation for the same task doesn't spawn a
 *   duplicate send. The caller should check `getRetryState(taskId)` before
 *   sending and skip if status is "pending" or "completed".
 */

import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ─── Options ──────────────────────────────────────────────────────────────────

export interface RetryOptions {
  /** Maximum number of attempts (1 = no retry). Default: 3 */
  maxAttempts?: number;
  /** Base delay in ms before the first retry. Default: 2000 */
  baseDelayMs?: number;
  /** Upper cap on delay. Default: 30_000 */
  maxDelayMs?: number;
  /** Add random jitter up to baseDelayMs to avoid thundering herds. Default: true */
  jitter?: boolean;
  /** Called on each failure before retrying. Receives attempt number (1-indexed). */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
  /** Predicate to determine if the error is retryable. Default: always retry. */
  isRetryable?: (error: unknown) => boolean;
}

// ─── Core retry logic ─────────────────────────────────────────────────────────

/**
 * Execute `fn`, retrying with exponential backoff on failure.
 *
 * Throws the last error if all attempts are exhausted.
 *
 * @example
 * const result = await withRetry(
 *   () => wakeAgent({ url, token, text }),
 *   { maxAttempts: 3, baseDelayMs: 2000 },
 * );
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 2_000,
    maxDelayMs = 30_000,
    jitter = true,
    onRetry,
    isRetryable = () => true,
  } = opts;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Final attempt — no retry
      if (attempt === maxAttempts) break;

      // Non-retryable error — throw immediately
      if (!isRetryable(err)) throw err;

      // Exponential delay: baseDelay × 2^(attempt-1), capped
      const exponential = baseDelayMs * Math.pow(2, attempt - 1);
      const jitterMs = jitter ? Math.random() * baseDelayMs : 0;
      const delayMs = Math.min(exponential + jitterMs, maxDelayMs);

      onRetry?.(attempt, err, delayMs);
      await sleep(delayMs);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Retry state (cron safety) ────────────────────────────────────────────────

const RETRY_STATE_DIR = join(homedir(), ".his-and-hers", "retry");

export type RetryStatus = "pending" | "failed" | "completed";

export interface RetryState {
  task_id: string;
  status: RetryStatus;
  attempts: number;
  last_attempt_at: string;
  last_error?: string;
  next_retry_at?: string;
}

function retryStatePath(taskId: string): string {
  return join(RETRY_STATE_DIR, `${taskId}.json`);
}

async function ensureRetryDir(): Promise<void> {
  await mkdir(RETRY_STATE_DIR, { recursive: true });
}

/**
 * Check if a retry state file exists for a task.
 *
 * Use before sending to avoid duplicate sends from cron:
 * ```
 * const existing = await getRetryState(taskId);
 * if (existing?.status === "pending") {
 *   // already in flight — skip
 * }
 * ```
 */
export async function getRetryState(taskId: string): Promise<RetryState | null> {
  const path = retryStatePath(taskId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf-8")) as RetryState;
  } catch {
    return null;
  }
}

/** Create or update retry state for a task. */
export async function setRetryState(
  taskId: string,
  patch: Partial<Omit<RetryState, "task_id">>,
): Promise<RetryState> {
  await ensureRetryDir();
  const existing = (await getRetryState(taskId)) ?? {
    task_id: taskId,
    status: "pending" as RetryStatus,
    attempts: 0,
    last_attempt_at: new Date().toISOString(),
  };
  const updated: RetryState = {
    ...existing,
    ...patch,
    task_id: taskId,
    last_attempt_at: new Date().toISOString(),
  };
  await writeFile(retryStatePath(taskId), JSON.stringify(updated, null, 2), { mode: 0o600 });
  return updated;
}

/** Remove retry state (clean up after success or permanent failure). */
export async function clearRetryState(taskId: string): Promise<void> {
  const path = retryStatePath(taskId);
  if (existsSync(path)) {
    await unlink(path);
  }
}

/**
 * Compute the next retry time based on attempt count.
 * Useful for displaying "next retry in X seconds" messages.
 */
export function nextRetryAt(attempts: number, baseDelayMs = 2_000, maxDelayMs = 30_000): Date {
  const delayMs = Math.min(baseDelayMs * Math.pow(2, attempts), maxDelayMs);
  return new Date(Date.now() + delayMs);
}

/**
 * Determine if a task is safe to retry from a cron context.
 *
 * Returns:
 *   - "send"    — no state exists, proceed
 *   - "skip"    — already in flight (pending) or already completed
 *   - "retry"   — previous attempt failed, next_retry_at has passed
 *   - "backoff" — failed but still within the backoff window
 */
export async function cronRetryDecision(
  taskId: string,
): Promise<"send" | "skip" | "retry" | "backoff"> {
  const state = await getRetryState(taskId);
  if (!state) return "send";

  switch (state.status) {
    case "completed":
      return "skip";
    case "pending":
      return "skip"; // already in flight
    case "failed": {
      if (!state.next_retry_at) return "retry";
      const nextRetry = new Date(state.next_retry_at).getTime();
      return Date.now() >= nextRetry ? "retry" : "backoff";
    }
    default:
      return "send";
  }
}
