import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { TJConfig, type ProviderConfig } from "./schema.ts";

const CONFIG_DIR = join(homedir(), ".his-and-hers");
const CONFIG_PATH = join(CONFIG_DIR, "tj.json");

/**
 * Load config from ~/.his-and-hers/tj.json
 * Returns null if not found or invalid.
 */
export async function loadConfig(): Promise<TJConfig | null> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    return TJConfig.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Save config to ~/.his-and-hers/tj.json with restrictive permissions (0600).
 * Never writes API keys — those stay in the OS keychain.
 */
export async function saveConfig(config: TJConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  // Strip runtime secrets before writing
  const safe = stripRuntimeSecrets(config);
  await writeFile(CONFIG_PATH, JSON.stringify(safe, null, 2), {
    mode: 0o600,
  });
}

/**
 * Patch an existing config with partial updates and save.
 * Merges top-level keys; use for incremental wizard step writes.
 */
export async function patchConfig(patch: Partial<TJConfig>): Promise<TJConfig> {
  const existing = await loadConfig();
  if (!existing) throw new Error("No config found — run tj onboard first");
  const merged = TJConfig.parse({ ...existing, ...patch });
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
function stripRuntimeSecrets(config: TJConfig): TJConfig {
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
