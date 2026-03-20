/**
 * context/store.ts — Per-peer context summary ring buffer.
 *
 * H1 keeps a rolling window of the last N task summaries per peer.
 * On the next outbound task message, the recent summaries are serialized
 * into `CofounderTaskMessage.context_summary` so H2 has multi-turn context
 * without requiring a full session transcript.
 *
 * Storage: ~/.cofounder/context/<peer-name>.json
 * Format:  JSON array of ContextEntry, capped at MAX_ENTRIES (newest last).
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CONTEXT_DIR = join(homedir(), ".cofounder", "context");
const MAX_ENTRIES = 10;

export interface ContextEntry {
  /** ID of the task this summary was generated from */
  task_id: string;
  /** One-paragraph human-readable summary */
  summary: string;
  /** ISO datetime when this entry was created */
  created_at: string;
}

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
}

function contextPath(peerName: string): string {
  return join(CONTEXT_DIR, `${safeFilename(peerName)}.json`);
}

async function ensureContextDir(): Promise<void> {
  await mkdir(CONTEXT_DIR, { recursive: true });
}

/**
 * Append a new context entry for a peer.
 * Old entries beyond MAX_ENTRIES are pruned (oldest first).
 */
export async function appendContextEntry(
  peerName: string,
  entry: ContextEntry,
): Promise<void> {
  await ensureContextDir();
  const existing = await loadContextEntries(peerName);
  existing.push(entry);
  const trimmed = existing.slice(-MAX_ENTRIES);
  await writeFile(contextPath(peerName), JSON.stringify(trimmed, null, 2), { mode: 0o600 });
}

/**
 * Load all stored context entries for a peer. Returns [] if none.
 */
export async function loadContextEntries(peerName: string): Promise<ContextEntry[]> {
  try {
    const raw = await readFile(contextPath(peerName), "utf-8");
    return JSON.parse(raw) as ContextEntry[];
  } catch {
    return [];
  }
}

/**
 * Build a single condensed context string from the last `limit` entries.
 * Returns null if there are no stored entries (first task — no prior context).
 *
 * The returned string is suitable for `CofounderTaskMessage.context_summary`.
 *
 * @deprecated Use `buildContextSummary(task, result)` for on-the-fly summaries,
 *   or `loadContextSummary(peerName, limit)` to read from stored peer history.
 */
export async function loadContextSummary(
  peerName: string,
  limit = 3,
): Promise<string | null> {
  const entries = await loadContextEntries(peerName);
  if (entries.length === 0) return null;

  const recent = entries.slice(-limit);
  const lines = recent.map((e, i) => `[${i + 1}] ${e.summary}`);
  return `Recent task context (${recent.length} task${recent.length === 1 ? "" : "s"}):\n${lines.join("\n")}`;
}

/**
 * Generate a one-paragraph plain-text summary from a task description and its result.
 *
 * This is a pure synchronous helper — no disk I/O, no async.
 * Use it to build a `ContextEntry.summary` before calling `appendContextEntry()`.
 *
 * @param task   - The original task description sent to H2
 * @param result - The output/result returned by H2 (may be empty)
 * @returns A compact summary string suitable for `CofounderTaskMessage.context_summary`
 *
 * @example
 * const summary = buildContextSummary(
 *   "Generate a Python script to scrape product prices",
 *   "Done. Script saved to /tmp/scraper.py — uses httpx and BeautifulSoup.",
 * );
 */
export function buildContextSummary(task: string, result: string): string {
  const MAX_TASK = 200;
  const MAX_RESULT = 500;

  const truncate = (s: string, max: number) =>
    s.length > max ? s.slice(0, max).trimEnd() + "…" : s;

  const shortTask = truncate(task.trim(), MAX_TASK);
  const shortResult = result.trim()
    ? truncate(result.trim(), MAX_RESULT)
    : "(no output)";

  return `Task: ${shortTask}\nResult: ${shortResult}`;
}

/**
 * Clear all context entries for a peer.
 * Call this after a fresh onboard or when resetting a peer relationship.
 */
export async function clearContextEntries(peerName: string): Promise<void> {
  await ensureContextDir();
  await writeFile(contextPath(peerName), "[]", { mode: 0o600 });
}

/**
 * Returns how many entries are stored for a peer.
 */
export async function contextEntryCount(peerName: string): Promise<number> {
  const entries = await loadContextEntries(peerName);
  return entries.length;
}
