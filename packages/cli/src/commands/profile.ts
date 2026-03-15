/**
 * commands/profile.ts — `hh profile`
 *
 * Named config profiles for switching between multiple setups.
 *
 * Usage:
 *   hh profile list                      → list all profiles, mark active
 *   hh profile use <name>                → switch active profile
 *   hh profile create <name>             → create new blank profile
 *   hh profile create <name> --from existing → copy from existing profile
 *   hh profile show [<name>]             → print profile config (mask tokens)
 *   hh profile delete <name>             → delete profile (refuse if active)
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { HHConfig } from "../config/schema.ts";
import { getActiveProfileName, setActiveProfile } from "../config/store.ts";

const PROFILES_DIR = join(homedir(), ".his-and-hers", "profiles");

export interface ProfileListOptions {
  json?: boolean;
}

export interface ProfileCreateOptions {
  from?: string;
}

export interface ProfileShowOptions {
  json?: boolean;
}

export interface ProfileDeleteOptions {
  force?: boolean;
}

/**
 * List all profiles, mark active with star symbol.
 */
export async function profileList(opts: ProfileListOptions = {}) {
  try {
    await mkdir(PROFILES_DIR, { recursive: true });
    const files = await readdir(PROFILES_DIR);
    const profiles = files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));

    const activeProfile = await getActiveProfileName();

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            profiles,
            active: activeProfile,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (profiles.length === 0) {
      p.intro(pc.bgMagenta(pc.white(" hh profile list ")));
      p.log.info("No profiles found.");
      p.log.info(`Create one with: ${pc.cyan("hh profile create <name>")}`);
      p.outro("Done.");
      return;
    }

    p.intro(pc.bgMagenta(pc.white(" hh profile list ")));

    for (const name of profiles.sort()) {
      const marker = name === activeProfile ? pc.green("★") : pc.dim(" ");
      const display = name === activeProfile ? pc.green(name) : pc.dim(name);
      p.log.info(`${marker} ${display}`);
    }

    p.log.message("");
    p.log.info(`Active: ${pc.cyan(activeProfile)}`);
    p.outro("Done.");
  } catch (err) {
    p.log.error(`Failed to list profiles: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Switch active profile.
 */
export async function profileUse(name: string) {
  try {
    // Check if profile exists
    const profilePath = join(PROFILES_DIR, `${name}.json`);
    try {
      await readFile(profilePath, "utf-8");
    } catch {
      p.log.error(`Profile ${pc.cyan(name)} not found.`);
      p.log.info(`Available profiles: run ${pc.cyan("hh profile list")}`);
      process.exit(1);
    }

    await setActiveProfile(name);

    p.intro(pc.bgMagenta(pc.white(" hh profile use ")));
    p.log.success(`Switched to profile ${pc.cyan(name)}`);
    p.outro("Done.");
  } catch (err) {
    p.log.error(`Failed to switch profile: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Create a new profile (blank or copied from existing).
 */
export async function profileCreate(name: string, opts: ProfileCreateOptions = {}) {
  try {
    await mkdir(PROFILES_DIR, { recursive: true });

    const profilePath = join(PROFILES_DIR, `${name}.json`);

    let config: HHConfig;

    if (opts.from) {
      // Copy from existing profile
      const sourcePath = join(PROFILES_DIR, `${opts.from}.json`);
      try {
        const raw = await readFile(sourcePath, "utf-8");
        config = HHConfig.parse(JSON.parse(raw));
      } catch {
        p.log.error(`Source profile ${pc.cyan(opts.from)} not found.`);
        process.exit(1);
      }
    } else {
      // Create blank profile with minimal structure
      config = {
        version: "0.1.0",
        this_node: {
          role: "h1",
          name: "new-node",
          tailscale_hostname: "",
          tailscale_ip: "",
        },
        peer_node: {
          role: "h2",
          name: "peer-node",
          tailscale_hostname: "",
          tailscale_ip: "",
          ssh_user: "",
          ssh_key_path: "",
          os: "linux",
          gateway_port: 18789,
        },
        gateway_port: 18789,
      } as HHConfig;
    }

    await writeFile(profilePath, JSON.stringify(config, null, 2), { mode: 0o600 });

    p.intro(pc.bgMagenta(pc.white(" hh profile create ")));
    p.log.success(`Created profile ${pc.cyan(name)}`);
    if (opts.from) {
      p.log.info(`Copied from: ${pc.dim(opts.from)}`);
    }
    p.log.info(`Path: ${pc.dim(profilePath)}`);
    p.log.message("");
    p.log.info(`Switch to it with: ${pc.cyan(`hh profile use ${name}`)}`);
    p.outro("Done.");
  } catch (err) {
    p.log.error(`Failed to create profile: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Show profile config (active or named), mask gateway tokens.
 */
export async function profileShow(name?: string, opts: ProfileShowOptions = {}) {
  try {
    const profileName = name ?? (await getActiveProfileName());
    const profilePath = join(PROFILES_DIR, `${profileName}.json`);

    let config: HHConfig;
    try {
      const raw = await readFile(profilePath, "utf-8");
      config = HHConfig.parse(JSON.parse(raw));
    } catch {
      p.log.error(`Profile ${pc.cyan(profileName)} not found.`);
      process.exit(1);
    }

    // Mask gateway tokens
    const masked = maskGatewayTokens(config);

    if (opts.json) {
      console.log(JSON.stringify(masked, null, 2));
      return;
    }

    p.intro(pc.bgMagenta(pc.white(` hh profile show — ${profileName} `)));
    p.log.info(JSON.stringify(masked, null, 2));
    p.outro("Done.");
  } catch (err) {
    p.log.error(`Failed to show profile: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Delete a profile (refuse if active).
 */
export async function profileDelete(name: string, opts: ProfileDeleteOptions = {}) {
  try {
    const activeProfile = await getActiveProfileName();

    if (name === activeProfile && !opts.force) {
      p.log.error(`Cannot delete active profile ${pc.cyan(name)}`);
      p.log.info(`Switch to another profile first, or use ${pc.cyan("--force")}`);
      process.exit(1);
    }

    const profilePath = join(PROFILES_DIR, `${name}.json`);

    try {
      await unlink(profilePath);
    } catch {
      p.log.error(`Profile ${pc.cyan(name)} not found.`);
      process.exit(1);
    }

    p.intro(pc.bgMagenta(pc.white(" hh profile delete ")));
    p.log.success(`Deleted profile ${pc.cyan(name)}`);
    p.outro("Done.");
  } catch (err) {
    p.log.error(`Failed to delete profile: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function maskGatewayTokens(config: HHConfig): HHConfig {
  return {
    ...config,
    peer_node: {
      ...config.peer_node,
      gateway_token: config.peer_node.gateway_token ? "***MASKED***" : undefined,
    },
    peer_nodes: config.peer_nodes?.map((p) => ({
      ...p,
      gateway_token: p.gateway_token ? "***MASKED***" : undefined,
    })),
  };
}
