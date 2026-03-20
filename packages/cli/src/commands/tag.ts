/**
 * commands/tag.ts — `cofounder tag` task tagging & search
 *
 * Label tasks with tags, then filter and search by tag. Tags help organise
 * task history for reporting, debugging, and retrieval.
 *
 * Usage:
 *   cofounder tag add <id> <tags...> [--note "..."] [--json]
 *   cofounder tag remove <id> <tags...>
 *   cofounder tag list [id] [--json]
 *   cofounder tag search <tag> [--json]
 *   cofounder tag clear <id> [--force]
 *
 * Phase 17b — Calcifer (2026-03-16)
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  addTag,
  removeTag,
  getTagRecord,
  listTagRecords,
  findByTag,
  clearTagRecord,
  validateTag,
} from "@cofounder/core";
import type { TagRecord } from "@cofounder/core";
import { listTaskStates } from "../state/tasks.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TagListEntry {
  task_id: string;
  tags: string[];
  note?: string;
  tagged_at: string;
  task_summary?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve a task ID prefix to a full task ID by matching state files. */
async function resolveTaskPrefix(prefix: string): Promise<string | null> {
  const tasks = await listTaskStates();
  const match = tasks.find((t) => t.id.startsWith(prefix));
  return match?.id ?? null;
}

/** Get a short summary (first 60 chars of objective) for a task ID. */
async function getTaskSummary(taskId: string): Promise<string | undefined> {
  const tasks = await listTaskStates();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return undefined;
  const text = task.objective;
  return text.length > 60 ? text.slice(0, 57) + "..." : text;
}

/** Convert a TagRecord to a TagListEntry with optional task summary. */
async function toListEntry(record: TagRecord): Promise<TagListEntry> {
  const summary = await getTaskSummary(record.task_id);
  return {
    task_id: record.task_id,
    tags: record.tags,
    note: record.note,
    tagged_at: record.tagged_at,
    task_summary: summary,
  };
}

// ─── tag add ──────────────────────────────────────────────────────────────────

export async function tagAdd(
  idPrefix: string,
  tags: string[],
  opts: { note?: string; json?: boolean },
): Promise<void> {
  const taskId = await resolveTaskPrefix(idPrefix);
  if (!taskId) {
    if (opts.json) {
      console.log(JSON.stringify({ error: "Task not found", prefix: idPrefix }));
    } else {
      console.error(pc.red(`No task found matching prefix "${idPrefix}".`));
    }
    process.exitCode = 1;
    return;
  }

  // Validate tags up front
  for (const t of tags) {
    const err = validateTag(t);
    if (err) {
      if (opts.json) {
        console.log(JSON.stringify({ error: err, tag: t }));
      } else {
        console.error(pc.red(`Invalid tag "${t}": ${err}`));
      }
      process.exitCode = 1;
      return;
    }
  }

  try {
    const record = await addTag(taskId, tags, opts.note);
    if (opts.json) {
      console.log(JSON.stringify(await toListEntry(record), null, 2));
    } else {
      p.log.success(
        `Tagged ${pc.cyan(taskId.slice(0, 8))} with ${record.tags.map((t) => pc.bold(pc.green(t))).join(", ")}`,
      );
    }
  } catch (err: any) {
    if (opts.json) {
      console.log(JSON.stringify({ error: err.message }));
    } else {
      console.error(pc.red(`Error: ${err.message}`));
    }
    process.exitCode = 1;
  }
}

// ─── tag remove ───────────────────────────────────────────────────────────────

export async function tagRemove(idPrefix: string, tags: string[]): Promise<void> {
  const taskId = await resolveTaskPrefix(idPrefix);
  if (!taskId) {
    console.error(pc.red(`No task found matching prefix "${idPrefix}".`));
    process.exitCode = 1;
    return;
  }

  const record = await removeTag(taskId, tags);
  p.log.success(
    `Removed tags from ${pc.cyan(taskId.slice(0, 8))}. Remaining: ${
      record.tags.length > 0
        ? record.tags.map((t) => pc.bold(t)).join(", ")
        : pc.dim("none")
    }`,
  );
}

