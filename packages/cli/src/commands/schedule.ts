/**
 * commands/schedule.ts — `cofounder schedule` subcommands
 *
 * Manage recurring task delegation via cron.
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  loadSchedules,
  addSchedule,
  findSchedule,
  removeSchedule,
  enableSchedule,
  disableSchedule,
  updateLastRun,
  updateNextRun,
  type HHSchedule,
  type AddScheduleInput,
  installCronEntry,
  removeCronEntry,
  validateCron,
  calculateNextRun,
} from "@cofounder/core";
import { send } from "./send.ts";

/** Add a new schedule. */
export async function scheduleAdd(opts: {
  cron: string;
  task: string;
  peer?: string;
  latent?: boolean;
  name?: string;
  notify?: string;
}) {
  // Validate cron expression
  if (!validateCron(opts.cron)) {
    p.log.error(`Invalid cron expression: ${opts.cron}`);
    p.log.info("Expected format: minute hour day month weekday (e.g., '0 2 * * *')");
    p.outro("Failed.");
    return;
  }

  p.intro(pc.bold("Adding scheduled task"));

  const input: AddScheduleInput = {
    cron: opts.cron,
    task: opts.task,
    peer: opts.peer,
    latent: opts.latent,
    name: opts.name,
    notify_webhook: opts.notify,
  };

  const schedule = await addSchedule(input);

  // Calculate next run time
  const nextRun = calculateNextRun(opts.cron);
  await updateNextRun(schedule.id, nextRun.toISOString());

  // Install crontab entry
  const s = p.spinner();
  s.start("Installing crontab entry...");
  try {
    await installCronEntry({
      id: schedule.id,
      cron: opts.cron,
      task: opts.task,
      peer: opts.peer,
      latent: opts.latent,
      notify_webhook: opts.notify,
      enabled: true,
    });
    s.stop(pc.green("✓ Crontab entry installed"));
  } catch (err) {
    s.stop(pc.red("✗ Failed to install crontab entry"));
    p.log.error(String(err));
    p.outro("Schedule created but crontab installation failed. Use `crontab -e` to add manually.");
    return;
  }

  p.log.info(`${pc.bold("Schedule ID:")} ${pc.cyan(schedule.id.slice(0, 8))} (full: ${pc.dim(schedule.id)})`);
  p.log.info(`${pc.bold("Cron:")} ${schedule.cron}`);
  p.log.info(`${pc.bold("Task:")} ${schedule.task}`);
  if (schedule.peer) p.log.info(`${pc.bold("Peer:")} ${schedule.peer}`);
  if (schedule.latent) p.log.info(`${pc.bold("Mode:")} latent`);
  if (schedule.name) p.log.info(`${pc.bold("Name:")} ${schedule.name}`);
  if (schedule.notify_webhook) p.log.info(`${pc.bold("Notify:")} ${pc.cyan(schedule.notify_webhook)}`);
  p.log.info(`${pc.bold("Next run:")} ${pc.yellow(nextRun.toLocaleString())}`);

  p.outro("Schedule added.");
}

/** List all schedules. */
export async function scheduleList(opts: { json?: boolean }) {
  const schedules = await loadSchedules();

  if (schedules.length === 0) {
    if (opts.json) {
      console.log("[]");
    } else {
      p.log.info("No schedules configured.");
      p.log.info(pc.dim("Add one with: cofounder schedule add --cron '0 2 * * *' '<task>'"));
    }
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify(schedules, null, 2));
    return;
  }

  p.intro(pc.bold("Scheduled tasks"));

  for (const schedule of schedules) {
    const status = schedule.enabled ? pc.green("enabled") : pc.dim("disabled");
    const shortId = pc.cyan(schedule.id.slice(0, 8));
    const taskPreview = schedule.task.length > 60 ? schedule.task.slice(0, 57) + "..." : schedule.task;

    p.log.info("");
    p.log.info(`${pc.bold(shortId)} ${status}`);
    if (schedule.name) p.log.info(`  ${pc.bold("Name:")} ${schedule.name}`);
    p.log.info(`  ${pc.bold("Cron:")} ${schedule.cron}`);
    p.log.info(`  ${pc.bold("Task:")} ${taskPreview}`);
    if (schedule.peer) p.log.info(`  ${pc.bold("Peer:")} ${schedule.peer}`);
    if (schedule.latent) p.log.info(`  ${pc.bold("Mode:")} latent`);
    if (schedule.notify_webhook) p.log.info(`  ${pc.bold("Notify:")} ${pc.cyan(schedule.notify_webhook)}`);
    if (schedule.last_run) {
      const lastRun = new Date(schedule.last_run);
      p.log.info(`  ${pc.bold("Last run:")} ${lastRun.toLocaleString()}`);
    }
    if (schedule.next_run) {
      const nextRun = new Date(schedule.next_run);
      p.log.info(`  ${pc.bold("Next run:")} ${pc.yellow(nextRun.toLocaleString())}`);
    }
  }

  p.outro(`${schedules.length} schedule(s) total`);
}

