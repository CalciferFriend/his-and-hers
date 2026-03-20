/**
 * schedule/store.ts
 *
 * Load/save/list/add/remove helpers for ~/.cofounder/schedules.json
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { HHScheduleList } from "./schema.ts";
import type { HHSchedule } from "./schema.ts";

export type { HHSchedule };

function getBaseDir(): string {
  return join(homedir(), ".cofounder");
}

function getSchedulesPath(): string {
  return join(getBaseDir(), "schedules.json");
}

async function ensureBaseDir(): Promise<void> {
  await mkdir(getBaseDir(), { recursive: true });
}

/** Load all schedules from disk. Returns empty array if file doesn't exist. */
export async function loadSchedules(): Promise<HHSchedule[]> {
  if (!existsSync(getSchedulesPath())) return [];
  try {
    const raw = await readFile(getSchedulesPath(), "utf-8");
    return HHScheduleList.parse(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Save all schedules to disk. */
export async function saveSchedules(schedules: HHSchedule[]): Promise<void> {
  await ensureBaseDir();
  await writeFile(getSchedulesPath(), JSON.stringify(schedules, null, 2), { mode: 0o644 });
}

export interface AddScheduleInput {
  cron: string;
  task: string;
  peer?: string;
  latent?: boolean;
  name?: string;
  notify_webhook?: string;
}

/** Add a new schedule and return the created entry. */
export async function addSchedule(input: AddScheduleInput): Promise<HHSchedule> {
  const schedules = await loadSchedules();
  const newSchedule: HHSchedule = {
    id: randomUUID(),
    cron: input.cron,
    task: input.task,
    peer: input.peer,
    latent: input.latent,
    name: input.name,
    notify_webhook: input.notify_webhook,
    created_at: new Date().toISOString(),
    enabled: true,
  };
  schedules.push(newSchedule);
  await saveSchedules(schedules);
  return newSchedule;
}

/** Find a schedule by ID or prefix. Returns null if not found or ambiguous. */
export async function findSchedule(idOrPrefix: string): Promise<HHSchedule | null> {
  const schedules = await loadSchedules();
  const exact = schedules.find((s) => s.id === idOrPrefix);
  if (exact) return exact;

  const matches = schedules.filter((s) => s.id.startsWith(idOrPrefix));
  if (matches.length === 1) return matches[0];
  return null; // ambiguous or not found
}

/** Remove a schedule by ID or prefix. Returns true if removed. */
export async function removeSchedule(idOrPrefix: string): Promise<boolean> {
  const schedules = await loadSchedules();
  const target = schedules.find((s) => s.id === idOrPrefix || s.id.startsWith(idOrPrefix));
  if (!target) return false;

  const filtered = schedules.filter((s) => s.id !== target.id);
  await saveSchedules(filtered);
  return true;
}

/** Enable a schedule by ID or prefix. Returns true if updated. */
export async function enableSchedule(idOrPrefix: string): Promise<boolean> {
  const schedules = await loadSchedules();
  const target = schedules.find((s) => s.id === idOrPrefix || s.id.startsWith(idOrPrefix));
  if (!target) return false;

  target.enabled = true;
  await saveSchedules(schedules);
  return true;
}

/** Disable a schedule by ID or prefix. Returns true if updated. */
export async function disableSchedule(idOrPrefix: string): Promise<boolean> {
  const schedules = await loadSchedules();
  const target = schedules.find((s) => s.id === idOrPrefix || s.id.startsWith(idOrPrefix));
  if (!target) return false;

  target.enabled = false;
  await saveSchedules(schedules);
  return true;
}

/** Update last_run timestamp for a schedule. */
export async function updateLastRun(idOrPrefix: string, timestamp?: string): Promise<boolean> {
  const schedules = await loadSchedules();
  const target = schedules.find((s) => s.id === idOrPrefix || s.id.startsWith(idOrPrefix));
  if (!target) return false;

  target.last_run = timestamp ?? new Date().toISOString();
  await saveSchedules(schedules);
  return true;
}

/** Update next_run timestamp for a schedule. */
export async function updateNextRun(idOrPrefix: string, timestamp: string): Promise<boolean> {
  const schedules = await loadSchedules();
  const target = schedules.find((s) => s.id === idOrPrefix || s.id.startsWith(idOrPrefix));
  if (!target) return false;

  target.next_run = timestamp;
  await saveSchedules(schedules);
  return true;
}
