/**
 * capabilities/store.ts
 *
 * Persist and load TJCapabilityReport to/from disk.
 *
 * Jerry writes:  ~/.his-and-hers/capabilities.json  (her own report)
 * Tom writes:    ~/.his-and-hers/peer-capabilities.json  (fetched from Jerry)
 *
 * Both files are world-readable so the gateway can serve them without
 * extra permissions.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { TJCapabilityReport } from "./registry.schema.ts";

const BASE_DIR = join(homedir(), ".his-and-hers");
const SELF_PATH = join(BASE_DIR, "capabilities.json");
const PEER_PATH = join(BASE_DIR, "peer-capabilities.json");

async function ensureBaseDir(): Promise<void> {
  await mkdir(BASE_DIR, { recursive: true });
}

// ─── Self capabilities (Jerry writes this) ───────────────────────────────────

/** Save this node's own capability report. */
export async function saveCapabilities(report: TJCapabilityReport): Promise<void> {
  await ensureBaseDir();
  await writeFile(SELF_PATH, JSON.stringify(report, null, 2), { mode: 0o644 });
}

/** Load this node's own capability report. Returns null if not yet advertised. */
export async function loadCapabilities(): Promise<TJCapabilityReport | null> {
  if (!existsSync(SELF_PATH)) return null;
  try {
    const raw = await readFile(SELF_PATH, "utf-8");
    return TJCapabilityReport.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

// ─── Peer capabilities (Tom writes this after fetching from Jerry) ─────────

/** Save peer's capability report (fetched remotely). */
export async function savePeerCapabilities(
  report: TJCapabilityReport,
): Promise<void> {
  await ensureBaseDir();
  const stamped: TJCapabilityReport = {
    ...report,
    fetched_at: new Date().toISOString(),
  };
  await writeFile(PEER_PATH, JSON.stringify(stamped, null, 2), { mode: 0o644 });
}

/** Load the last-known peer capability report. Returns null if never fetched. */
export async function loadPeerCapabilities(): Promise<TJCapabilityReport | null> {
  if (!existsSync(PEER_PATH)) return null;
  try {
    const raw = await readFile(PEER_PATH, "utf-8");
    return TJCapabilityReport.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Returns true if the peer capability report is stale (older than maxAgeMs).
 * Defaults to 24 hours.
 */
export function isPeerCapabilityStale(
  report: TJCapabilityReport,
  maxAgeMs = 24 * 60 * 60 * 1000,
): boolean {
  const fetchedAt = report.fetched_at ?? report.reported_at;
  return Date.now() - new Date(fetchedAt).getTime() > maxAgeMs;
}
