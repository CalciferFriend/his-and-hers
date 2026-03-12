// Protocol schemas
export {
  TJMessage,
  TJTaskMessage,
  TJResultMessage,
  TJHeartbeatMessage,
  TJHandoffMessage,
  TJWakeMessage,
  TJErrorMessage,
  TJTaskPayload,
  TJResultPayload,
  TJHeartbeatPayload,
  TJHandoffPayload,
  TJWakePayload,
  TJErrorPayload,
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
  TJHandoff,
  TJHeartbeat,
  TJPair,
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

// Routing (capability-aware + heuristic fallback)
export { suggestRouting, routeTask } from "./routing.ts";
export type { RoutingHint, RoutingDecision } from "./routing.ts";

// Capability registry
export {
  TJCapabilityReport,
  TJGPUInfo,
  TJOllamaInfo,
  TJSkillTag,
  UNKNOWN_CAPABILITIES,
  scanCapabilities,
  saveCapabilities,
  loadCapabilities,
  savePeerCapabilities,
  loadPeerCapabilities,
  isPeerCapabilityStale,
} from "./capabilities/index.ts";
export type { ScanOptions } from "./capabilities/index.ts";
