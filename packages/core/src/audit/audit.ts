/**
 * core/audit/audit.ts — Append-only HMAC audit log
 *
 * Every task send/receive creates a tamper-evident entry in the audit log.
 * Each entry is chained via SHA-256 hashes to detect tampering.
 */

import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const AUDIT_DIR = join(homedir(), ".his-and-hers");
const AUDIT_LOG_PATH = join(AUDIT_DIR, "audit.log");
const AUDIT_KEY_PATH = join(AUDIT_DIR, "audit-key");

export interface AuditEntry {
  ts: string; // ISO 8601 timestamp
  seq: number; // Sequence number (1-based)
  event: "task_sent" | "task_received" | "task_completed";
  peer: string; // Peer node name
  task_id: string;
  objective: string;
  status?: string; // Task status (for task_completed)
  cost_usd?: number;
  prev_hash: string; // SHA-256 of previous entry JSON (or "genesis")
  hash: string; // SHA-256 of this entry (without hash field) + prev_hash
}

export interface AuditFilter {
  peer?: string;
  since?: number; // Unix timestamp in ms
  limit?: number;
}

export interface VerifyResult {
  ok: boolean;
  brokenAt?: number; // Sequence number where chain broke
}

/**
 * Append a new audit entry to the log.
 * Returns the created entry.
 */
export async function appendAuditEntry(
  event: AuditEntry["event"],
  data: Partial<AuditEntry>,
): Promise<AuditEntry> {
  await mkdir(AUDIT_DIR, { recursive: true });

  // Read existing entries to get last hash and seq
  const entries = await readAuditLog();
  const lastEntry = entries[entries.length - 1];
  const seq = lastEntry ? lastEntry.seq + 1 : 1;
  const prev_hash = lastEntry ? lastEntry.hash : "genesis";

  // Build entry without hash
  const entryWithoutHash: Omit<AuditEntry, "hash"> = {
    ts: new Date().toISOString(),
    seq,
    event,
    peer: data.peer ?? "unknown",
    task_id: data.task_id ?? "unknown",
    objective: data.objective ?? "",
    status: data.status,
    cost_usd: data.cost_usd,
    prev_hash,
  };

  // Compute hash of this entry + prev_hash
  const hash = computeHash(entryWithoutHash);

  const entry: AuditEntry = {
    ...entryWithoutHash,
    hash,
  };

  // Append to log file (newline-delimited JSON)
  const line = JSON.stringify(entry) + "\n";
  await appendFile(AUDIT_LOG_PATH, line, "utf-8");

  return entry;
}

/**
 * Read all audit log entries, optionally filtered.
 */
export async function readAuditLog(filter?: AuditFilter): Promise<AuditEntry[]> {
  try {
    const raw = await readFile(AUDIT_LOG_PATH, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    let entries = lines.map((line) => JSON.parse(line) as AuditEntry);

    // Apply filters
    if (filter?.peer) {
      entries = entries.filter((e) =>
        e.peer.toLowerCase().includes(filter.peer!.toLowerCase()),
      );
    }

    if (filter?.since) {
      entries = entries.filter((e) => new Date(e.ts).getTime() >= filter.since!);
    }

    if (filter?.limit && filter.limit > 0) {
      entries = entries.slice(-filter.limit);
    }

    return entries;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

/**
 * Verify the integrity of the audit log hash chain.
 * Returns { ok: true } if valid, or { ok: false, brokenAt: <seq> } if tampered.
 */
export async function verifyAuditChain(entries?: AuditEntry[]): Promise<VerifyResult> {
  const entriesToVerify = entries ?? (await readAuditLog());

  if (entriesToVerify.length === 0) {
    return { ok: true };
  }

  for (let i = 0; i < entriesToVerify.length; i++) {
    const entry = entriesToVerify[i];
    const expectedPrevHash = i === 0 ? "genesis" : entriesToVerify[i - 1].hash;

    // Check prev_hash links correctly
    if (entry.prev_hash !== expectedPrevHash) {
      return { ok: false, brokenAt: entry.seq };
    }

    // Recompute hash and verify
    const entryWithoutHash: Omit<AuditEntry, "hash"> = {
      ts: entry.ts,
      seq: entry.seq,
      event: entry.event,
      peer: entry.peer,
      task_id: entry.task_id,
      objective: entry.objective,
      status: entry.status,
      cost_usd: entry.cost_usd,
      prev_hash: entry.prev_hash,
    };

    const computedHash = computeHash(entryWithoutHash);
    if (computedHash !== entry.hash) {
      return { ok: false, brokenAt: entry.seq };
    }
  }

  return { ok: true };
}

/**
 * Get or create the per-install audit key (32-byte hex string).
 */
export async function getOrCreateAuditKey(): Promise<string> {
  await mkdir(AUDIT_DIR, { recursive: true });

  try {
    const key = await readFile(AUDIT_KEY_PATH, "utf-8");
    return key.trim();
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // Generate new key
      const key = randomBytes(32).toString("hex");
      await writeFile(AUDIT_KEY_PATH, key, { mode: 0o600 });
      return key;
    }
    throw err;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeHash(entry: Omit<AuditEntry, "hash">): string {
  const canonical = JSON.stringify(entry);
  return createHash("sha256").update(canonical).digest("hex");
}