// ─── tag list ─────────────────────────────────────────────────────────────────

export async function tagList(
  idPrefix: string | undefined,
  opts: { json?: boolean },
): Promise<void> {
  if (idPrefix) {
    // Show tags for a specific task
    const taskId = await resolveTaskPrefix(idPrefix);
    if (!taskId) {
      if (opts.json) {
        console.log(JSON.stringify({ error: "Task not found", prefix: idPrefix }));
      } else {
        console.error(pc.red(`No task found matching prefix "${idPrefix}".`));
      }
      process.exitCode = 1;
      return;
    }

    const record = await getTagRecord(taskId);
    if (!record || record.tags.length === 0) {
      if (opts.json) {
        console.log(JSON.stringify({ task_id: taskId, tags: [] }));
      } else {
        p.log.info(`No tags on task ${pc.cyan(taskId.slice(0, 8))}.`);
      }
      return;
    }

    const entry = await toListEntry(record);
    if (opts.json) {
      console.log(JSON.stringify(entry, null, 2));
      return;
    }

    console.log(pc.bold(`\n  Tags for ${pc.cyan(taskId.slice(0, 8))}\n`));
    if (entry.task_summary) {
      console.log(`  ${pc.dim(entry.task_summary)}`);
    }
    console.log(`  Tags: ${record.tags.map((t) => pc.bold(pc.green(t))).join(", ")}`);
    if (record.note) console.log(`  Note: ${record.note}`);
    console.log();
    return;
  }

  // List all tagged tasks
  const records = await listTagRecords();
  if (records.length === 0) {
    if (opts.json) {
      console.log("[]");
    } else {
      p.log.info("No tagged tasks. Use `cofounder tag add <id> <tags...>` to start.");
    }
    return;
  }

  const entries = await Promise.all(records.map(toListEntry));

  if (opts.json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  console.log(pc.bold(`\n  Tagged Tasks (${entries.length})\n`));
  for (const entry of entries) {
    const id = pc.cyan(entry.task_id.slice(0, 8));
    const tags = entry.tags.map((t) => pc.green(t)).join(", ");
    const summary = entry.task_summary ? pc.dim(`  ${entry.task_summary}`) : "";
    console.log(`  ${id}  ${tags}${summary}`);
  }
  console.log();
}

// ─── tag search ───────────────────────────────────────────────────────────────

export async function tagSearch(
  tag: string,
  opts: { json?: boolean },
): Promise<void> {
  const results = await findByTag(tag);

  if (results.length === 0) {
    if (opts.json) {
      console.log("[]");
    } else {
      p.log.info(`No tasks tagged with ${pc.bold(tag)}.`);
    }
    return;
  }

  const entries = await Promise.all(results.map(toListEntry));

  if (opts.json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  console.log(pc.bold(`\n  Tasks tagged "${pc.green(tag)}" (${entries.length})\n`));
  for (const entry of entries) {
    const id = pc.cyan(entry.task_id.slice(0, 8));
    const tags = entry.tags.map((t) => pc.green(t)).join(", ");
    const summary = entry.task_summary ? pc.dim(`  ${entry.task_summary}`) : "";
    console.log(`  ${id}  ${tags}${summary}`);
  }
  console.log();
}

// ─── tag clear ────────────────────────────────────────────────────────────────

export async function tagClear(
  idPrefix: string,
  opts: { force?: boolean },
): Promise<void> {
  const taskId = await resolveTaskPrefix(idPrefix);
  if (!taskId) {
    console.error(pc.red(`No task found matching prefix "${idPrefix}".`));
    process.exitCode = 1;
    return;
  }

  if (!opts.force) {
    const confirmed = await p.confirm({
      message: `Remove all tags from task ${pc.cyan(taskId.slice(0, 8))}?`,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      p.log.info("Aborted.");
      return;
    }
  }

  const removed = await clearTagRecord(taskId);
  if (removed) {
    p.log.success(`All tags cleared from ${pc.cyan(taskId.slice(0, 8))}.`);
  } else {
    p.log.info(`No tags found on task ${pc.cyan(taskId.slice(0, 8))}.`);
  }
}
