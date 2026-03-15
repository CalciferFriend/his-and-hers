/**
 * core/alias/store.ts — persistent registry for user-defined CLI aliases
 *
 * Aliases map a short name to any `hh` subcommand string:
 *   pr-review → "workflow run code-review --peer glados"
 *
 * Stored in ~/.his-and-hers/aliases.json
 *
 * Phase 8c — Calcifer ✅ (2026-03-15)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

// ─── Schema ───────────────────────────────────────────────────────────────────

const ALIAS_NAME_RE = /^[a-zA-Z0-9_-]+$/;

export const HHAliasSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(ALIAS_NAME_RE, "Alias name must match [a-zA-Z0-9_-]+"),
  command: z.string().min(1, "Command cannot be empty"),
  desc: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type HHAlias = z.infer<typeof HHAliasSchema>;

export interface AddAliasInput {
  name: string;
  command: string;
  desc?: string;
}

// ─── Storage path ─────────────────────────────────────────────────────────────

function aliasesPath(): string {
  const dir = join(homedir(), ".his-and-hers");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "aliases.json");
}

// ─── Load / save ─────────────────────────────────────────────────────────────

export function loadAliases(): HHAlias[] {
  const p = aliasesPath();
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, "utf8"));
    if (!Array.isArray(raw)) return [];
    return raw.map((r) => HHAliasSchema.parse(r));
  } catch {
    return [];
  }
}

export function saveAliases(aliases: HHAlias[]): void {
  writeFileSync(aliasesPath(), JSON.stringify(aliases, null, 2) + "\n", "utf8");
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/** Add or update an alias. Returns the saved alias. */
export function addAlias(input: AddAliasInput): HHAlias {
  if (!ALIAS_NAME_RE.test(input.name)) {
    throw new Error(`Invalid alias name "${input.name}". Must match [a-zA-Z0-9_-]+`);
  }
  if (!input.command.trim()) {
    throw new Error("Command cannot be empty");
  }

  const aliases = loadAliases();
  const now = new Date().toISOString();
  const existing = aliases.findIndex((a) => a.name === input.name);

  const entry: HHAlias = {
    name: input.name,
    command: input.command.trim(),
    desc: input.desc,
    created_at: existing >= 0 ? aliases[existing].created_at : now,
    updated_at: now,
  };

  if (existing >= 0) {
    aliases[existing] = entry;
  } else {
    aliases.push(entry);
  }

  saveAliases(aliases);
  return entry;
}

/** Remove an alias by name. Returns true if removed, false if not found. */
export function removeAlias(name: string): boolean {
  const aliases = loadAliases();
  const idx = aliases.findIndex((a) => a.name === name);
  if (idx < 0) return false;
  aliases.splice(idx, 1);
  saveAliases(aliases);
  return true;
}

/** Find an alias by exact name. Returns undefined if not found. */
export function findAlias(name: string): HHAlias | undefined {
  return loadAliases().find((a) => a.name === name);
}
