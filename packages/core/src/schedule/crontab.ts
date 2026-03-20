/**
 * schedule/crontab.ts
 *
 * System crontab integration: install/remove/list cron entries for HH schedules.
 *
 * Each schedule gets a crontab entry like:
 *   <cron> cofounder send "<task>" [--peer name] --no-wait >> ~/.cofounder/schedule-logs/<id>.log 2>&1
 *
 * We use a marker comment to identify HH-managed entries:
 *   # COFOUNDER_SCHEDULE_ID=<uuid>
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const execAsync = promisify(exec);

const CF_MARKER_PREFIX = "# COFOUNDER_SCHEDULE_ID=";
const LOG_DIR = join(homedir(), ".cofounder", "schedule-logs");

async function ensureLogDir(): Promise<void> {
  await mkdir(LOG_DIR, { recursive: true });
}

/** Read the current user's crontab. Returns empty string if no crontab exists. */
export async function readCrontab(): Promise<string> {
  try {
    const { stdout } = await execAsync("crontab -l");
    return stdout;
  } catch (err: unknown) {
    // crontab -l exits with error if no crontab exists
    const error = err as { code?: number; stderr?: string };
    if (error.code === 1 || (error.stderr && error.stderr.includes("no crontab"))) {
      return "";
    }
    throw err;
  }
}

/** Write a new crontab (replaces existing). */
export async function writeCrontab(content: string): Promise<void> {
  // Use echo to pipe content to crontab
  const escapedContent = content.replace(/'/g, "'\\''");
  await execAsync(`echo '${escapedContent}' | crontab -`);
}

export interface CrontabEntry {
  id: string;
  cron: string;
  task: string;
  peer?: string;
  latent?: boolean;
  notify_webhook?: string;
  enabled: boolean;
}

/** Install a crontab entry for a schedule. */
export async function installCronEntry(entry: CrontabEntry): Promise<void> {
  await ensureLogDir();

  const current = await readCrontab();
  const lines = current.split("\n").filter(Boolean);

  // Remove any existing entry for this ID
  const filtered = lines.filter((line) => !line.includes(`${CF_MARKER_PREFIX}${entry.id}`));

  if (!entry.enabled) {
    // If disabled, just remove the entry (if present) and return
    await writeCrontab(filtered.join("\n"));
    return;
  }

  // Build the cofounder send command
  const logPath = join(LOG_DIR, `${entry.id}.log`);
  const peerFlag = entry.peer ? ` --peer ${entry.peer}` : "";
  const latentFlag = entry.latent ? " --latent" : "";
  const notifyFlag = entry.notify_webhook ? ` --notify "${entry.notify_webhook}"` : "";
  const cmd = `cofounder send "${entry.task}"${peerFlag}${latentFlag}${notifyFlag} --no-wait >> ${logPath} 2>&1`;

  // Add marker comment + cron line
  const marker = `${CF_MARKER_PREFIX}${entry.id}`;
  const cronLine = `${entry.cron} ${cmd}`;

  filtered.push(marker);
  filtered.push(cronLine);

  await writeCrontab(filtered.join("\n") + "\n");
}

/** Remove a crontab entry for a schedule ID. */
export async function removeCronEntry(id: string): Promise<void> {
  const current = await readCrontab();
  const lines = current.split("\n").filter(Boolean);

  // Remove marker + following line
  const filtered: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(`${CF_MARKER_PREFIX}${id}`)) {
      // Skip this line and the next (cron command)
      i++;
      continue;
    }
    filtered.push(line);
  }

  await writeCrontab(filtered.join("\n"));
}

/** List all HH-managed crontab entries (returns schedule IDs). */
export async function listHHCronEntries(): Promise<string[]> {
  const current = await readCrontab();
  const lines = current.split("\n");
  const ids: string[] = [];

  for (const line of lines) {
    if (line.startsWith(CF_MARKER_PREFIX)) {
      const id = line.substring(CF_MARKER_PREFIX.length).trim();
      ids.push(id);
    }
  }

  return ids;
}

/**
 * Validate a cron expression (basic sanity check).
 * Accepts standard 5-field cron: minute hour day month weekday
 */
export function validateCron(cron: string): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  // Each field should be either:
  // - a number
  // - a range (e.g. 1-5)
  // - a list (e.g. 1,3,5)
  // - a wildcard (*)
  // - a step (*/5)
  const pattern = /^(\*|[0-9]+(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*)(\/[0-9]+)?$/;

  return parts.every((part) => pattern.test(part));
}

/**
 * Calculate next run time for a cron expression.
 * This is a simplified implementation that just returns a reasonable estimate.
 * For production use, consider using a cron parser library like 'croner' or 'cron-parser'.
 */
export function calculateNextRun(cron: string): Date {
  // Simplified: parse the cron expression and find the next matching time
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error("Invalid cron expression");
  }

  const [minute, hour, day, month, weekday] = parts;
  const now = new Date();

  // Start with current time + 1 minute
  const next = new Date(now.getTime() + 60_000);
  next.setSeconds(0);
  next.setMilliseconds(0);

  // Parse minute field
  if (minute !== "*") {
    const targetMinute = parseInt(minute, 10);
    if (!isNaN(targetMinute)) {
      next.setMinutes(targetMinute);
      if (next <= now) {
        next.setHours(next.getHours() + 1);
      }
    }
  }

  // Parse hour field
  if (hour !== "*") {
    const targetHour = parseInt(hour, 10);
    if (!isNaN(targetHour)) {
      next.setHours(targetHour);
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
    }
  }

  // For simplicity, ignore day/month/weekday fields in this basic implementation
  // A full implementation would use a library like 'croner' or 'cron-parser'

  return next;
}
