/**
 * notify/notify.ts
 *
 * Task completion webhook notifications — send a rich message to Discord,
 * Slack, or any generic webhook when a task finishes.
 *
 * Auto-detects the webhook flavour from the URL:
 *   - Discord:  https://discord.com/api/webhooks/...
 *   - Slack:    https://hooks.slack.com/...
 *   - Generic:  anything else → POSTs a JSON payload directly
 *
 * All three paths use a single `deliverNotification()` call. Errors are
 * soft-logged and never throw, so a failed notification never breaks a task.
 */

export interface NotificationContext {
  /** Short task description (human-readable) */
  task: string;
  /** Task UUID */
  taskId: string;
  /** true if task completed successfully */
  success: boolean;
  /** Result output text (truncated to 500 chars for embeds) */
  output?: string;
  /** Peer node name that processed the task */
  peer?: string;
  /** Wall-clock duration in milliseconds */
  durationMs?: number;
  /** Cost in USD (for cloud tasks) */
  costUsd?: number;
}

/** Generic webhook JSON payload (for non-Discord/Slack endpoints). */
export interface GenericWebhookPayload {
  event: "task_complete";
  task_id: string;
  task: string;
  success: boolean;
  output?: string;
  peer?: string;
  duration_ms?: number;
  cost_usd?: number;
  timestamp: string;
}

function detectFlavour(url: string): "discord" | "slack" | "generic" {
  if (url.includes("discord.com/api/webhooks")) return "discord";
  if (url.includes("hooks.slack.com")) return "slack";
  return "generic";
}

function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen - 3) + "...";
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/** Build a Discord embed payload. */
function buildDiscordPayload(ctx: NotificationContext): object {
  const colour = ctx.success ? 0x57f287 : 0xed4245; // green / red
  const status = ctx.success ? "✅ Completed" : "❌ Failed";
  const taskPreview = truncate(ctx.task, 100);

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

  if (ctx.peer) fields.push({ name: "Peer", value: ctx.peer, inline: true });

  if (ctx.durationMs !== undefined) {
    fields.push({ name: "Duration", value: formatDuration(ctx.durationMs), inline: true });
  }

  if (ctx.costUsd !== undefined && ctx.costUsd > 0) {
    fields.push({ name: "Cost", value: `$${ctx.costUsd.toFixed(4)}`, inline: true });
  }

  if (ctx.output && ctx.success) {
    const preview = truncate(ctx.output, 500);
    fields.push({ name: "Output", value: `\`\`\`\n${preview}\n\`\`\`` });
  } else if (!ctx.success && ctx.output) {
    fields.push({ name: "Error", value: truncate(ctx.output, 300) });
  }

  return {
    embeds: [
      {
        title: `${status} — cofounder task`,
        description: taskPreview,
        color: colour,
        fields,
        footer: { text: `Task ID: ${ctx.taskId.slice(0, 8)}` },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

/** Build a Slack Block Kit payload. */
function buildSlackPayload(ctx: NotificationContext): object {
  const icon = ctx.success ? ":white_check_mark:" : ":x:";
  const status = ctx.success ? "Completed" : "Failed";
  const taskPreview = truncate(ctx.task, 100);

  const lines = [
    `${icon} *${status}:* ${taskPreview}`,
  ];

  if (ctx.peer) lines.push(`*Peer:* ${ctx.peer}`);
  if (ctx.durationMs !== undefined) lines.push(`*Duration:* ${formatDuration(ctx.durationMs)}`);
  if (ctx.costUsd !== undefined && ctx.costUsd > 0) lines.push(`*Cost:* $${ctx.costUsd.toFixed(4)}`);

  if (ctx.output) {
    const preview = truncate(ctx.output, 400);
    lines.push(`*Output:*\n\`\`\`${preview}\`\`\``);
  }

  return { text: lines.join("\n") };
}

/** Build a generic JSON payload. */
function buildGenericPayload(ctx: NotificationContext): GenericWebhookPayload {
  return {
    event: "task_complete",
    task_id: ctx.taskId,
    task: ctx.task,
    success: ctx.success,
    output: ctx.output,
    peer: ctx.peer,
    duration_ms: ctx.durationMs,
    cost_usd: ctx.costUsd,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Deliver a task-completion notification to a webhook URL.
 *
 * Never throws. Returns true on success, false on failure.
 */
export async function deliverNotification(
  webhookUrl: string,
  ctx: NotificationContext,
): Promise<boolean> {
  if (!webhookUrl) return false;

  let body: object;
  const flavour = detectFlavour(webhookUrl);

  switch (flavour) {
    case "discord":
      body = buildDiscordPayload(ctx);
      break;
    case "slack":
      body = buildSlackPayload(ctx);
      break;
    default:
      body = buildGenericPayload(ctx);
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    return response.ok;
  } catch {
    // Network errors, timeouts, etc. — soft-fail
    return false;
  }
}
