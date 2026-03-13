/**
 * commands/watch.ts — `hh watch`
 *
 * H2-side task listener daemon. Polls the local task state directory for
 * pending tasks and dispatches them to an executor, then writes the result
 * back via `hh result` (and optionally POSTs to H1's webhook endpoint).
 *
 * ## Typical H2 workflow
 *
 *   H1 (Calcifer 🔥)                          H2 (GLaDOS 🤖)
 *   ─────────────────                          ─────────────────
 *   hh send "do X" →                          ← wakeAgent injects task
 *                                              hh watch (daemon) sees it
 *                                              → runs executor
 *                                              hh result <id> "done"
 *                                              → webhook / SSH back to H1
 *
 * ## Executor contract
 *
 *   Set `--exec <cmd>` to a command that:
 *     - Receives the task JSON on stdin
 *     - Writes its result text to stdout
 *     - Exits 0 on success, non-zero on failure
 *
 *   Example:
 *     hh watch --exec "node /path/to/run-task.js"
 *
 *   Environment variables injected for the executor process:
 *     HH_TASK_ID          task UUID
 *     HH_TASK_OBJECTIVE   task description string
 *     HH_TASK_FROM        sender node name
 *
 * ## Default (no --exec)
 *
 *   If no executor is configured, `hh watch` marks tasks as "running" and
 *   emits them to stdout so a parent process / shell pipeline can handle them.
 *   This is useful during initial setup or for building custom integrations.
 *
 * ## Capabilities server (--serve-capabilities)
 *
 *   When H2 runs `hh watch --serve-capabilities`, it also starts a lightweight
 *   HTTP server that H1 can query with `hh capabilities fetch`:
 *
 *     GET /capabilities  →  returns ~/.his-and-hers/capabilities.json
 *     (auth: X-HH-Token header, same token as the gateway)
 *
 *   This is the implementation of ROADMAP item 3b. Add it to startup.bat:
 *
 *     hh watch --exec "node run-task.js" --serve-capabilities
 *     hh watch --exec "node run-task.js" --serve-capabilities 18790
 *
 * Usage:
 *   hh watch                                   # poll every 5s, print pending
 *   hh watch --interval 10                     # poll every 10s
 *   hh watch --exec "node run-task.js"         # auto-dispatch to executor
 *   hh watch --once                            # single-pass (no loop)
 *   hh watch --dry-run                         # detect without executing
 *   hh watch --json                            # machine-readable output
 *   hh watch --serve-capabilities              # also serve /capabilities on gateway port
 *   hh watch --serve-capabilities 18790        # serve on explicit port
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { spawn } from "node:child_process";
import { listTaskStates, updateTaskState, type TaskState } from "../state/tasks.ts";
import { startCapabilitiesServer, type CapabilitiesServerHandle } from "@his-and-hers/core";
import { loadConfig } from "../config/store.ts";

export interface WatchOptions {
  /** Poll interval in seconds (default: 5) */
  interval?: string;
  /** Shell command to dispatch tasks to */
  exec?: string;
  /** Single-pass mode: poll once and exit */
  once?: boolean;
  /** Detect tasks but do not execute or mutate state */
  dryRun?: boolean;
  /** Output raw JSON lines instead of pretty-print */
  json?: boolean;
  /**
   * Also start the capabilities HTTP server (ROADMAP 3b).
   * H1 can then call `hh capabilities fetch` to get this node's report.
   * If a string, it's treated as the port number. If true/present, uses
   * the gateway port from config (or falls back to 18790).
   */
  serveCapabilities?: boolean | string;
}

// ─── Executor ────────────────────────────────────────────────────────────────

/**
 * Run the configured executor command for a task.
 * Returns { output, success, tokens_used?, duration_ms? }
 */
