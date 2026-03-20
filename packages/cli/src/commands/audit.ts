/**
 * commands/audit.ts — `cofounder audit`
 *
 * View and verify the append-only audit log.
 *
 * Usage:
 *   cofounder audit list                        → display recent audit log
 *   cofounder audit list --peer glados          → filter by peer
 *   cofounder audit list --since 7d             → last 7 days
 *   cofounder audit list --limit 50             → last 50 entries
 *   cofounder audit list --json                 → machine-readable
 *   cofounder audit verify                      → verify hash chain integrity
 *   cofounder audit export --json               → export full log as JSON
 *   cofounder audit export --csv                → export as CSV
 *   cofounder audit export --output file.json   → write to file
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { readAuditLog, verifyAuditChain, type AuditEntry } from "@cofounder/core";
import { writeFile } from "node:fs/promises";

export interface AuditListOptions {
  peer?: string;
  since?: string;
  limit?: string;
  json?: boolean;
}

export interface AuditExportOptions {
  json?: boolean;
  csv?: boolean;
  output?: string;
}

/**
 * List audit log entries with optional filters.
 */
export async function auditList(opts: AuditListOptions = {}) {
  try {
    const filter: { peer?: string; since?: number; limit?: number } = {};

    if (opts.peer) {
      filter.peer = opts.peer;
    }

    if (opts.since) {
      filter.since = parseDuration(opts.since);
    }

    if (opts.limit) {
      filter.limit = parseInt(opts.limit, 10);
    }

    const entries = await readAuditLog(filter);

    if (opts.json) {
      console.log(JSON.stringify(entries, null, 2));
      return;
    }

    if (entries.length === 0) {
      p.intro(pc.bgMagenta(pc.white(" cofounder audit list ")));
      p.log.info("No audit entries found.");
      p.outro("Done.");
      return;
    }

    p.intro(pc.bgMagenta(pc.white(" cofounder audit list ")));

    p.log.info(`${pc.dim("Showing")} ${pc.cyan(String(entries.length))} ${pc.dim("entries")}`);
    p.log.message("");

    for (const entry of entries) {
      const timestamp = new Date(entry.ts).toLocaleString();
      const eventColor =
        entry.event === "task_sent"
          ? pc.blue
          : entry.event === "task_received"
            ? pc.yellow
            : pc.green;

      p.log.info(
        `${pc.dim(String(entry.seq).padStart(4))} ${eventColor(entry.event.padEnd(15))} ${pc.cyan(entry.peer.padEnd(12))} ${pc.dim(entry.task_id.slice(0, 8))} ${pc.italic(truncate(entry.objective, 40))}`,
      );

      if (entry.status) {
        p.log.info(`       ${pc.dim("status:")} ${entry.status}`);
      }

      if (entry.cost_usd !== undefined) {
        p.log.info(`       ${pc.dim("cost:")} $${entry.cost_usd.toFixed(3)}`);
      }
    }

    p.log.message("");
    p.outro("Done.");
  } catch (err) {
    p.log.error(`Failed to list audit log: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Verify audit log hash chain integrity.
 */
export async function auditVerify() {
  try {
    p.intro(pc.bgMagenta(pc.white(" cofounder audit verify ")));

    const entries = await readAuditLog();

    if (entries.length === 0) {
      p.log.info("Audit log is empty. Nothing to verify.");
      p.outro("Done.");
      return;
    }

    p.log.info(`Verifying ${pc.cyan(String(entries.length))} entries...`);

    const result = await verifyAuditChain(entries);

    if (result.ok) {
      p.log.success(pc.green("✓ Audit chain is valid."));
      p.log.info(`All ${entries.length} entries verified successfully.`);
    } else {
      p.log.error(pc.red("✗ Audit chain is broken!"));
      p.log.error(`Chain integrity failed at sequence ${pc.cyan(String(result.brokenAt))}`);
      process.exitCode = 1;
    }

    p.outro("Done.");
  } catch (err) {
    p.log.error(`Failed to verify audit log: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Export full audit log as JSON or CSV.
 */
export async function auditExport(opts: AuditExportOptions = {}) {
  try {
    const entries = await readAuditLog();

    if (entries.length === 0) {
      p.log.info("Audit log is empty. Nothing to export.");
      return;
    }

    let output: string;

    if (opts.csv) {
      output = formatAsCSV(entries);
    } else {
      // Default to JSON
      output = JSON.stringify(entries, null, 2);
    }

    if (opts.output) {
      await writeFile(opts.output, output, "utf-8");
      p.intro(pc.bgMagenta(pc.white(" cofounder audit export ")));
      p.log.success(`Exported ${pc.cyan(String(entries.length))} entries to ${pc.dim(opts.output)}`);
      p.outro("Done.");
    } else {
      console.log(output);
    }
  } catch (err) {
    p.log.error(`Failed to export audit log: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}. Use format like 7d, 24h, 30m`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  const now = Date.now();
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return now - value * multipliers[unit];
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

function formatAsCSV(entries: AuditEntry[]): string {
  const header = "seq,ts,event,peer,task_id,objective,status,cost_usd,prev_hash,hash\n";
  const rows = entries.map((e) => {
    return [
      e.seq,
      e.ts,
      e.event,
      e.peer,
      e.task_id,
      `"${e.objective.replace(/"/g, '""')}"`, // CSV escape
      e.status ?? "",
      e.cost_usd ?? "",
      e.prev_hash,
      e.hash,
    ].join(",");
  });

  return header + rows.join("\n");
}
