import { z } from "zod";

export const NodeRole = z.enum(["tom", "jerry"]);
export type NodeRole = z.infer<typeof NodeRole>;

export const WOLConfig = z.object({
  enabled: z.boolean().default(false),
  mac: z.string().optional(),
  broadcast_ip: z.string().optional(),
  router_port: z.number().int().default(9),
  wait_timeout_seconds: z.number().int().default(120),
  poll_interval_seconds: z.number().int().default(2),
  health_endpoint: z.string().optional(),
});

export const GatewayConfig = z.object({
  port: z.number().int().default(18789),
  bind: z.enum(["tailscale", "loopback", "lan"]).default("tailscale"),
  /** Stored key name in OS keychain (never plaintext token) */
  auth_token_key: z.string().optional(),
  /** Resolved token — populated at runtime from keychain, never written to disk */
  gateway_token: z.string().optional(),
});

/** Model provider config — persisted to TJConfig, API keys stored in keychain */
export const ProviderConfig = z.object({
  kind: z.enum(["anthropic", "openai", "ollama", "lmstudio", "custom"]),
  /** Model id, e.g. "claude-sonnet-4-6" or "llama3.2" */
  model: z.string(),
  /** Base URL — required for ollama/lmstudio/custom */
  base_url: z.string().optional(),
  /** Keychain key where the API key is stored (e.g. "hh-anthropic-key") */
  api_key_keychain_key: z.string().optional(),
  /** Display alias shown in status output */
  alias: z.string().optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfig>;

export const NodeConfig = z.object({
  role: NodeRole,
  name: z.string(),
  emoji: z.string().optional(),
  persona: z.string().optional(),
  tailscale_hostname: z.string(),
  tailscale_ip: z.string(),
  /** Provider config for this node's agent */
  provider: ProviderConfig.optional(),
});

export const PeerNodeConfig = NodeConfig.extend({
  ssh_user: z.string(),
  ssh_key_path: z.string(),
  os: z.enum(["linux", "windows", "macos"]).default("linux"),
  windows_autologin_configured: z.boolean().optional(),
  wol: WOLConfig.optional(),
  gateway: GatewayConfig.optional(),
  /** Gateway port (convenience shorthand for gateway.port) */
  gateway_port: z.number().int().default(18789),
  /** Gateway token — loaded from keychain at runtime, not stored in config */
  gateway_token: z.string().optional(),
  wol_enabled: z.boolean().optional(),
  wol_mac: z.string().optional(),
  wol_broadcast: z.string().optional(),
});

export const PairState = z.object({
  established_at: z.string().datetime(),
  pairing_code_hash: z.string(),
  trusted: z.boolean().default(false),
  last_handshake: z.string().datetime().optional(),
  last_heartbeat: z.string().datetime().optional(),
});

export const ProtocolConfig = z.object({
  heartbeat_interval_seconds: z.number().int().default(60),
  handoff_turn_limit: z.number().int().optional(),
  handoff_done_signal: z.string().default("DONE"),
  message_format: z.enum(["json", "markdown"]).default("json"),
});

export const TJConfig = z.object({
  version: z.string().default("0.1.0"),
  this_node: NodeConfig,
  /** Primary peer node (backwards-compatible single-peer config) */
  peer_node: PeerNodeConfig,
  /**
   * Additional peer nodes for multi-H2 setups.
   * Combine with peer_node to form the full peer roster.
   * Use `hh send --peer <name>` to target a specific peer.
   */
  peer_nodes: z.array(PeerNodeConfig).optional(),
  pair: PairState.optional(),
  protocol: ProtocolConfig.optional(),
  /** Gateway port for this node (convenience shorthand) */
  gateway_port: z.number().int().default(18789),
  /** Last confirmed heartbeat from peer (ISO datetime) */
  last_heartbeat: z.string().datetime().optional(),
  openclaw: z.object({
    session_tom: z.string().optional(),
    session_jerry: z.string().optional(),
    /** Path to openclaw.json on this machine */
    config_path: z.string().optional(),
  }).optional(),
});
export type TJConfig = z.infer<typeof TJConfig>;

/** Helper: build a ProviderConfig with sensible defaults for a given kind */
export function buildProviderConfig(
  kind: ProviderConfig["kind"],
  model?: string,
  opts?: { baseUrl?: string; apiKeyKeychainKey?: string; alias?: string },
): ProviderConfig {
  const defaults: Record<ProviderConfig["kind"], { model: string; alias: string; base_url?: string }> = {
    anthropic: { model: "claude-sonnet-4-6", alias: "Claude Sonnet" },
    openai:    { model: "gpt-4o-mini", alias: "GPT-4o Mini" },
    ollama:    { model: "llama3.2", alias: "Llama 3.2 (local)", base_url: "http://localhost:11434" },
    lmstudio:  { model: "local-model", alias: "LM Studio (local)", base_url: "http://localhost:1234/v1" },
    custom:    { model: "custom", alias: "Custom", base_url: "http://localhost:8080/v1" },
  };
  const d = defaults[kind];
  return {
    kind,
    model: model ?? d.model,
    base_url: opts?.baseUrl ?? d.base_url,
    api_key_keychain_key: opts?.apiKeyKeychainKey,
    alias: opts?.alias ?? d.alias,
  };
}
