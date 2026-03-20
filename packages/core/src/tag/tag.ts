/**
 * core/src/tag/tag.ts — task tagging helpers
 *
 * Tags are stored in ~/.cofounder/tags/<task_id>.json as:
 *   { task_id: string; tags: string[]; note?: string; tagged_at: string }
 *
 * Tag names: lowercase, alphanumeric + hyphen, max 32 chars.
 * Max 20 tags per task.
 */

import { readFile, writeFile, readdir, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TagRecord {
  task_id: string;
  tags: string[];
  note?: string;
  tagged_at: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TAG_NAME_RE = /^[a-z0-9-]+$/;
const MAX_TAG_LENGTH = 32;
const MAX_TAGS_PER_TASK = 20;

// ─── Storage path ─────────────────────────────────────────────────────────────

function tagsDir(): string {
  return join(homedir(), ".cofounder", "tags");
}

function tagPath(taskId: string): string {
  return join(tagsDir(), `${taskId}.json`);
}

async function ensureTagsDir(): Promise<void> {
  await mkdir(tagsDir(), { recursive: true });
}

// ─── Validation ───────────────────────────────────────────────────────────────

/** Validate a tag name. Returns error message or null if valid. */
export function validateTag(name: string): string | null {
  const trimmed = name.trim().toLowerCase();
  if (trimmed.length === 0) return "Tag name cannot be empty";
  if (trimmed.length > MAX_TAG_LENGTH) return `Tag name exceeds ${MAX_TAG_LENGTH} characters`;
  if (!TAG_NAME_RE.test(trimmed)) return "Tag name must be lowercase alphanumeric + hyphen only";
  return null;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/** Load a tag record for a task. Returns null if none exists. */
export async function getTagRecord(taskId: string): Promise<TagRecord | null> {
  try {
    const raw = await readFile(tagPath(taskId), "utf8");
    return JSON.parse(raw) as TagRecord;
  } catch {
    return null;
  }
}

/** Add tags to a task. Creates a new record or merges with existing. */
export async function addTag(taskId: string, tags: string[], note?: string): Promise<TagRecord> {
  // Validate all tags
  for (const t of tags) {
    const err = validateTag(t);
    if (err) throw new Error(`Invalid tag "${t}": ${err}`);
  }

  await ensureTagsDir();

  const existing = await getTagRecord(taskId);
  const normalised = tags.map((t) => t.trim().toLowerCase());

  // Merge with existing tags, deduplicate
  const merged = existing
    ? [...new Set([...existing.tags, ...normalised])]
    : [...new Set(normalised)];

  if (merged.length > MAX_TAGS_PER_TASK) {
    throw new Error(`Cannot exceed ${MAX_TAGS_PER_TASK} tags per task (would have ${merged.length})`);
  }

  const record: TagRecord = {
    task_id: taskId,
    tags: merged,
    note: note ?? existing?.note,
    tagged_at: existing?.tagged_at ?? new Date().toISOString(),
  };

  await writeFile(tagPath(taskId), JSON.stringify(record, null, 2) + "\n", "utf8");
  return record;
}

/** Remove specific tags from a task. */
export async function removeTag(taskId: string, tags: string[]): Promise<TagRecord> {
  const existing = await getTagRecord(taskId);
  if (!existing) {
    return { task_id: taskId, tags: [], tagged_at: new Date().toISOString() };
  }

  const toRemove = new Set(tags.map((t) => t.trim().toLowerCase()));
  const remaining = existing.tags.filter((t) => !toRemove.has(t));

  const record: TagRecord = {
    ...existing,
    tags: remaining,
  };

  await ensureTagsDir();
  await writeFile(tagPath(taskId), JSON.stringify(record, null, 2) + "\n", "utf8");
  return record;
}

/** List all tag records from ~/.cofounder/tags/. */
export async function listTagRecords(): Promise<TagRecord[]> {
  const dir = tagsDir();
  if (!existsSync(dir)) return [];

  const files = await readdir(dir);
  const records: TagRecord[] = [];

  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(dir, f), "utf8");
      records.push(JSON.parse(raw) as TagRecord);
    } catch {
      // Skip malformed files
    }
  }

  return records.sort((a, b) => b.tagged_at.localeCompare(a.tagged_at));
}

/** Find all records containing a specific tag. */
export async function findByTag(tag: string): Promise<TagRecord[]> {
  const normalised = tag.trim().toLowerCase();
  const all = await listTagRecords();
  return all.filter((r) => r.tags.includes(normalised));
}

/** Delete a tag record entirely. Returns true if it existed. */
export async function clearTagRecord(taskId: string): Promise<boolean> {
  try {
    await unlink(tagPath(taskId));
    return true;
  } catch {
    return false;
  }
}
