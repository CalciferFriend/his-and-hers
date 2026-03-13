import type { NodeRole, ProviderConfig } from "../config/schema.ts";

/**
 * Accumulated state across wizard steps.
 * Each step reads what it needs and writes what it produces.
 */
export interface WizardContext {
  // Step 1: welcome
  nodeVersion: string;
  openclawInstalled: boolean;
  tailscaleOnline: boolean;
  tailscaleHostname: string;
  tailscaleIP: string;

  // Step 2: role
  role: NodeRole;

  // Step 3: identity
  name: string;
  emoji: string;
  persona: string;

  // Step 4: provider
  provider: string;
  providerConfig: ProviderConfig;
  apiKeyStored: boolean;

  // Step 5: peer
  peerTailscaleHostname: string;
  peerTailscaleIP: string;
  peerSSHUser: string;
  peerSSHKeyPath: string;
  peerOS: "linux" | "windows" | "macos";

  // Step 6: wol
  wolEnabled: boolean;
  wolMAC: string;
  wolBroadcastIP: string;
  wolRouterPort: number;
  wolTimeoutSeconds: number;
  wolPollIntervalSeconds: number;

  // Step 7: gateway_bind
  thisBindMode: "loopback" | "tailscale" | "lan";
  peerBindMode: "loopback" | "tailscale" | "lan";
  peerGatewayPort: number;

  // Step 8: autologin
  windowsAutologinConfigured: boolean;

  // Step 9: firewall
  firewallRuleInstalled: boolean;

  // Step 10: startup
  startupScriptInstalled: boolean;

  // Step 11: soul
  soulTemplateCopied: boolean;

  // Step 12: validate
  validationPassed: boolean;

  // Step 12: finalize
  pairingCode: string;
  pairingCodeHash: string;
  configWritten: boolean;
}

export function createEmptyContext(): Partial<WizardContext> {
  return {};
}

/**
 * Check if the user cancelled a clack prompt.
 * clack/prompts returns a symbol when user hits Ctrl+C.
 */
export function isCancelled(value: unknown): value is symbol {
  return typeof value === "symbol";
}
