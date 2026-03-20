/**
 * notify/targets.ts — Phase 11c persistent notification targets
 *
 * Webhook and Slack notification delivery with event filtering and HMAC signing.
 */

import { z } from "zod";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { deliverNotification, type NotificationContext } from "./notify.ts";

function getNotifyPath() {
  return join(homedir(), ".cofounder", "notify.json");
}

export const NotifyTarget = z.object({
  name: z.string().min(1),
  type: z.enum(["webhook", "slack"]),
  url: z.string().url(),
  events: z.array(z.enum(["task_sent", "task_completed", "task_failed", "budget_warn"])),
  secret: z.string().optional(),
});

export type NotifyTarget = z.infer<typeof NotifyTarget>;

const NotifyRegistry = z.array(NotifyTarget);
type NotifyRegistry = z.infer<typeof NotifyRegistry>;

/**
 * Load all notification targets from disk.
 */
export async function loadNotifyTargets(): Promise<NotifyRegistry> {
  if (!existsSync(getNotifyPath())) {
    return [];
  }
  try {
    const raw = await readFile(getNotifyPath(), "utf-8");
    return NotifyRegistry.parse(JSON.parse(raw));
  } catch {
    return [];
  }
}

/**
 * Save notification targets to disk.
 */
export async function saveNotifyTargets(targets: NotifyRegistry): Promise<void> {
  await mkdir(join(homedir(), ".cofounder"), { recursive: true });
  await writeFile(getNotifyPath(), JSON.stringify(targets, null, 2), "utf-8");
}

/**
 * Deliver a notification to a specific target.
 * For webhooks with secret, adds HMAC-SHA256 X-HH-Signature header.
 */
export async function deliverNotificationToTarget(
  target: NotifyTarget,
  event: NotifyTarget["events"][number],
  payload: Record<string, unknown>,
): Promise<boolean> {
  const body = JSON.stringify({ event, payload, ts: new Date().toISOString() });

  // For slack type, delegate to existing deliverNotification
  if (target.type === "slack") {
    const ctx: NotificationContext = {
      task: String(payload.task || payload.objective || ""),
      taskId: String(payload.task_id || ""),
      success: event === "task_completed",
      output: String(payload.output || ""),
      peer: String(payload.peer || ""),
      durationMs: Number(payload.duration_ms),
      costUsd: Number(payload.cost_usd),
    };
    return await deliverNotification(target.url, ctx);
  }

  // For webhook type, POST with optional HMAC
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };

    if (target.secret) {
      const signature = createHmac("sha256", target.secret).update(body).digest("hex");
      headers["X-HH-Signature"] = `sha256=${signature}`;
    }

    const response = await fetch(target.url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(10_000),
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Broadcast a notification to all matching targets.
 * Fires in parallel and returns immediately (fire-and-forget).
 */
export async function broadcastNotification(
  event: NotifyTarget["events"][number],
  payload: Record<string, unknown>,
): Promise<void> {
  const targets = await loadNotifyTargets();
  const matching = targets.filter((t) => t.events.includes(event));

  // Fire-and-forget parallel delivery
  Promise.allSettled(
    matching.map((t) => deliverNotificationToTarget(t, event, payload)),
  ).catch((err) => {
    console.error("Broadcast notification failed:", err);
  });
}
