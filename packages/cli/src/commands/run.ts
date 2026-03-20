/**
 * commands/run.ts — `cofounder run` ergonomic task shorthands
 *
 * A thin dispatch layer for the most common one-shot task patterns.
 * Each subcommand builds a task prompt + options and delegates to `cofounder send`.
 *
 * Usage:
 *   cofounder run summarise <path> [--peer <name>] [--wait] [--json]
 *   cofounder run review <path>    [--peer <name>] [--wait] [--json]
 *   cofounder run diff [<base> [<head>]] [--peer <name>] [--wait] [--json]
 *   cofounder run alias <name> [args...] (runs a user-defined alias — see `cofounder alias`)
 *
 * Phase 8b — Calcifer ✅ (2026-03-15)
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { execSync } from "node:child_process";
import { send } from "./send.ts";
import { loadConfig } from "@cofounder/core";
import { routeTask, loadCapabilities } from "@cofounder/core";

// ─── Shared run options ───────────────────────────────────────────────────────

export interface RunCommonOpts {
  peer?: string;
  wait?: boolean;
  json?: boolean;
  notify?: string;
}

// ─── run summarise ────────────────────────────────────────────────────────────

/**
 * Summarise the contents of a file.
 * The file is attached so H2 can see the full content.
 *
 * @example
 *   cofounder run summarise ./meeting-notes.md
 *   cofounder run summarise ./report.pdf --peer glados --wait
 */
export async function runSummarise(
  filePath: string,
  opts: RunCommonOpts & { prompt?: string },
) {
  const abs = resolve(filePath);
  if (!existsSync(abs)) {
    console.error(pc.red(`File not found: ${abs}`));
    process.exitCode = 1;
    return;
  }

  const name = basename(abs);
  const task = opts.prompt
    ? opts.prompt
    : `Please summarise the attached file "${name}". Provide a concise executive summary (3–5 sentences), then a bullet-point breakdown of the key points.`;

  await send(task, {
    peer: opts.peer,
    auto: !opts.peer,
    wait: opts.wait,
    attach: [abs],
    notify: opts.notify,
  });
}

// ─── run review ───────────────────────────────────────────────────────────────

/**
 * Code-review a file or directory.
 * Text/code files are attached; H2 responds with structured review feedback.
 *
 * @example
 *   cofounder run review ./src/commands/send.ts
 *   cofounder run review ./packages/core/src --peer glados --wait
 */
export async function runReview(
  filePath: string,
  opts: RunCommonOpts & { prompt?: string },
) {
  const abs = resolve(filePath);
  if (!existsSync(abs)) {
    console.error(pc.red(`File not found: ${abs}`));
    process.exitCode = 1;
    return;
  }

  const name = basename(abs);
  const task = opts.prompt
    ? opts.prompt
    : `Please review the attached code in "${name}". Cover: (1) correctness and edge cases, (2) readability and naming, (3) performance concerns, (4) missing tests or error handling. Be specific — include file/line references where relevant. End with a brief verdict: approve, approve-with-nits, or request-changes.`;

  await send(task, {
    peer: opts.peer,
    auto: !opts.peer,
    wait: opts.wait,
    attach: [abs],
    notify: opts.notify,
  });
}

// ─── run diff ─────────────────────────────────────────────────────────────────

/**
 * Review a git diff. Defaults to `git diff HEAD` (staged + unstaged changes).
 * Pass a base ref and optional head ref for historical diffs.
 *
 * The diff is embedded directly in the task text (no file attachment needed).
 *
 * @example
 *   cofounder run diff                          # git diff HEAD
 *   cofounder run diff main                     # git diff main
 *   cofounder run diff main feature/my-branch   # git diff main..feature/my-branch
 *   cofounder run diff HEAD~3 HEAD --peer glados --wait
 */
export async function runDiff(
  opts: RunCommonOpts & {
    base?: string;
    head?: string;
    prompt?: string;
    stat?: boolean;
  },
) {
  // Build git diff command
  let diffCmd: string;
  if (opts.base && opts.head) {
    diffCmd = `git diff ${opts.base}..${opts.head}`;
  } else if (opts.base) {
    diffCmd = `git diff ${opts.base}`;
  } else {
    diffCmd = "git diff HEAD";
  }

  let diffOutput: string;
  try {
    diffOutput = execSync(diffCmd, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  } catch (err: any) {
    // If exit code is non-zero, diff might still have output (e.g. no repo)
    if (err.stdout) {
      diffOutput = err.stdout as string;
    } else {
      console.error(pc.red(`git diff failed: ${err.message}`));
      process.exitCode = 1;
      return;
    }
  }

  if (!diffOutput.trim()) {
    console.log(pc.dim("No changes to review (diff is empty)."));
    return;
  }

  // Optionally show stat first
  if (opts.stat) {
    try {
      const statCmd = diffCmd.replace("git diff", "git diff --stat");
      const stat = execSync(statCmd, { encoding: "utf8" });
      console.log(pc.bold("\nDiff stat:"));
      console.log(pc.dim(stat));
    } catch {
      // best-effort
    }
  }

  const rangeDesc = opts.base && opts.head
    ? `${opts.base}..${opts.head}`
    : opts.base
    ? `${opts.base}`
    : "HEAD (working tree)";

  const diffLines = diffOutput.split("\n").length;
  const task = opts.prompt
    ? `${opts.prompt}\n\n\`\`\`diff\n${diffOutput}\n\`\`\``
    : `Please review the following git diff (${rangeDesc}, ${diffLines} lines). Cover: (1) correctness and logic errors, (2) naming and readability, (3) missing error handling or edge cases, (4) test coverage for changed code. Be specific — reference file/line context from the diff. End with a verdict: approve, approve-with-nits, or request-changes.\n\n\`\`\`diff\n${diffOutput}\n\`\`\``;

  await send(task, {
    peer: opts.peer,
    auto: !opts.peer,
    wait: opts.wait,
    notify: opts.notify,
  });
}
