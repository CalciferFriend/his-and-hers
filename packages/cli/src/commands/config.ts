/**
 * commands/config.ts — `hh config` subcommand
 *
 * Subcommands:
 *   hh config show          — pretty-print config, redact secrets
 *   hh config get <key>     — read a single key (dot-notation)
 *   hh config set <key> <value> — write a key with auto type coercion
 *   hh config path          — print config file path (machine-readable)
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { loadConfig, saveConfig, patchConfig, getConfigPath } from "../config/store.ts";
import type { TJConfig } from "../config/schema.ts";

// ─── Sensitive field detection ────────────────────────────────────────────────

const SENSITIVE_PATTERNS = ["token", "key", "secret", "password", "credential"];

function isSensitiveField(fieldName: string): boolean {
  const lower = fieldName.toLowerCase();
  return SENSITIVE_PATTERNS.some((p) => lower.includes(p));
}

function redactSensitive(obj: unknown, depth = 0): unknown {
  if (depth > 10) return obj;
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitive(item, depth + 1));
  }
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (isSensitiveField(k) && typeof v === "string" && v.length > 0) {
      result[k] = pc.dim("[redacted]");
    } else {
      result[k] = redactSensitive(v, depth + 1);
    }
  }
  return result;
}

// ─── Value coercion ───────────────────────────────────────────────────────────

/**
 * Coerce a string value to its inferred type.
 * "true"/"false" → boolean, numeric strings → number,
 * valid JSON → parsed object/array, else string.
 */
export function coerceValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  const num = Number(raw);
  if (raw.trim() !== "" && !Number.isNaN(num)) return num;
  // Try JSON parse for objects/arrays
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through to string
    }
  }
  return raw;
}

// ─── Dot-notation helpers ─────────────────────────────────────────────────────

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const parts = path.split(".");
  if (parts.length === 1) {
    return { ...obj, [path]: value };
  }
  const [head, ...rest] = parts;
  const existing = (obj[head] ?? {}) as Record<string, unknown>;
  return {
    ...obj,
    [head]: setNestedValue(existing, rest.join("."), value),
  };
}

// ─── Command handlers ─────────────────────────────────────────────────────────

export async function configShow() {
  const configPath = getConfigPath();
  const config = await loadConfig();

  if (!config) {
    p.log.error(
      `No config found at ${pc.cyan(configPath)}. Run ${pc.bold("hh onboard")} to set up.`,
    );
    return;
  }

  p.intro(`${pc.bold("HH Configuration")} — ${pc.dim(configPath)}`);

  const redacted = redactSensitive(config as unknown as Record<string, unknown>);
  const formatted = JSON.stringify(redacted, null, 2);

  // Colorize the JSON output
  const colorized = formatted
    .split("\n")
    .map((line) => {
      // Keys
      const keyMatch = line.match(/^(\s*)"([^"]+)":/);
      if (keyMatch) {
        return line.replace(`"${keyMatch[2]}":`, pc.cyan(`"${keyMatch[2]}"`) + ":");
      }
      // Redacted markers
      if (line.includes("[redacted]")) {
        return line.replace(/"?\[redacted\]"?/, pc.yellow("[redacted]"));
      }
      return line;
    })
    .join("\n");

  console.log(colorized);
  p.outro(pc.dim("Secrets are redacted above. Keys live in the OS keychain."));
}

export async function configGet(key: string) {
  const config = await loadConfig();

  if (!config) {
    p.log.error(`No config found. Run ${pc.bold("hh onboard")} first.`);
    process.exit(1);
  }

  const value = getNestedValue(config as unknown as Record<string, unknown>, key);

  if (value === undefined) {
    p.log.error(`Key ${pc.cyan(key)} not found in config.`);
    process.exit(1);
  }

  if (typeof value === "object" && value !== null) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(String(value));
  }
}

export async function configSet(key: string, value: string) {
  const config = await loadConfig();

  if (!config) {
    p.log.error(`No config found. Run ${pc.bold("hh onboard")} first.`);
    process.exit(1);
  }

  const coerced = coerceValue(value);
  const parts = key.split(".");

  if (parts.length === 1) {
    // Top-level key — use patchConfig
    try {
      await patchConfig({ [key]: coerced } as Partial<TJConfig>);
    } catch (err) {
      p.log.error(`Failed to set ${pc.cyan(key)}: ${String(err)}`);
      process.exit(1);
    }
  } else {
    // Nested key — merge manually then saveConfig
    const updated = setNestedValue(
      config as unknown as Record<string, unknown>,
      key,
      coerced,
    );
    try {
      await saveConfig(updated as unknown as TJConfig);
    } catch (err) {
      p.log.error(`Failed to set ${pc.cyan(key)}: ${String(err)}`);
      process.exit(1);
    }
  }

  const displayValue =
    typeof coerced === "object"
      ? JSON.stringify(coerced)
      : String(coerced);

  p.log.info(
    `${pc.green("✓")} Set ${pc.cyan(key)} = ${pc.bold(displayValue)}`,
  );
}

export async function configPath() {
  console.log(getConfigPath());
}
