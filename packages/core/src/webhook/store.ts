/**
 * core/webhook/store.ts
 *
 * Persistent CRUD for the inbound webhook registry.
 * Stored at ~/.cofounder/webhooks.json
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  HHWebhookSchema,
  HHWebhookListSchema,
  type HHWebhook,
  type AddWebhookInput,
} from "./schema.ts";

// ─── Paths ───────────────────────────────────────────────────────────────────

export function getWebhooksPath(baseDir?: string): string {
  const dir = baseDir ?? join(homedir(), ".cofounder");
  return join(dir, "webhooks.json");
}

async function ensureBaseDir(baseDir?: string): Promise<void> {
  const dir = baseDir ?? join(homedir(), ".cofounder");
  await mkdir(dir, { recursive: true });
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Load all registered inbound webhooks.
 * Returns an empty array if the file doesn't exist or is malformed.
 */
export async function loadWebhooks(baseDir?: string): Promise<HHWebhook[]> {
  const path = getWebhooksPath(baseDir);
  if (!existsSync(path)) return [];
  try {
    const raw = await readFile(path, "utf-8");
    return HHWebhookListSchema.parse(JSON.parse(raw));
  } catch {
    return [];
  }
}

/**
 * Persist the full webhook list to disk.
 */
export async function saveWebhooks(
  webhooks: HHWebhook[],
  baseDir?: string,
): Promise<void> {
  await ensureBaseDir(baseDir);
  await writeFile(
    getWebhooksPath(baseDir),
    JSON.stringify(webhooks, null, 2),
    { mode: 0o600 }, // 0600 — may contain secrets
  );
}

/**
 * Register a new inbound webhook.
 * Throws if the path is already registered.
 */
export async function addWebhook(
  input: AddWebhookInput,
  baseDir?: string,
): Promise<HHWebhook> {
  // Validate path format via schema
  const parsed = HHWebhookSchema.pick({ path: true }).safeParse({ path: input.path });
  if (!parsed.success) {
    throw new Error(`Invalid path: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  }

  const webhooks = await loadWebhooks(baseDir);

  // Prevent duplicate paths
  if (webhooks.some((w) => w.path === input.path)) {
    throw new Error(`Webhook already registered for path: ${input.path}`);
  }

  const webhook: HHWebhook = {
    id: randomUUID(),
    path: input.path,
    task_template: input.task_template,
    name: input.name,
    peer: input.peer,
    secret: input.secret,
    secret_header: input.secret_header ?? "X-Hub-Signature-256",
    enabled: true,
    created_at: new Date().toISOString(),
    trigger_count: 0,
    last_triggered_at: null,
  };

  await saveWebhooks([...webhooks, webhook], baseDir);
  return webhook;
}

/**
 * Find a webhook by ID prefix. Returns undefined if not found.
 */
export function findWebhook(
  webhooks: HHWebhook[],
  idPrefix: string,
): HHWebhook | undefined {
  return webhooks.find((w) => w.id.startsWith(idPrefix));
}

/**
 * Find a webhook by URL path (exact match).
 */
export function findWebhookByPath(
  webhooks: HHWebhook[],
  path: string,
): HHWebhook | undefined {
  return webhooks.find((w) => w.path === path && w.enabled);
}

/**
 * Remove a webhook by ID prefix.
 * Returns true if found and removed, false otherwise.
 */
export async function removeWebhook(
  idPrefix: string,
  baseDir?: string,
): Promise<boolean> {
  const webhooks = await loadWebhooks(baseDir);
  const match = findWebhook(webhooks, idPrefix);
  if (!match) return false;
  await saveWebhooks(
    webhooks.filter((w) => w.id !== match.id),
    baseDir,
  );
  return true;
}

/**
 * Enable or disable a webhook by ID prefix.
 * Returns the updated webhook, or undefined if not found.
 */
export async function setWebhookEnabled(
  idPrefix: string,
  enabled: boolean,
  baseDir?: string,
): Promise<HHWebhook | undefined> {
  const webhooks = await loadWebhooks(baseDir);
  const match = findWebhook(webhooks, idPrefix);
  if (!match) return undefined;

  const updated = { ...match, enabled };
  await saveWebhooks(
    webhooks.map((w) => (w.id === match.id ? updated : w)),
    baseDir,
  );
  return updated;
}

/**
 * Record a successful webhook trigger (increments count, updates timestamp).
 */
export async function recordWebhookTrigger(
  id: string,
  baseDir?: string,
): Promise<void> {
  const webhooks = await loadWebhooks(baseDir);
  const idx = webhooks.findIndex((w) => w.id === id);
  if (idx === -1) return;

  webhooks[idx] = {
    ...webhooks[idx],
    trigger_count: (webhooks[idx].trigger_count ?? 0) + 1,
    last_triggered_at: new Date().toISOString(),
  };

  await saveWebhooks(webhooks, baseDir);
}
