/**
 * commands/alias.ts — `cofounder alias` user-defined CLI shortcuts
 *
 * Aliases map a short name to any `cofounder` subcommand string, persisted in
 * ~/.cofounder/aliases.json. Running `cofounder alias run <name>` (or simply
 * `cofounder <name>` via the fallback handler in index.ts) expands the alias and
 * re-invokes the CLI with the stored command.
 *
 * Usage:
 *   cofounder alias add <name> "<command>" [--desc "..."]
 *   cofounder alias list [--json]
 *   cofounder alias show <name> [--json]
 *   cofounder alias remove <name> [--force]
 *   cofounder alias run <name> [args...]
 *
 * Example:
 *   cofounder alias add pr-review "workflow run code-review --peer glados"
 *   cofounder alias run pr-review
 *   cofounder alias list
 *
 * Phase 8c — Calcifer ✅ (2026-03-15)
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { spawnSync } from "node:child_process";
import { loadAliases, addAlias, removeAlias, findAlias } from "@cofounder/core";
import type { HHAlias } from "@cofounder/core";

// ─── alias add ────────────────────────────────────────────────────────────────

export async function aliasAdd(
  name: string,
  command: string,
  opts: { desc?: string },
): Promise<void> {
  try {
    const existing = findAlias(name);
    const entry = addAlias({ name, command, desc: opts.desc });

    if (existing) {
      p.log.success(
        `${pc.bold(name)} updated → ${pc.cyan(entry.command)}`,
      );
    } else {
      p.log.success(
        `Alias ${pc.bold(name)} saved → ${pc.cyan(entry.command)}`,
      );
    }
  } catch (err: any) {
    console.error(pc.red(`Error: ${err.message}`));
    process.exitCode = 1;
  }
}

// ─── alias list ───────────────────────────────────────────────────────────────

export function aliasList(opts: { json?: boolean }): void {
  const aliases = loadAliases();

  if (opts.json) {
    console.log(JSON.stringify(aliases, null, 2));
    return;
  }

  if (aliases.length === 0) {
    p.log.info("No aliases defined. Use `cofounder alias add <name> \"<command>\"` to create one.");
    return;
  }

  console.log(pc.bold(`\n  Aliases (${aliases.length})\n`));
  for (const a of aliases) {
    const desc = a.desc ? pc.dim(`  — ${a.desc}`) : "";
    console.log(`  ${pc.bold(pc.cyan(a.name.padEnd(20)))} ${a.command}${desc}`);
  }
  console.log();
}

// ─── alias show ───────────────────────────────────────────────────────────────

export function aliasShow(name: string, opts: { json?: boolean }): void {
  const a = findAlias(name);
  if (!a) {
    console.error(pc.red(`Alias "${name}" not found.`));
    process.exitCode = 1;
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify(a, null, 2));
    return;
  }

  console.log(pc.bold(`\n  Alias: ${pc.cyan(a.name)}\n`));
  console.log(`  Command:    ${a.command}`);
  if (a.desc) console.log(`  Desc:       ${a.desc}`);
  console.log(`  Created:    ${new Date(a.created_at).toLocaleString()}`);
  console.log(`  Updated:    ${new Date(a.updated_at).toLocaleString()}`);
  console.log();
}

// ─── alias remove ─────────────────────────────────────────────────────────────

export async function aliasRemove(
  name: string,
  opts: { force?: boolean; json?: boolean },
): Promise<void> {
  const a = findAlias(name);
  if (!a) {
    if (opts.json) {
      console.log(JSON.stringify({ removed: false, name }));
    } else {
      console.error(pc.red(`Alias "${name}" not found.`));
    }
    process.exitCode = 1;
    return;
  }

  if (!opts.force) {
    const confirmed = await p.confirm({
      message: `Remove alias ${pc.bold(name)} → "${a.command}"?`,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      p.log.info("Aborted.");
      return;
    }
  }

  removeAlias(name);

  if (opts.json) {
    console.log(JSON.stringify({ removed: true, name }));
  } else {
    p.log.success(`Alias ${pc.bold(name)} removed.`);
  }
}

// ─── alias run ────────────────────────────────────────────────────────────────

/**
 * Expand an alias and execute it by re-invoking the `cofounder` CLI.
 * Extra args are appended after the alias expansion.
 *
 * e.g.  cofounder alias run pr-review --json
 *       expands to: cofounder workflow run code-review --peer glados --json
 */
export function aliasRun(name: string, extraArgs: string[]): void {
  const a = findAlias(name);
  if (!a) {
    console.error(pc.red(`Alias "${name}" not found.`));
    console.error(pc.dim(`  Run \`cofounder alias list\` to see available aliases.`));
    process.exitCode = 1;
    return;
  }

  // Split stored command into argv tokens (simple shell-like split; no quoting needed
  // since we store already-expanded strings)
  const storedTokens = a.command.split(/\s+/).filter(Boolean);
  const argv = [...storedTokens, ...extraArgs];

  console.log(pc.dim(`  → cofounder ${argv.join(" ")}`));

  // Re-invoke cofounder with the expanded command
  const hhBin = process.argv[1]; // path to the cofounder CLI entry point
  const result = spawnSync(process.execPath, [hhBin, ...argv], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== null) {
    process.exitCode = result.status;
  }
}

// ─── Helpers (exported for index.ts fallback) ─────────────────────────────────

/**
 * Try to resolve `argv[0]` as an alias. Returns true if dispatched.
 * Used by index.ts as a last-resort handler for unknown commands.
 */
export function tryRunAlias(name: string, extraArgs: string[]): boolean {
  const a = findAlias(name);
  if (!a) return false;
  aliasRun(name, extraArgs);
  return true;
}