async function runExecutor(
  execCmd: string,
  task: TaskState,
): Promise<{ output: string; success: boolean; error?: string; durationMs: number }> {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const [cmd, ...args] = execCmd.split(/\s+/);
    const child = spawn(cmd, args, {
      env: {
        ...process.env,
        HH_TASK_ID: task.id,
        HH_TASK_OBJECTIVE: task.objective,
        HH_TASK_FROM: task.from,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Suppress EPIPE on stdin — fast-exiting processes (e.g. `false`) may
    // close their stdin before we finish writing the task JSON.
    child.stdin.on("error", () => { /* suppress EPIPE */ });

    // Write task JSON to stdin
    child.stdin.write(JSON.stringify(task));
    child.stdin.end();

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    child.on("close", (code) => {
      const durationMs = Date.now() - start;
      if (code === 0) {
        resolve({ output: stdout.trim() || "(no output)", success: true, durationMs });
      } else {
        resolve({
          output: stdout.trim() || "(no output)",
          success: false,
          error: stderr.trim() || `Executor exited with code ${code}`,
          durationMs,
        });
      }
    });

    child.on("error", (err) => {
      // Spawn errors (ENOENT, EACCES) are infrastructure failures — reject so
      // the caller can revert the task to "pending" for retry rather than
      // marking it permanently "failed".
      reject(new Error(`Executor spawn error: ${err.message}`));
    });
  });
}

// ─── Single poll pass ─────────────────────────────────────────────────────────

async function poll(opts: WatchOptions): Promise<number> {
  const tasks = await listTaskStates();
  const pending = tasks.filter((t) => t.status === "pending");

  if (pending.length === 0) return 0;

  for (const task of pending) {
    const shortId = task.id.slice(0, 8);

    if (opts.json) {
      process.stdout.write(JSON.stringify({
        event: "task_detected",
        task_id: task.id,
        objective: task.objective,
        from: task.from,
        created_at: task.created_at,
      }) + "\n");
    } else {
      p.log.info(
        `${pc.yellow("⏳")} Pending task ${pc.dim(shortId)} from ${pc.bold(task.from)}: ${pc.italic(task.objective)}`,
      );
    }

    if (opts.dryRun) continue;

    if (!opts.exec) {
      // No executor: just surface the task and move on
      if (!opts.json) {
        p.log.warn(
          `  No --exec configured. Use ${pc.bold("hh result")} ${pc.dim(shortId)} to mark complete.`,
        );
      }
      continue;
    }

    // Mark as running before dispatching
    try {
      await updateTaskState(task.id, { status: "running" });
    } catch {
      // If we can't update state, skip (another process may have grabbed it)
      continue;
    }

    if (!opts.json) {
      p.log.step(`  Running executor for ${pc.dim(shortId)}…`);
    }

    try {
      const { output, success, error, durationMs } = await runExecutor(opts.exec, task);

      await updateTaskState(task.id, {
        status: success ? "completed" : "failed",
        result: {
          output,
          success,
          error,
          artifacts: [],
          duration_ms: durationMs,
        },
      });

      if (opts.json) {
        process.stdout.write(JSON.stringify({
          event: success ? "task_completed" : "task_failed",
          task_id: task.id,
          output,
          error,
          duration_ms: durationMs,
        }) + "\n");
      } else {
        const icon = success ? pc.green("✓") : pc.red("✗");
        const status = success ? pc.green("completed") : pc.red("failed");
        p.log.info(
          `  ${icon} Task ${pc.dim(shortId)} ${status} in ${(durationMs / 1000).toFixed(1)}s`,
        );
        if (!success && error) {
          p.log.warn(`     Error: ${error}`);
        }
      }
    } catch (err) {
      // Executor threw — revert to pending so we retry next poll
      try {
        await updateTaskState(task.id, { status: "pending" });
      } catch { /* ignore */ }
      if (!opts.json) {
        p.log.error(`  Executor threw: ${(err as Error).message}`);
      }
    }
  }

  return pending.length;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function watch(opts: WatchOptions): Promise<void> {
  const intervalSec = parseInt(opts.interval ?? "5", 10);
  const intervalMs = Math.max(1, intervalSec) * 1000;

  // ── Capabilities server (optional, --serve-capabilities) ──────────────────
  let capSrv: CapabilitiesServerHandle | null = null;
  if (opts.serveCapabilities !== undefined && opts.serveCapabilities !== false) {
    try {
      const cfg = await loadConfig();
      const token = cfg?.this_node?.gateway?.gateway_token ?? "";
      if (!token) {
        if (!opts.json) {
          p.log.warn(
            "Cannot start capabilities server — no gateway token in config. " +
            "Run `hh onboard` or set this_node.gateway.gateway_token.",
          );
        }
      } else {
        const capPort =
          typeof opts.serveCapabilities === "string"
            ? parseInt(opts.serveCapabilities, 10)
            : (cfg?.this_node?.gateway?.port ?? cfg?.gateway_port ?? 18790);
        capSrv = await startCapabilitiesServer({
          token,
          bindAddress: "0.0.0.0",
          port: capPort,
        });
        if (!opts.json) {
          p.log.success(
            `Capabilities server listening on ${pc.cyan(capSrv.url + "/capabilities")}`,
          );
        } else {
          process.stdout.write(
            JSON.stringify({ event: "capabilities_server_started", url: capSrv.url, port: capSrv.port }) + "\n",
          );
        }
      }
    } catch (err: unknown) {
      if (!opts.json) {
        p.log.warn(`Could not start capabilities server: ${(err as Error).message}`);
      }
    }
  }

  // ── Pretty header ──
  if (!opts.json) {
    p.intro(pc.bgYellow(pc.black(" hh watch ")));
    const modeLabel = opts.exec
      ? `executor: ${pc.cyan(opts.exec)}`
      : pc.dim("no executor (surface-only)");
    p.log.info(
      `Watching for pending tasks — poll every ${pc.bold(`${intervalSec}s`)}, ${modeLabel}`,
    );
    if (opts.dryRun) p.log.warn("Dry-run mode: tasks detected but not executed.");
    if (opts.once) p.log.info("Single-pass mode (--once): will exit after first poll.");
    p.log.info(pc.dim("Press Ctrl-C to stop.\n"));
  }

  // ── Graceful shutdown ──
  let running = true;
  const stop = async (signal: string) => {
    if (!opts.json) {
      process.stdout.write("\n");
      p.log.info(`Received ${signal}, shutting down…`);
    }
    running = false;
    if (capSrv) {
      try { await capSrv.close(); } catch { /* ignore */ }
      capSrv = null;
    }
  };
  process.on("SIGINT", () => void stop("SIGINT"));
  process.on("SIGTERM", () => void stop("SIGTERM"));

  // ── Poll loop ──
  let totalDispatched = 0;
  let passes = 0;

  while (running) {
    passes++;
    try {
      const dispatched = await poll(opts);
      totalDispatched += dispatched;

      if (!opts.json && dispatched === 0) {
        // Quiet idle tick (only shown at debug level in a real impl, but we keep it subtle)
        process.stdout.write(pc.dim("."));
      }
    } catch (err) {
      if (!opts.json) {
        p.log.error(`Poll error: ${(err as Error).message}`);
      }
    }

    if (opts.once) break;

    // Sleep between polls, checking for shutdown signal
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, intervalMs);
      // Allow early exit on signal
      const check = setInterval(() => {
        if (!running) { clearTimeout(t); clearInterval(check); resolve(); }
      }, 100);
      // Clean up on resolve
      void Promise.resolve().then(() => {
        setTimeout(() => clearInterval(check), intervalMs + 200);
      });
    });
  }

  // Ensure capabilities server is closed on normal loop exit (--once mode)
  if (capSrv) {
    try { await capSrv.close(); } catch { /* ignore */ }
  }

  if (!opts.json) {
    p.outro(
      `Stopped after ${passes} poll${passes !== 1 ? "s" : ""}, ` +
      `${totalDispatched} task${totalDispatched !== 1 ? "s" : ""} dispatched.`,
    );
  }
}
