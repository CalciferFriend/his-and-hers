/**
 * commands/sync.ts — `cofounder sync <path>`
 *
 * Push a local path to the H2 peer over Tailscale SSH using rsync.
 * Useful for keeping a working directory in sync before delegating a task,
 * sharing config files, or live-editing code on H2 with `--watch`.
 *
 * Usage:
 *   cofounder sync ./project            # rsync to ~/project on H2
 *   cofounder sync ./data --dest /data  # explicit remote destination
 *   cofounder sync . --dry-run          # preview without touching H2
 *   cofounder sync ./src --delete       # delete remote files not in local src
 *   cofounder sync ./workspace --watch  # re-sync on every local file change
 *   cofounder sync ./repo --peer piper  # target a specific peer
 *
 * The `--sync <path>` flag on `cofounder send` calls this before task dispatch.
 *
 * Phase 7b — Calcifer ✅ (2026-03-15)
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import * as path from "node:path";
import * as fs from "node:fs";
import { spawn } from "node:child_process";
import { loadConfig } from "../config/store.ts";
import { getPeer } from "../peers/select.ts";
import type { PeerNodeConfig } from "../config/schema.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SyncOptions {
  /** Override remote destination path (defaults to same basename in ~/) */
  dest?: string;
  /** Target a specific peer by name */
  peer?: string;
  /** Preview transfers without writing anything to H2 */
  dryRun?: boolean;
  /** Delete remote files not present in the local source (rsync --delete) */
  delete?: boolean;
  /** Re-sync automatically on local file changes */
  watch?: boolean;
  /** Poll interval for --watch mode in milliseconds (default: 1000) */
  watchIntervalMs?: number;
  /** Suppress progress output (useful when called programmatically) */
  quiet?: boolean;
}

export interface SyncResult {
  ok: boolean;
  localPath: string;
  remotePath: string;
  peer: string;
  dryRun: boolean;
  filesTransferred: number;
  bytesTransferred: number;
  durationMs: number;
  error?: string;
}

// ─── rsync runner ─────────────────────────────────────────────────────────────

/**
 * Build the rsync argument list for a sync operation.
 * Exported for unit tests.
 */
export function buildRsyncArgs(
  localPath: string,
  remoteDest: string,
  peer: PeerNodeConfig,
  opts: Pick<SyncOptions, "dryRun" | "delete">,
): string[] {
  const sshCmd = peer.ssh_key_path
    ? `ssh -i ${peer.ssh_key_path} -o StrictHostKeyChecking=no -o BatchMode=yes`
    : `ssh -o StrictHostKeyChecking=no -o BatchMode=yes`;

  const args: string[] = [
    "-az",
    "--stats",
    "--human-readable",
    `-e`,
    sshCmd,
  ];

  if (opts.dryRun) args.push("--dry-run");
  if (opts.delete) args.push("--delete");

  // Ensure trailing slash on directory sources so rsync mirrors contents
  const src = fs.existsSync(localPath) && fs.statSync(localPath).isDirectory()
    ? localPath.replace(/\/?$/, "/")
    : localPath;

  args.push(src);
  args.push(`${peer.ssh_user}@${peer.tailscale_ip}:${remoteDest}`);

  return args;
}

/**
 * Derive the default remote destination from a local path.
 * e.g. /home/nic/project → ~/project
 */
export function defaultRemoteDest(localPath: string): string {
  return `~/${path.basename(path.resolve(localPath))}`;
}

/**
 * Parse rsync --stats output to extract file/byte counts.
 */
