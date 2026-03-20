/**
 * commands/notify.ts — `cofounder notify`
 *
 * Manage persistent notification webhooks for task completion events.
 *
 * Webhooks registered here fire automatically on every `cofounder send` result
 * without needing to pass --notify each time. Supports Discord, Slack,
 * and any generic HTTP endpoint.
 *
 * Subcommands:
 *   cofounder notify add <url> [--name <label>] [--on all|complete|failure]
 *   cofounder notify list
 *   cofounder notify remove <id>
 *   cofounder notify test [id]      — fire a test notification (all webhooks or one by ID prefix)
 *
 * Event filters (--on):
 *   all      — fires on every task completion (default)
 *   complete — fires only on successful tasks
 *   failure  — fires only on failed tasks
 *
 * Examples:
 *   cofounder notify add https://discord.com/api/webhooks/123/abc --name "Discord #alerts"
 *   cofounder notify add https://hooks.slack.com/... --on failure
 *   cofounder notify list
 *   cofounder notify remove a1b2
 *   cofounder notify test
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  loadNotifyWebhooks,
  addNotifyWebhook,
  removeNotifyWebhook,
  type HHNotifyEvent,
  type HHNotifyWebhook,
} from "@cofounder/core/notify/config";
import { deliverNotification } from "@cofounder/core/notify/notify";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function flavourLabel(url: string): string {
  if (url.includes("discord.com/api/webhooks")) return "Discord";
  if (url.includes("hooks.slack.com")) return "Slack";
  return "Generic";
}

function eventBadge(events: HHNotifyEvent): string {
  switch (events) {
    case "all":
      return pc.cyan("all");
    case "complete":
      return pc.green("complete");
    case "failure":
      return pc.red("failure");
  }
}

function printWebhookRow(w: HHNotifyWebhook): void {
  const short = w.id.slice(0, 8);
  const label = w.name ? pc.bold(w.name) : pc.dim("(unnamed)");
  const flavour = pc.dim(`[${flavourLabel(w.url)}]`);
  const events = eventBadge(w.events);
  const added = new Date(w.created_at).toLocaleDateString();
  console.log(`  ${pc.dim(short)}  ${label} ${flavour}  on:${events}  added:${pc.dim(added)}`);
  console.log(`       ${pc.dim(w.url)}`);
}

// ─── Subcommands ──────────────────────────────────────────────────────────────

async function cmdAdd(args: string[]): Promise<void> {
  const [url, ...rest] = args;

  if (!url) {
    console.error(pc.red("Usage: cofounder notify add <url> [--name <label>] [--on all|complete|failure]"));
    process.exitCode = 1;
    return;
  }

  // Validate URL format
  try {
    new URL(url);
  } catch {
    console.error(pc.red(`Invalid URL: ${url}`));
    process.exitCode = 1;
    return;
  }

  // Parse flags
  let name: string | undefined;
  let events: HHNotifyEvent = "all";

  for (let i = 0; i < rest.length; i++) {
    if ((rest[i] === "--name" || rest[i] === "-n") && rest[i + 1]) {
      name = rest[++i];
    } else if ((rest[i] === "--on" || rest[i] === "--events") && rest[i + 1]) {
      const val = rest[++i];
      if (val !== "all" && val !== "complete" && val !== "failure") {
        console.error(pc.red(`Invalid --on value: ${val}. Must be all, complete, or failure.`));
        process.exitCode = 1;
        return;
      }
      events = val;
    }
  }

  p.intro(pc.bold("cofounder notify add"));

  const s = p.spinner();
  s.start("Registering webhook…");

  try {
    const webhook = await addNotifyWebhook({ url, name, events });
    s.stop(pc.green("Webhook registered."));
    console.log();
    printWebhookRow(webhook);
    console.log();
    p.outro(
      `Fires on: ${eventBadge(events)} tasks. Remove with: ${pc.dim(`cofounder notify remove ${webhook.id.slice(0, 8)}`)}`
    );
  } catch (err) {
    s.stop(pc.red("Failed to register webhook."));
    console.error(pc.red((err as Error).message));
    process.exitCode = 1;
  }
}

async function cmdList(): Promise<void> {
  const webhooks = await loadNotifyWebhooks();

  if (webhooks.length === 0) {
    console.log(pc.dim("No notification webhooks registered."));
    console.log(pc.dim("Add one with: cofounder notify add <url>"));
    return;
  }

  console.log(pc.bold(`\n  Notification webhooks (${webhooks.length})\n`));
  for (const w of webhooks) {
    printWebhookRow(w);
    console.log();
  }
}

async function cmdRemove(args: string[]): Promise<void> {
  const [idPrefix] = args;

  if (!idPrefix) {
    console.error(pc.red("Usage: cofounder notify remove <id>"));
    console.error(pc.dim("Run `cofounder notify list` to see registered webhooks."));
    process.exitCode = 1;
    return;
  }

  const removed = await removeNotifyWebhook(idPrefix);

  if (removed) {
    console.log(pc.green(`✓ Webhook ${pc.bold(idPrefix)} removed.`));
  } else {
    console.error(pc.red(`No webhook found matching: ${idPrefix}`));
    console.error(pc.dim("Run `cofounder notify list` to see registered webhooks."));
    process.exitCode = 1;
  }
}

async function cmdTest(args: string[]): Promise<void> {
  const [idPrefix] = args;
  const all = await loadNotifyWebhooks();

  if (all.length === 0) {
    console.log(pc.dim("No webhooks registered. Add one with: cofounder notify add <url>"));
    return;
  }

  const targets: HHNotifyWebhook[] = idPrefix
    ? all.filter((w) => w.id.startsWith(idPrefix))
    : all;

  if (targets.length === 0) {
    console.error(pc.red(`No webhook found matching: ${idPrefix}`));
    process.exitCode = 1;
    return;
  }

  p.intro(pc.bold(`cofounder notify test — firing ${targets.length} webhook(s)…`));

  const ctx = {
    task: "Test notification from cofounder notify test",
    taskId: "00000000-test-0000-0000-000000000000",
    success: true,
    output: "This is a test message from cofounder. If you see this, your webhook is working! 🎉",
    peer: "h2",
    durationMs: 1337,
    costUsd: 0,
  };

  let passCount = 0;
  let failCount = 0;

  for (const w of targets) {
    const label = w.name ?? w.url;
    const s = p.spinner();
    s.start(`Sending to ${label}…`);
    const ok = await deliverNotification(w.url, ctx);
    if (ok) {
      s.stop(pc.green(`✓ ${label}`));
      passCount++;
    } else {
      s.stop(pc.red(`✗ ${label} — delivery failed (check URL)`));
      failCount++;
    }
  }

  console.log();
  if (failCount === 0) {
    p.outro(pc.green(`All ${passCount} webhook(s) delivered successfully.`));
  } else {
    p.outro(
      pc.yellow(`${passCount} delivered, ${failCount} failed. Run \`cofounder notify list\` to review URLs.`)
    );
    process.exitCode = 1;
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export interface NotifyOptions {
  _: string[];
}

export async function notify(opts: NotifyOptions): Promise<void> {
  const [subcommand, ...rest] = opts._ ?? [];

  switch (subcommand) {
    case "add":
      return cmdAdd(rest);
    case "list":
    case "ls":
      return cmdList();
    case "remove":
    case "rm":
    case "delete":
      return cmdRemove(rest);
    case "test":
      return cmdTest(rest);
    default: {
      console.log(pc.bold("\ncofounder notify — persistent notification webhook manager\n"));
      console.log("  cofounder notify add <url> [--name <label>] [--on all|complete|failure]");
      console.log("  cofounder notify list");
      console.log("  cofounder notify remove <id>");
      console.log("  cofounder notify test [id]");
      console.log();
      console.log(pc.dim("  Webhooks fire automatically on task completion (no --notify needed)."));
      console.log(pc.dim("  Supports Discord, Slack, and any generic HTTPS endpoint."));
      console.log();
    }
  }
}
