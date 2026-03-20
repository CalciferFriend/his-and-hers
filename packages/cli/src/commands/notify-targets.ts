/**
 * commands/notify-targets.ts — Phase 11c notification target management
 *
 * Manage webhook and Slack notification targets with event filtering and HMAC signing.
 *
 * Usage:
 *   cofounder notify add <name> --url <url> [--type webhook|slack] [--events csv] [--secret <s>]
 *   cofounder notify list [--json]
 *   cofounder notify show <name> [--json]
 *   cofounder notify remove <name> [--force]
 *   cofounder notify test <name>
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  loadNotifyTargets,
  saveNotifyTargets,
  deliverNotificationToTarget,
  type NotifyTarget,
} from "@cofounder/core";

export interface NotifyAddOptions {
  url: string;
  type?: "webhook" | "slack";
  events?: string;
  secret?: string;
}

export interface NotifyListOptions {
  json?: boolean;
}

export interface NotifyShowOptions {
  json?: boolean;
}

export interface NotifyRemoveOptions {
  force?: boolean;
}

export async function notifyAdd(name: string, opts: NotifyAddOptions) {
  if (!opts.url) {
    p.log.error("--url is required");
    process.exit(1);
  }

  const type = opts.type || "webhook";
  const eventsStr = opts.events || "task_sent,task_completed,task_failed";
  const eventList = eventsStr.split(",").map((e) => e.trim()) as NotifyTarget["events"];

  const validEvents: NotifyTarget["events"][number][] = [
    "task_sent",
    "task_completed",
    "task_failed",
    "budget_warn",
  ];

  for (const e of eventList) {
    if (!validEvents.includes(e)) {
      p.log.error(`Invalid event: ${e}. Valid: ${validEvents.join(", ")}`);
      process.exit(1);
    }
  }

  const target: NotifyTarget = {
    name,
    type,
    url: opts.url,
    events: eventList,
    secret: opts.secret,
  };

  const targets = await loadNotifyTargets();
  const existing = targets.findIndex((t) => t.name === name);

  if (existing >= 0) {
    targets[existing] = target;
  } else {
    targets.push(target);
  }

  await saveNotifyTargets(targets);

  p.intro(pc.bgMagenta(pc.white(" cofounder notify add ")));
  p.log.success(`Notification target ${pc.cyan(name)} saved`);
  p.log.message("");
  p.log.info(`  Type:   ${type}`);
  p.log.info(`  URL:    ${opts.url.slice(0, 60)}${opts.url.length > 60 ? "..." : ""}`);
  p.log.info(`  Events: ${eventList.join(", ")}`);
  if (opts.secret) p.log.info(`  Secret: ${pc.dim("(configured)")}`);
  p.outro("Done.");
}

export async function notifyList(opts: NotifyListOptions = {}) {
  const targets = await loadNotifyTargets();

  if (opts.json) {
    console.log(JSON.stringify(targets, null, 2));
    return;
  }

  if (targets.length === 0) {
    p.intro(pc.bgMagenta(pc.white(" cofounder notify list ")));
    p.log.info("No notification targets configured.");
    p.log.message("");
    p.log.info(pc.dim("Add a target with: cofounder notify add <name> --url <url>"));
    p.outro("Done.");
    return;
  }

  p.intro(pc.bgMagenta(pc.white(" cofounder notify list ")));
  p.log.message("");

  for (const t of targets) {
    p.log.info(pc.bold(pc.cyan(t.name)));
    p.log.info(`  Type:   ${t.type}`);
    p.log.info(`  URL:    ${t.url.slice(0, 60)}${t.url.length > 60 ? "..." : ""}`);
    p.log.info(`  Events: ${t.events.join(", ")}`);
    if (t.secret) p.log.info(`  Secret: ${pc.dim("(configured)")}`);
    p.log.message("");
  }

  p.outro("Done.");
}

export async function notifyShow(name: string, opts: NotifyShowOptions = {}) {
  const targets = await loadNotifyTargets();
  const target = targets.find((t) => t.name === name);

  if (!target) {
    p.log.error(`Notification target not found: ${name}`);
    process.exit(1);
  }

  if (opts.json) {
    console.log(JSON.stringify(target, null, 2));
    return;
  }

  p.intro(pc.bgMagenta(pc.white(` cofounder notify show — ${name} `)));
  p.log.message("");
  p.log.info(`Type:   ${target.type}`);
  p.log.info(`URL:    ${target.url}`);
  p.log.info(`Events: ${target.events.join(", ")}`);
  if (target.secret) p.log.info(`Secret: ${pc.dim("(configured)")}`);
  p.outro("Done.");
}

export async function notifyRemove(name: string, opts: NotifyRemoveOptions = {}) {
  const targets = await loadNotifyTargets();
  const index = targets.findIndex((t) => t.name === name);

  if (index < 0) {
    p.log.error(`Notification target not found: ${name}`);
    process.exit(1);
  }

  if (!opts.force) {
    const confirmed = await p.confirm({
      message: `Remove notification target ${name}?`,
      initialValue: false,
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
  }

  targets.splice(index, 1);
  await saveNotifyTargets(targets);

  p.outro(pc.green(`Notification target ${name} removed`));
}

export async function notifyTest(name: string) {
  const targets = await loadNotifyTargets();
  const target = targets.find((t) => t.name === name);

  if (!target) {
    p.log.error(`Notification target not found: ${name}`);
    process.exit(1);
  }

  p.intro(pc.bgMagenta(pc.white(` cofounder notify test — ${name} `)));

  const spinner = p.spinner();
  spinner.start("Sending test notification...");

  const payload = {
    task: "Test notification from cofounder notify test",
    task_id: "test-" + Date.now(),
    peer: "test-peer",
    objective: "This is a test notification",
    output: "Test successful!",
    cost_usd: 0,
    duration_ms: 1000,
  };

  const ok = await deliverNotificationToTarget(target, "task_completed", payload);

  if (ok) {
    spinner.stop(pc.green("Test notification sent successfully"));
  } else {
    spinner.stop(pc.red("Test notification failed"));
    process.exit(1);
  }

  p.outro("Done.");
}
