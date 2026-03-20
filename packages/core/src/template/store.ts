/**
 * template/store.ts
 *
 * Persistent task template registry — ~/.cofounder/templates.json
 *
 * Templates are named task patterns with {variable} placeholders that you can
 * run on-demand without retyping the full task string each time.
 *
 * Example:
 *   cofounder template add summarize --task "Summarise this document: {text}"
 *   cofounder template run summarize --var text="my long document..."
 *
 * Variables use {varname} syntax. Positional shorthand {1}, {2}, ... is also
 * supported for quick invocations.  {*} expands to all positional args joined
 * by spaces.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

// ─── Schema ──────────────────────────────────────────────────────────────────

export const HHTemplateSchema = z.object({
  /** Unique identifier (UUID) */
  id: z.string().uuid(),
  /** Short name used on the CLI (e.g. "summarize", "code-review") */
  name: z.string().min(1),
  /**
   * Task string with optional {varname} / {1} / {*} placeholders.
   * Required variables are inferred from the placeholders at runtime.
   */
  task: z.string().min(1),
  /** Optional: pin to a specific peer node */
  peer: z.string().optional(),
  /** Optional: default timeout in seconds */
  timeout: z.number().int().positive().optional(),
  /** Optional: default notification webhook URL */
  notify_webhook: z.string().url().optional(),
  /** ISO 8601 creation timestamp */
  created_at: z.string().datetime(),
  /** Optional human-readable description */
  description: z.string().optional(),
});

export type HHTemplate = z.infer<typeof HHTemplateSchema>;

export const HHTemplateListSchema = z.array(HHTemplateSchema);

// ─── Paths ───────────────────────────────────────────────────────────────────

function getBaseDir(): string {
  return join(homedir(), ".cofounder");
}

function getTemplatesPath(): string {
  return join(getBaseDir(), "templates.json");
}

async function ensureBaseDir(): Promise<void> {
  await mkdir(getBaseDir(), { recursive: true });
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function loadTemplates(): Promise<HHTemplate[]> {
  const path = getTemplatesPath();
  if (!existsSync(path)) return [];
  try {
    const raw = await readFile(path, "utf8");
    return HHTemplateListSchema.parse(JSON.parse(raw));
  } catch {
    return [];
  }
}

export async function saveTemplates(templates: HHTemplate[]): Promise<void> {
  await ensureBaseDir();
  await writeFile(getTemplatesPath(), JSON.stringify(templates, null, 2), "utf8");
}

export interface AddTemplateInput {
  name: string;
  task: string;
  peer?: string;
  timeout?: number;
  notify_webhook?: string;
  description?: string;
}

export async function addTemplate(input: AddTemplateInput): Promise<HHTemplate> {
  const templates = await loadTemplates();

  // Reject duplicate names (case-insensitive)
  const existingName = templates.find((t) => t.name.toLowerCase() === input.name.toLowerCase());
  if (existingName) {
    throw new Error(`Template "${input.name}" already exists (id: ${existingName.id.slice(0, 8)}). Use a different name or remove the existing one first.`);
  }

  const template: HHTemplate = {
    id: randomUUID(),
    name: input.name,
    task: input.task,
    peer: input.peer,
    timeout: input.timeout,
    notify_webhook: input.notify_webhook,
    description: input.description,
    created_at: new Date().toISOString(),
  };

  templates.push(template);
  await saveTemplates(templates);
  return template;
}

export async function removeTemplate(nameOrId: string): Promise<HHTemplate | null> {
  const templates = await loadTemplates();
  const idx = templates.findIndex(
    (t) =>
      t.name.toLowerCase() === nameOrId.toLowerCase() ||
      t.id === nameOrId ||
      t.id.startsWith(nameOrId),
  );
  if (idx === -1) return null;
  const [removed] = templates.splice(idx, 1);
  await saveTemplates(templates);
  return removed;
}

export async function findTemplate(nameOrId: string): Promise<HHTemplate | null> {
  const templates = await loadTemplates();
  return (
    templates.find(
      (t) =>
        t.name.toLowerCase() === nameOrId.toLowerCase() ||
        t.id === nameOrId ||
        t.id.startsWith(nameOrId),
    ) ?? null
  );
}

// ─── Variable substitution ───────────────────────────────────────────────────

export interface SubstituteOptions {
  /** Named variables: { text: "hello", lang: "en" } */
  vars?: Record<string, string>;
  /** Positional args for {1}, {2}, … and {*} */
  args?: string[];
}

/**
 * Extract all variable names referenced in a template task string.
 * Returns both named vars ({varname}) and positional indexes ({1}, {2}, {*}).
 */
export function extractPlaceholders(task: string): {
  named: string[];
  positional: number[];
  hasSplat: boolean;
} {
  const named: string[] = [];
  const positional: number[] = [];
  let hasSplat = false;

  for (const match of task.matchAll(/\{([^}]+)\}/g)) {
    const key = match[1].trim();
    if (key === "*") {
      hasSplat = true;
    } else if (/^\d+$/.test(key)) {
      const n = parseInt(key, 10);
      if (!positional.includes(n)) positional.push(n);
    } else if (!named.includes(key)) {
      named.push(key);
    }
  }

  positional.sort((a, b) => a - b);
  return { named, positional, hasSplat };
}

/**
 * Substitute {varname}, {1}, {2}, {*} placeholders in a task string.
 * Throws if a named variable is referenced but not provided.
 */
export function substituteVars(task: string, opts: SubstituteOptions = {}): string {
  const { vars = {}, args = [] } = opts;

  let result = task;

  // Named vars
  for (const match of Array.from(task.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g))) {
    const key = match[1];
    if (!(key in vars)) {
      throw new Error(`Template variable "{${key}}" not provided. Pass it with --var ${key}="value"`);
    }
    result = result.replaceAll(`{${key}}`, vars[key]);
  }

  // Positional {*} — all args joined
  if (args.length > 0) {
    result = result.replaceAll("{*}", args.join(" "));
  }

  // Positional {N} — 1-indexed
  for (let i = 1; i <= args.length; i++) {
    result = result.replaceAll(`{${i}}`, args[i - 1]);
  }

  return result;
}
