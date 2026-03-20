/**
 * SDK task state reader/writer.
 *
 * Mirrors the CLI's state/tasks.ts but lives in the SDK so the SDK has no
 * dependency on @cofounder/cli. The state format is identical — both the
 * CLI and SDK can read each other's state files.
 */

import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_STATE_DIR = join(homedir(), ".cofounder", "state", "tasks");

export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "cancelled";

export interface TaskResult {
  output: string;
  success: boolean;
  error?: string;
  artifacts: string[];
  tokens_used?: number;
  duration_ms?: number;
  cost_usd?: number;
}

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

function taskPath(id: string, stateDir: string): string {
  return join(stateDir, `${id}.json`);
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function createTaskState(
  task: Omit<TaskState, "status" | "created_at" | "updated_at" | "result">,
  stateDir = DEFAULT_STATE_DIR,
): Promise<TaskState> {
  await ensureDir(stateDir);
  const now = new Date().toISOString();
  const state: TaskState = {
    ...task,
    status: "pending",
    created_at: now,
    updated_at: now,
    result: null,
  };
  await writeFile(taskPath(task.id, stateDir), JSON.stringify(state, null, 2), {
    mode: 0o600,
  });
  return state;
}

export async function updateTaskState(
  id: string,
  patch: Partial<Omit<TaskState, "id" | "created_at">>,
  stateDir = DEFAULT_STATE_DIR,
): Promise<TaskState> {
  const existing = await loadTaskState(id, stateDir);
  if (!existing) throw new Error(`Task ${id} not found`);
  const updated: TaskState = {
    ...existing,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  await writeFile(taskPath(id, stateDir), JSON.stringify(updated, null, 2), {
    mode: 0o600,
  });
  return updated;
}

export async function loadTaskState(
  id: string,
  stateDir = DEFAULT_STATE_DIR,
): Promise<TaskState | null> {
  try {
    const raw = await readFile(taskPath(id, stateDir), "utf-8");
    return JSON.parse(raw) as TaskState;
  } catch {
    return null;
  }
}

export async function listTaskStates(stateDir = DEFAULT_STATE_DIR): Promise<TaskState[]> {
  if (!existsSync(stateDir)) return [];
  const files = await readdir(stateDir);
  const tasks = await Promise.all(
    files
      .filter((f) => f.endsWith(".json"))
      .map(async (f) => {
        try {
          const raw = await readFile(join(stateDir, f), "utf-8");
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

export async function pollTaskCompletion(
  id: string,
  {
    pollIntervalMs = 3000,
    timeoutMs = 300_000,
    stateDir = DEFAULT_STATE_DIR,
  }: { pollIntervalMs?: number; timeoutMs?: number; stateDir?: string } = {},
): Promise<TaskState | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await loadTaskState(id, stateDir);
    if (!state) return null;
    if (
      state.status === "completed" ||
      state.status === "failed" ||
      state.status === "timeout" ||
      state.status === "cancelled"
    ) {
      return state;
    }
    await new Promise<void>((r) => setTimeout(r, pollIntervalMs));
  }
  try {
    return await updateTaskState(id, { status: "timeout" }, stateDir);
  } catch {
    return null;
  }
}