export function parseRsyncStats(output: string): { filesTransferred: number; bytesTransferred: number } {
  let filesTransferred = 0;
  let bytesTransferred = 0;

  const filesMatch = output.match(/Number of regular files transferred:\s+([\d,]+)/);
  if (filesMatch) {
    filesTransferred = parseInt(filesMatch[1]!.replace(/,/g, ""), 10);
  }

  const bytesMatch = output.match(/Total transferred file size:\s+([\d,]+(?:\.\d+)?)\s*([KMGTPE]?B?)/i);
  if (bytesMatch) {
    const val = parseFloat(bytesMatch[1]!.replace(/,/g, ""));
    const unit = (bytesMatch[2] ?? "").toUpperCase();
    const multipliers: Record<string, number> = {
      "": 1, "B": 1, "KB": 1024, "KIB": 1024,
      "MB": 1024 ** 2, "MIB": 1024 ** 2,
      "GB": 1024 ** 3, "GIB": 1024 ** 3,
    };
    bytesTransferred = Math.round(val * (multipliers[unit] ?? 1));
  }

  return { filesTransferred, bytesTransferred };
}

/**
 * Run a single rsync pass. Returns stdout+stderr output and exit code.
 */
export async function runRsync(
  localPath: string,
  remoteDest: string,
  peer: PeerNodeConfig,
  opts: Pick<SyncOptions, "dryRun" | "delete">,
): Promise<{ code: number; output: string }> {
  const args = buildRsyncArgs(localPath, remoteDest, peer, opts);

  return new Promise((resolve) => {
    const child = spawn("rsync", args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d: Buffer) => { output += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { output += d.toString(); });
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
    child.on("error", (err) => resolve({ code: 1, output: err.message }));
  });
}

// ─── Watch mode ───────────────────────────────────────────────────────────────

interface WatchHandle {
  stop(): void;
}

/**
 * Watch a local path for changes and re-sync on each change.
 * Uses fs.watch() with a debounce interval to avoid redundant syncs.
 */
export function watchAndSync(
  localPath: string,
  remoteDest: string,
  peer: PeerNodeConfig,
  opts: Pick<SyncOptions, "dryRun" | "delete" | "quiet">,
  intervalMs = 1000,
  onSync?: (result: { code: number; output: string }) => void,
): WatchHandle {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  const doSync = async () => {
    if (running) return;
    running = true;
    const result = await runRsync(localPath, remoteDest, peer, opts);
    running = false;
    onSync?.(result);
  };

  const trigger = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(doSync, intervalMs);
  };

  // Use recursive watch when available (Node 18+)
  const watcher = fs.watch(localPath, { recursive: true }, () => trigger());

  return {
    stop() {
      if (debounceTimer) clearTimeout(debounceTimer);
      watcher.close();
    },
  };
}

// ─── Command ──────────────────────────────────────────────────────────────────

