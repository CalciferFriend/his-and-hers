/**
 * state/tasks.ts
 *
 * Persistent task state for the hh send pipeline.
 *
 * When H1 sends a task via `hh send`, a pending task record is written to
 * ~/.his-and-hers/state/tasks/<id>.json. H2 (GLaDOS 🤖) processes the task
 * and signals completion via `hh result <id> <output>` (or by writing the
 * result directly over SSH/socat). H1 can poll for the result with
 * `hh send --wait` or check any time with `hh status`.
 *
 * Why files instead of a running daemon?
 *   - No extra process required on either side
 *   - Works even if the CLI exits between send and result
 *   - GLaDOS can write results remotely via SSH or a future hh RPC mechanism
 */

import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const STATE_DIR = join(homedir(), ".his-and-hers", "state", "tasks");

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "timeout";

export interface TaskState {
  id: string;
  from: string;
  to: string;
  objective: string;
  constraints: string[];
  status: TaskStatus;
  created_at: string;
  updated_at: string;
  result: TaskResult | null;
  routing_hint?: string;
}

export interface TaskResult {
  output: string;
  success: boolean;
  error?: string;
  artifacts: string[];
  tokens_used?: number;
  duration_ms?: number;
  /** Computed USD cost (stored at result time for budget tracking) */
  cost_usd?: number;
}

function taskPath(id: string): string {
  return join(STATE_DIR, `${id}.json`);
}

/** Ensure state directory exists. */
async function ensureStateDir(): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
}

/** Write a new pending task. */
export async function createTaskState(
  task: Omit<TaskState, "status" | "created_at" | "updated_at" | "result">,
): Promise<TaskState> {
  await ensureStateDir();
  const now = new Date().toISOString();
  const state: TaskState = {
    ...task,
    status: "pending",
    created_at: now,
    updated_at: now,
    result: null,
  };
  await writeFile(taskPath(task.id), JSON.stringify(state, null, 2), { mode: 0o600 });
  return state;
}

/** Update an existing task (status, result, etc.). */
export async function updateTaskState(
  id: string,
  patch: Partial<Omit<TaskState, "id" | "created_at">>,
): Promise<TaskState> {
  const existing = await loadTaskState(id);
  if (!existing) throw new Error(`Task ${id} not found`);
  const updated: TaskState = {
    ...existing,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  await writeFile(taskPath(id), JSON.stringify(updated, null, 2), { mode: 0o600 });
  return updated;
}

/** Load task state. Returns null if not found. */
export async function loadTaskState(id: string): Promise<TaskState | null> {
  try {
    const raw = await readFile(taskPath(id), "utf-8");
    return JSON.parse(raw) as TaskState;
  } catch {
    return null;
  }
}

/** List all task states, newest first. */
export async function listTaskStates(): Promise<TaskState[]> {
  if (!existsSync(STATE_DIR)) return [];
  const files = await readdir(STATE_DIR);
  const tasks = await Promise.all(
    files
      .filter((f) => f.endsWith(".json"))
      .map(async (f) => {
        try {
          const raw = await readFile(join(STATE_DIR, f), "utf-8");
          return JSON.parse(raw) as TaskState;
        } catch {
          return null;
        }
      }),
  );
  return (tasks.filter(Boolean) as TaskState[]).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

/** Poll a task until it's no longer pending/running, or timeout. */
export async function pollTaskCompletion(
  id: string,
  {
    pollIntervalMs = 3000,
    timeoutMs = 300_000, // 5 minutes
  }: { pollIntervalMs?: number; timeoutMs?: number } = {},
): Promise<TaskState | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await loadTaskState(id);
    if (!state) return null;
    if (state.status === "completed" || state.status === "failed" || state.status === "timeout") {
      return state;
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  // Mark as timed out
  try {
    return await updateTaskState(id, { status: "timeout" });
  } catch {
    return null;
  }
}
