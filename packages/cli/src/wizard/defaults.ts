/**
 * defaults.ts - Sane defaults for --yes fast onboarding
 *
 * When user runs `hh onboard --yes`, skip interactive prompts
 * and use these defaults to get them up and running in <2 minutes.
 */

import { hostname } from "node:os";
import type { WizardContext } from "./context.ts";
import type { NodeRole } from "../config/schema.ts";

export interface FastOnboardOptions {
  role?: NodeRole;
  name?: string;
  model?: string;
  peer?: string;
}

/**
 * Generate default wizard context for fast onboarding.
 * User can override via CLI flags: --role=h1 --name=Alice --model=sonnet
 */
export function createDefaultContext(opts: FastOnboardOptions = {}): Partial<WizardContext> {
  const role = opts.role; // Required - must be provided
  const name = opts.name || hostname().split(".")[0]; // Default to system hostname
  const emoji = role === "h1" ? "🔥" : role === "h2" ? "⚡" : "🤖";
  const persona = role === "h1"
    ? "Orchestrator. Always on. Delegates work."
    : "Executor. Sleeps when idle. Does heavy lifting.";

  return {
    // Identity defaults
    role,
    name,
    emoji,
    persona,

    // Provider defaults (most common: Anthropic)
    provider: "anthropic",
    providerConfig: {
      apiKey: "", // Will be prompted if not in keychain
      model: opts.model || "claude-sonnet-4.5",
      maxTokens: 8000,
    },

    // Gateway bind defaults (smart defaults based on role)
    thisBindMode: role === "h1" ? "loopback" : "tailscale",
    peerBindMode: role === "h1" ? "tailscale" : "loopback",
    peerGatewayPort: 18789,

    // WOL defaults (skip for now, can configure later)
    wolEnabled: false,
    wolTimeoutSeconds: 120,
    wolPollIntervalSeconds: 2,

    // Peer connection defaults (skip initial config - pair later with code)
    peerTailscaleHostname: opts.peer || "",
    peerTailscaleIP: "",
    peerSSHUser: "",
    peerSSHKeyPath: "",
    peerOS: "linux",

    // Skip optional steps
    windowsAutologinConfigured: false,
    firewallRuleInstalled: false,
    startupScriptInstalled: false,
  };
}

/**
 * Validate that required options are provided for --yes mode
 */
export function validateFastOnboardOptions(opts: FastOnboardOptions): string[] {
  const errors: string[] = [];

  if (!opts.role) {
    errors.push("--role is required (h1 or h2)");
  }

  if (opts.role && opts.role !== "h1" && opts.role !== "h2") {
    errors.push("--role must be h1 or h2");
  }

  return errors;
}

/**
 * Check if we can run in fast mode (all prerequisites met)
 */
export async function canRunFastMode(): Promise<{ ok: boolean; reason?: string }> {
  // Check Node version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split(".")[0], 10);
  if (major < 22) {
    return { ok: false, reason: `Node ${nodeVersion} detected. Requires Node >= 22.` };
  }

  // Check Tailscale
  try {
    const { execSync } = await import("node:child_process");
    execSync("tailscale status", { stdio: "ignore" });
  } catch {
    return { ok: false, reason: "Tailscale not running. Install and start Tailscale first." };
  }

  // Check OpenClaw
  try {
    const { execSync } = await import("node:child_process");
    execSync("openclaw --version", { stdio: "ignore" });
  } catch {
    return { ok: false, reason: "OpenClaw not installed. Run: npm install -g openclaw" };
  }

  return { ok: true };
}