/** Remove a schedule. */
export async function scheduleRemove(idOrPrefix: string) {
  const schedule = await findSchedule(idOrPrefix);

  if (!schedule) {
    p.log.error(`Schedule not found: ${idOrPrefix}`);
    p.outro("Failed.");
    return;
  }

  p.intro(`${pc.bold("Removing schedule")} ${pc.cyan(schedule.id.slice(0, 8))}`);

  const s = p.spinner();
  s.start("Removing crontab entry...");
  try {
    await removeCronEntry(schedule.id);
    s.stop(pc.green("✓ Crontab entry removed"));
  } catch (err) {
    s.stop(pc.yellow("⚠ Failed to remove crontab entry"));
    p.log.warn(String(err));
    p.log.info("You may need to manually remove the entry with `crontab -e`");
  }

  const removed = await removeSchedule(schedule.id);
  if (!removed) {
    p.log.error("Failed to remove schedule from store");
    p.outro("Failed.");
    return;
  }

  p.log.info(`Removed: ${schedule.task}`);
  p.outro("Schedule removed.");
}

/** Enable a schedule. */
export async function scheduleEnable(idOrPrefix: string) {
  const schedule = await findSchedule(idOrPrefix);

  if (!schedule) {
    p.log.error(`Schedule not found: ${idOrPrefix}`);
    p.outro("Failed.");
    return;
  }

  if (schedule.enabled) {
    p.log.info(`Schedule ${pc.cyan(schedule.id.slice(0, 8))} is already enabled`);
    return;
  }

  const updated = await enableSchedule(schedule.id);
  if (!updated) {
    p.log.error("Failed to enable schedule");
    p.outro("Failed.");
    return;
  }

  // Reinstall crontab entry
  const s = p.spinner();
  s.start("Updating crontab...");
  try {
    await installCronEntry({
      id: schedule.id,
      cron: schedule.cron,
      task: schedule.task,
      peer: schedule.peer,
      latent: schedule.latent,
      enabled: true,
    });
    s.stop(pc.green("✓ Schedule enabled"));
  } catch (err) {
    s.stop(pc.red("✗ Failed to update crontab"));
    p.log.error(String(err));
    p.outro("Schedule enabled in store but crontab update failed.");
    return;
  }

  p.log.info(`Enabled: ${schedule.task}`);
  p.outro("Done.");
}

/** Disable a schedule. */
export async function scheduleDisable(idOrPrefix: string) {
  const schedule = await findSchedule(idOrPrefix);

  if (!schedule) {
    p.log.error(`Schedule not found: ${idOrPrefix}`);
    p.outro("Failed.");
    return;
  }

  if (!schedule.enabled) {
    p.log.info(`Schedule ${pc.cyan(schedule.id.slice(0, 8))} is already disabled`);
    return;
  }

  const updated = await disableSchedule(schedule.id);
  if (!updated) {
    p.log.error("Failed to disable schedule");
    p.outro("Failed.");
    return;
  }

  // Remove crontab entry
  const s = p.spinner();
  s.start("Updating crontab...");
  try {
    await removeCronEntry(schedule.id);
    s.stop(pc.green("✓ Schedule disabled"));
  } catch (err) {
    s.stop(pc.red("✗ Failed to update crontab"));
    p.log.error(String(err));
    p.outro("Schedule disabled in store but crontab update failed.");
    return;
  }

  p.log.info(`Disabled: ${schedule.task}`);
  p.outro("Done.");
}

/** Manually trigger a schedule (run now). */
export async function scheduleRun(idOrPrefix: string) {
  const schedule = await findSchedule(idOrPrefix);

  if (!schedule) {
    p.log.error(`Schedule not found: ${idOrPrefix}`);
    p.outro("Failed.");
    return;
  }

  p.intro(`${pc.bold("Running scheduled task")} ${pc.cyan(schedule.id.slice(0, 8))}`);
  p.log.info(`Task: ${schedule.task}`);

  // Update last_run timestamp
  await updateLastRun(schedule.id);

  // Invoke cofounder send (with notification webhook if configured)
  await send(schedule.task, {
    peer: schedule.peer,
    latent: schedule.latent,
    wait: false,
    notify: schedule.notify_webhook,
  });

  p.outro("Task sent.");
}
