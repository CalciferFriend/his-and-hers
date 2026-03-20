/**
 * @cofounder/sdk — Public type definitions
 */

// ── Config shapes (minimal subset the SDK needs) ─────────────────────────────

export interface SDKPeerConfig {
  name: string;
  emoji?: string;
  tailscale_ip: string;
  gateway_port: number;
  gateway_token?: string;
  os?: "linux" | "windows" | "macos";
}

export interface SDKNodeConfig {
  name: string;
  emoji?: string;
  tailscale_ip: string;
}

export interface SDKConfig {
  this_node: SDKNodeConfig;
  peer_node: SDKPeerConfig;
  peer_nodes?: SDKPeerConfig[];
}

// ── HH constructor options ────────────────────────────────────────────────────

export interface HHOptions {
  /** Override the default config path (~/.cofounder/cofounder.json). */
  configPath?: string;
  /**
   * Inject a config object directly instead of reading from disk.
   * Useful in tests or when embedding HH with a dynamically generated config.
   */
  config?: SDKConfig;
  /** Override the base state dir (~/.cofounder/state). */
  stateDirOverride?: string;
}

// ── send() ────────────────────────────────────────────────────────────────────

export interface SendOptions {
  /**
   * Target peer by name. Defaults to the primary peer_node.
   * If the name matches a peer in peer_nodes[], that peer is used.
   */
  peer?: string;
  /**
   * Wait for the result to come back before resolving.
   * Internally starts a result webhook server and falls back to polling.
   * Default: false (fire-and-forget).
   */
  wait?: boolean;
  /**
   * Maximum time to wait for a result when `wait: true`.
   * Default: 300_000 ms (5 minutes).
   */
  timeoutMs?: number;
  /**
   * Called for each streaming chunk received from the peer while waiting.
   * Chunks are partial output strings — concatenate to build the full output.
   */
  onChunk?: (chunk: string) => void;
  /**
   * Routing hint passed to the peer to guide model/capability selection.
   * e.g. "prefer-local" | "prefer-cloud" | "gpu" | "cheap"
   */
  routingHint?: string;
  /**
   * Constraints appended to the task payload (same as CofounderTaskPayload.constraints).
   */
  constraints?: string[];
}

export interface SendResult {
  /** Stable task ID (UUID). */
  id: string;
  /** The peer that received the task. */
  peer: string;
  /** "pending" when fire-and-forget, "completed" / "failed" / "timeout" when waited. */
  status: "pending" | "completed" | "failed" | "timeout" | "cancelled";
  /** Task output text. Only set when status is "completed". */
  output?: string;
  /** Error string if the task failed. */
  error?: string;
  /** Token usage reported by the peer. */
  tokensUsed?: number;
  /** Duration in ms from task creation to result delivery. */
  durationMs?: number;
  /** Estimated USD cost reported by the peer. */
  costUsd?: number;
}

// ── status() ─────────────────────────────────────────────────────────────────

export interface StatusOptions {
  /** Target a specific peer by name. Defaults to the primary peer. */
  peer?: string;
}

export interface StatusResult {
  /** Whether the peer responded to a Tailscale ping. */
  online: boolean;
  /** Whether the peer's OpenClaw gateway responded to /health. */
  gatewayHealthy: boolean;
  peer: {
    name: string;
    emoji?: string;
    tailscale_ip: string;
    gateway_port: number;
  };
  /** Round-trip latency of the Tailscale ping, if the peer was reachable. */
  latencyMs?: number;
}

// ── peers() ──────────────────────────────────────────────────────────────────

export interface PeerInfo {
  name: string;
  emoji?: string;
  tailscale_ip: string;
  gateway_port: number;
  os?: "linux" | "windows" | "macos";
  /** True if this is the primary peer_node. */
  primary: boolean;
}

// ── ping() ───────────────────────────────────────────────────────────────────

export interface PingOptions {
  /** Target a specific peer by name. Defaults to primary. */
  peer?: string;
  /** Timeout for the reachability probe in ms. Default: 5000. */
  timeoutMs?: number;
}

export interface PingResult {
  peer: string;
  reachable: boolean;
  latencyMs?: number;
}

// ── tasks() ──────────────────────────────────────────────────────────────────

export interface TaskSummary {
  id: string;
  from: string;
  to: string;
  objective: string;
  status: "pending" | "running" | "completed" | "failed" | "timeout" | "cancelled";
  createdAt: string;
  updatedAt: string;
  output?: string;
  tokensUsed?: number;
  durationMs?: number;
  costUsd?: number;
}

export interface TasksOptions {
  /** Filter by status. Default: all. */
  status?: TaskSummary["status"] | TaskSummary["status"][];
  /** Filter by peer name. */
  peer?: string;
  /** Return at most this many tasks (most recent first). Default: 50. */
  limit?: number;
}
