// Protocol schemas
export {
  HHMessage,
  HHTaskMessage,
  HHResultMessage,
  HHHeartbeatMessage,
  HHHandoffMessage,
  HHWakeMessage,
  HHErrorMessage,
  HHTaskPayload,
  HHResultPayload,
  HHHeartbeatPayload,
  HHHandoffPayload,
  HHWakePayload,
  HHErrorPayload,
  isTaskMessage,
  isResultMessage,
  isHeartbeatMessage,
  isHandoffMessage,
  isWakeMessage,
  isErrorMessage,
  createTaskMessage,
  createResultMessage,
  createHeartbeatMessage,
  createWakeMessage,
  HHHandoff,
  HHHeartbeat,
  HHPair,
} from "./protocol/index.ts";

// Transport layer
export {
  getTailscaleStatus,
  pingPeer,
  waitForPeer,
  sshExec,
  testSSH,
  sendMagicPacket,
  wakeAndWait,
} from "./transport/index.ts";
export type { SSHConfig, WOLConfig } from "./transport/index.ts";

// Trust model
export {
  generatePairingCode,
  hashPairingCode,
  verifyPairingCode,
} from "./trust/pairing.ts";
export { isPeerTrusted, addTrustedPeer } from "./trust/allowlist.ts";
export type { PeerAllowlist } from "./trust/allowlist.ts";

// Gateway
export { checkGatewayHealth } from "./gateway/health.ts";
export { getBindAddress } from "./gateway/bind.ts";
export type { BindMode } from "./gateway/bind.ts";
export { wakeAgent } from "./gateway/wake.ts";
export type { WakeOptions, WakeResult } from "./gateway/wake.ts";
export {
  buildSocatCommand,
  buildSystemdService,
  isSocatInstalled,
  buildNetshPortProxyCommand,
  buildNetshPortProxyRemoveCommand,
  addWindowsLoopbackProxy,
  isWindowsLoopbackProxyInstalled,
} from "./gateway/proxy.ts";
export type { ProxyConfig } from "./gateway/proxy.ts";
export {
  startResultServer,
  deliverResultWebhook,
  parseWebhookUrl,
} from "./gateway/result-server.ts";
export type { ResultServerHandle, ResultServerOptions, ResultWebhookPayload } from "./gateway/result-server.ts";
export { startCapabilitiesServer } from "./gateway/capabilities-server.ts";
export type { CapabilitiesServerHandle, CapabilitiesServerOptions } from "./gateway/capabilities-server.ts";

// Retry / backoff
export {
  withRetry,
  getRetryState,
  setRetryState,
  clearRetryState,
  nextRetryAt,
  cronRetryDecision,
  cronRetryDecisionSync,
  cronRetryDecisionAsync,
} from "./retry.ts";
export type { RetryOptions, RetryState, RetryStateDisk, RetryStatus } from "./retry.ts";

// Routing (capability-aware + heuristic fallback)
export { suggestRouting, routeTask } from "./routing.ts";
export type { RoutingHint, RoutingDecision } from "./routing.ts";

// Provider pricing
export {
  getPricing,
  estimateCost,
  formatCost,
  formatTokens,
} from "./providers/pricing.ts";
export type { TokenPrice } from "./providers/pricing.ts";

// Handoff context (multi-turn summaries)
export {
  appendContextEntry,
  loadContextEntries,
  buildContextSummary,
  loadContextSummary,
  clearContextEntries,
  contextEntryCount,
  summarizeTask,
  shouldCondenseWithLLM,
} from "./context/index.ts";
export type { ContextEntry, SummarizeInput } from "./context/index.ts";

// Capability registry
export {
  HHCapabilityReport,
  HHGPUInfo,
  HHOllamaInfo,
  HHSkillTag,
  UNKNOWN_CAPABILITIES,
  scanCapabilities,
  saveCapabilities,
  loadCapabilities,
  savePeerCapabilities,
  loadPeerCapabilities,
  isPeerCapabilityStale,
} from "./capabilities/index.ts";
export type { ScanOptions } from "./capabilities/index.ts";