export async function sync(localPath: string, opts: SyncOptions = {}): Promise<SyncResult> {
  const config = await loadConfig();
  if (!config) {
    p.log.error("Not configured. Run `cofounder onboard` first.");
    process.exit(1);
  }

  const peer = getPeer(config, opts.peer);
  const remoteDest = opts.dest ?? defaultRemoteDest(localPath);
  const resolvedLocal = path.resolve(localPath);

  if (!opts.quiet) {
    p.intro(pc.bgCyan(pc.black(" cofounder sync ")));
  }

  // Validate local path
  if (!fs.existsSync(resolvedLocal)) {
    const errMsg = `Local path not found: ${resolvedLocal}`;
    if (!opts.quiet) p.log.error(errMsg);
    return {
      ok: false,
      localPath: resolvedLocal,
      remotePath: remoteDest,
      peer: peer.name,
      dryRun: opts.dryRun ?? false,
      filesTransferred: 0,
      bytesTransferred: 0,
      durationMs: 0,
      error: errMsg,
    };
  }

  if (opts.watch) {
    // ── Watch mode ──────────────────────────────────────────────────────────
    if (!opts.quiet) {
      p.log.info(
        `${pc.cyan("watch")} ${pc.bold(resolvedLocal)} → ` +
        `${pc.yellow(peer.ssh_user)}@${pc.yellow(peer.tailscale_ip)}:${pc.bold(remoteDest)}`,
      );
      p.log.info(pc.dim("Syncing now, then watching for changes. Ctrl-C to stop."));
    }

    // Initial sync
    const initStart = Date.now();
    const initResult = await runRsync(resolvedLocal, remoteDest, peer, opts);
    const initDuration = Date.now() - initStart;
    const initStats = parseRsyncStats(initResult.output);

    if (!opts.quiet) {
      if (initResult.code === 0) {
        p.log.success(
          pc.green(`✓ Initial sync complete`) +
          pc.dim(` — ${initStats.filesTransferred} files in ${initDuration}ms`),
        );
      } else {
        p.log.warn(pc.yellow(`⚠ Initial sync had errors (code ${initResult.code})`));
      }
    }

    // Watch loop — runs until Ctrl-C
    const handle = watchAndSync(
      resolvedLocal,
      remoteDest,
      peer,
      opts,
      opts.watchIntervalMs ?? 1000,
      (result) => {
        const stats = parseRsyncStats(result.output);
        if (!opts.quiet) {
          const ts = new Date().toTimeString().slice(0, 8);
          if (result.code === 0) {
            if (stats.filesTransferred > 0) {
              p.log.info(
                pc.dim(`[${ts}]`) + " " +
                pc.green(`↑ ${stats.filesTransferred} file${stats.filesTransferred === 1 ? "" : "s"} synced`),
              );
            }
          } else {
            p.log.warn(pc.yellow(`[${ts}] ⚠ sync error (code ${result.code})`));
          }
        }
      },
    );

    // Block until SIGINT
    await new Promise<void>((resolve) => {
      process.once("SIGINT", () => {
        handle.stop();
        if (!opts.quiet) p.outro(pc.dim("Watch stopped."));
        resolve();
      });
    });

    return {
      ok: initResult.code === 0,
      localPath: resolvedLocal,
      remotePath: remoteDest,
      peer: peer.name,
      dryRun: opts.dryRun ?? false,
      filesTransferred: initStats.filesTransferred,
      bytesTransferred: initStats.bytesTransferred,
      durationMs: initDuration,
    };
  }

  // ── One-shot sync ──────────────────────────────────────────────────────────
  if (!opts.quiet) {
    const dryTag = opts.dryRun ? pc.yellow(" [dry-run]") : "";
    const delTag = opts.delete ? pc.red(" [--delete]") : "";
    p.log.info(
      `${pc.cyan("sync")}${dryTag}${delTag}  ` +
      `${pc.bold(resolvedLocal)} → ` +
      `${pc.yellow(peer.ssh_user)}@${pc.yellow(peer.tailscale_ip)}:${pc.bold(remoteDest)}`,
    );
  }

  const spinner = opts.quiet ? null : p.spinner();
  spinner?.start("Running rsync…");

  const start = Date.now();
  const result = await runRsync(resolvedLocal, remoteDest, peer, opts);
  const durationMs = Date.now() - start;

  const stats = parseRsyncStats(result.output);

  if (result.code === 0) {
    const summary = opts.dryRun
      ? pc.yellow("Dry run complete")
      : pc.green("Sync complete");
    spinner?.stop(
      `${summary} — ${stats.filesTransferred} file${stats.filesTransferred === 1 ? "" : "s"}, ${durationMs}ms`,
    );
    if (!opts.quiet) {
      p.outro(pc.dim(`${resolvedLocal} → ${peer.name}:${remoteDest}`));
    }
  } else {
    spinner?.stop(pc.red(`rsync exited with code ${result.code}`));
    if (!opts.quiet) {
      p.log.error(result.output.slice(-500)); // last 500 chars of output
    }
  }

  return {
    ok: result.code === 0,
    localPath: resolvedLocal,
    remotePath: remoteDest,
    peer: peer.name,
    dryRun: opts.dryRun ?? false,
    filesTransferred: stats.filesTransferred,
    bytesTransferred: stats.bytesTransferred,
    durationMs,
    error: result.code !== 0 ? `rsync exited with code ${result.code}` : undefined,
  };
}
