import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { HHConfig, type ProviderConfig } from "./schema.ts";

const CONFIG_DIR = join(homedir(), ".his-and-hers");
const CONFIG_PATH = join(CONFIG_DIR, "hh.json");
const PROFILES_DIR = join(CONFIG_DIR, "profiles");
const ACTIVE_PROFILE_PATH = join(CONFIG_DIR, "active-profile.json");

/**
 * Get the active profile name.
 * Priority:
 * 1. HH_PROFILE env var
 * 2. ~/.his-and-hers/active-profile.json
 * 3. "default" (for backward compat with ~/.his-and-hers/config.json)
 */
export async function getActiveProfileName(): Promise<string> {
  // Check env var first
  if (process.env.HH_PROFILE) {
    return process.env.HH_PROFILE;
  }

  // Check active-profile.json
  try {
    const raw = await readFile(ACTIVE_PROFILE_PATH, "utf-8");
    const data = JSON.parse(raw);
    if (data.active && typeof data.active === "string") {
      return data.active;
    }
  } catch {
    // Fall through
  }

  // Default to "default" for backward compat
  return "default";
}

/**
 * Set the active profile name by writing to active-profile.json.
 */
export async function setActiveProfile(name: string): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(ACTIVE_PROFILE_PATH, JSON.stringify({ active: name }, null, 2));
}

/**
 * Load config from the active profile.
 * Priority:
 * 1. HH_PROFILE env var → ~/.his-and-hers/profiles/<name>.json
 * 2. active-profile.json → ~/.his-and-hers/profiles/<name>.json
 * 3. Backward compat: ~/.his-and-hers/hh.json (treated as "default" profile)
 */
export async function loadConfig(): Promise<HHConfig | null> {
  const profileName = await getActiveProfileName();

  // Try profile directory first
  const profilePath = join(PROFILES_DIR, `${profileName}.json`);
  try {
    const raw = await readFile(profilePath, "utf-8");
    return HHConfig.parse(JSON.parse(raw));
  } catch {
    // Fall through
  }

  // Backward compat: if profile is "default" and profiles/<default>.json doesn't exist,
  // try ~/.his-and-hers/hh.json
  if (profileName === "default") {
    try {
      const raw = await readFile(CONFIG_PATH, "utf-8");
      return HHConfig.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Save config to the active profile.
 * Writes to ~/.his-and-hers/profiles/<profile>.json.
 * For backward compat, if profile is "default" and profiles/<default>.json doesn't exist,
 * writes to ~/.his-and-hers/hh.json.
 */
export async function saveConfig(config: HHConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await mkdir(PROFILES_DIR, { recursive: true });

  const profileName = await getActiveProfileName();
  const profilePath = join(PROFILES_DIR, `${profileName}.json`);

  // Strip runtime secrets before writing
  const safe = stripRuntimeSecrets(config);

  await writeFile(profilePath, JSON.stringify(safe, null, 2), {
    mode: 0o600,
  });

  // Also write to hh.json for backward compat if profile is "default"
  if (profileName === "default") {
    await writeFile(CONFIG_PATH, JSON.stringify(safe, null, 2), {
      mode: 0o600,
    });
  }
}

/**
 * Patch an existing config with partial updates and save.
 * Merges top-level keys; use for incremental wizard step writes.
 */
export async function patchConfig(patch: Partial<HHConfig>): Promise<HHConfig> {
  const existing = await loadConfig();
  if (!existing) throw new Error("No config found — run hh onboard first");
  const merged = HHConfig.parse({ ...existing, ...patch });
  await saveConfig(merged);
  return merged;
}

/**
 * Persist provider selection for this node.
 * Called at end of provider wizard step.
 */
export async function saveProviderConfig(provider: ProviderConfig): Promise<void> {
  const existing = await loadConfig();
  if (!existing) throw new Error("No config found");
  await saveConfig({
    ...existing,
    this_node: { ...existing.this_node, provider },
  });
}

/**
 * Get the config path for display purposes.
 */
export function getConfigPath(): string {
  return CONFIG_PATH;
}

/**
 * Remove runtime-only secrets before writing to disk.
 * API keys live in the OS keychain; gateway tokens are loaded at runtime.
 */
function stripRuntimeSecrets(config: HHConfig): HHConfig {
  return {
    ...config,
    peer_node: {
      ...config.peer_node,
      gateway_token: undefined,
    },
    peer_nodes: config.peer_nodes?.map((p) => ({
      ...p,
      gateway_token: undefined,
    })),
  };
}
