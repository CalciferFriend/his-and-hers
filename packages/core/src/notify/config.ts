/**
 * notify/config.ts
 *
 * Persistent notification webhook registry — ~/.his-and-hers/notify-webhooks.json
 *
 * Stores one or more webhooks (Discord, Slack, generic) that fire automatically
 * on task completion without requiring --notify on every `hh send` invocation.
 *
 * Webhooks can be scoped to event types:
 *   "all"      — fires on any task completion (success or failure)
 *   "complete" — fires only on successful completion
 *   "failure"  — fires only on task failure
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

// ─── Schema ──────────────────────────────────────────────────────────────────

export const HHNotifyEventSchema = z.enum(["all", "complete", "failure"]);
export type HHNotifyEvent = z.infer<typeof HHNotifyEventSchema>;

export const HHNotifyWebhookSchema = z.object({
  /** Unique identifier (UUID) */
  id: z.string().uuid(),
  /** Webhook URL — Discord, Slack, or generic HTTPS endpoint */
  url: z.string().url(),
  /** Optional human-readable label */
  name: z.string().optional(),
  /**
   * Which task outcomes trigger this webhook.
   * Defaults to "all".
   */
  events: HHNotifyEventSchema.default("all"),
  /** ISO 8601 timestamp of when this webhook was registered */
  created_at: z.string().datetime(),
});
export type HHNotifyWebhook = z.infer<typeof HHNotifyWebhookSchema>;

export const HHNotifyWebhookListSchema = z.array(HHNotifyWebhookSchema);

// ─── Paths ───────────────────────────────────────────────────────────────────

function getBaseDir(): string {
  return join(homedir(), ".his-and-hers");
}

function getNotifyPath(): string {
  return join(getBaseDir(), "notify-webhooks.json");
}

async function ensureBaseDir(): Promise<void> {
  await mkdir(getBaseDir(), { recursive: true });
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

/**
 * Load all registered webhooks. Returns empty array if file doesn't exist.
 */
export async function loadNotifyWebhooks(): Promise<HHNotifyWebhook[]> {
  if (!existsSync(getNotifyPath())) return [];
  try {
    const raw = await readFile(getNotifyPath(), "utf-8");
    return HHNotifyWebhookListSchema.parse(JSON.parse(raw));
  } catch {
    return [];
  }
}

/**
 * Save the full webhook list to disk (0644 — not a secret).
 */
export async function saveNotifyWebhooks(webhooks: HHNotifyWebhook[]): Promise<void> {
  await ensureBaseDir();
  await writeFile(getNotifyPath(), JSON.stringify(webhooks, null, 2), { mode: 0o644 });
}

export interface AddNotifyWebhookInput {
  url: string;
  name?: string;
  events?: HHNotifyEvent;
}

/**
 * Register a new webhook. Returns the created entry.
 * Throws if the URL is already registered.
 */
export async function addNotifyWebhook(input: AddNotifyWebhookInput): Promise<HHNotifyWebhook> {
  const webhooks = await loadNotifyWebhooks();

  // Prevent duplicates by URL
  if (webhooks.some((w) => w.url === input.url)) {
    throw new Error(`Webhook already registered: ${input.url}`);
  }

  const webhook: HHNotifyWebhook = {
    id: randomUUID(),
    url: input.url,
    name: input.name,
    events: input.events ?? "all",
    created_at: new Date().toISOString(),
  };

  await saveNotifyWebhooks([...webhooks, webhook]);
  return webhook;
}

/**
 * Remove a webhook by ID prefix. Returns true if found and removed, false if not found.
 */
export async function removeNotifyWebhook(idPrefix: string): Promise<boolean> {
  const webhooks = await loadNotifyWebhooks();
  const match = webhooks.find((w) => w.id.startsWith(idPrefix));
  if (!match) return false;
  await saveNotifyWebhooks(webhooks.filter((w) => w.id !== match.id));
  return true;
}

/**
 * Return all webhooks that should fire for a given task outcome.
 *
 * @param success — true if task completed successfully, false on failure
 */
export function filterWebhooksByEvent(
  webhooks: HHNotifyWebhook[],
  success: boolean,
): HHNotifyWebhook[] {
  return webhooks.filter((w) => {
    if (w.events === "all") return true;
    if (w.events === "complete") return success;
    if (w.events === "failure") return !success;
    return false;
  });
}

/**
 * Convenience: load webhooks and filter by event type in one call.
 */
export async function getActiveWebhooks(success: boolean): Promise<HHNotifyWebhook[]> {
  const all = await loadNotifyWebhooks();
  return filterWebhooksByEvent(all, success);
}
