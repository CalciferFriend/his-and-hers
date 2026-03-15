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
  AttachmentPayload,
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

// Attachment utilities (Phase 7d)
export {
  loadAttachment,
  loadAttachments,
  detectMimeType,
  isMultimodalType,
  formatAttachmentSummary,
  decodeAttachment,
  ATTACH_SIZE_LIMIT_BYTES,
  ATTACH_HARD_LIMIT_BYTES,
} from "./attach.ts";
export type { LoadAttachmentResult } from "./attach.ts";

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
export { startStreamServer, parseStreamUrl, parseStreamToken } from "./gateway/stream-server.ts";
export type { StreamChunkPayload, StreamServerOptions, StreamServerHandle } from "./gateway/stream-server.ts";
export { postChunk, createChunkStreamer } from "./gateway/stream-client.ts";
export type { PostChunkResult } from "./gateway/stream-client.ts";

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

// Schedule
export { HHSchedule, HHScheduleList } from "./schedule/schema.ts";
export {
  loadSchedules,
  saveSchedules,
  addSchedule,
  findSchedule,
  removeSchedule,
  enableSchedule,
  disableSchedule,
  updateLastRun,
  updateNextRun,
} from "./schedule/store.ts";
export type { AddScheduleInput } from "./schedule/store.ts";
export {
  readCrontab,
  writeCrontab,
  installCronEntry,
  removeCronEntry,
  listHHCronEntries,
  validateCron,
  calculateNextRun,
} from "./schedule/crontab.ts";
export type { CrontabEntry } from "./schedule/crontab.ts";

// ─── Notifications ────────────────────────────────────────────────────────────
export { deliverNotification } from "./notify/notify.ts";
export type { NotificationContext, GenericWebhookPayload } from "./notify/notify.ts";
export {
  loadNotifyWebhooks,
  saveNotifyWebhooks,
  addNotifyWebhook,
  removeNotifyWebhook,
  filterWebhooksByEvent,
  getActiveWebhooks,
} from "./notify/config.ts";
export type { HHNotifyWebhook, HHNotifyEvent } from "./notify/config.ts";
export {
  loadTemplates,
  saveTemplates,
  addTemplate,
  removeTemplate,
  findTemplate,
  extractPlaceholders,
  substituteVars,
} from "./template/store.ts";
export type { HHTemplate, AddTemplateInput, SubstituteOptions } from "./template/store.ts";
export {
  interpolatePipelineTask,
  parsePipelineSpec,
  parsePipelineFile,
} from "./pipeline.ts";
export type {
  PipelineStep,
  PipelineDefinition,
  PipelineStepResult,
  PipelineRunResult,
} from "./pipeline.ts";
export {
  loadWorkflows,
  saveWorkflows,
  addWorkflow,
  removeWorkflow,
  findWorkflow,
  recordWorkflowRun,
  workflowToPipelineDefinition,
} from "./workflow/store.ts";
export type {
  HHWorkflow,
  HHWorkflowStep,
  AddWorkflowInput,
} from "./workflow/store.ts";

export {
  loadAliases,
  saveAliases,
  addAlias,
  removeAlias,
  findAlias,
} from "./alias/store.ts";
export type { HHAlias, AddAliasInput } from "./alias/store.ts";

export { MockGateway } from "./gateway/mock-gateway.ts";
export type { MockGatewayOptions, ReceivedWake } from "./gateway/mock-gateway.ts";

// ─── Audit (Phase 10b) ────────────────────────────────────────────────────────
export {
  appendAuditEntry,
  readAuditLog,
  verifyAuditChain,
  getOrCreateAuditKey,
} from "./audit/audit.ts";
export type { AuditEntry, AuditFilter, VerifyResult } from "./audit/audit.ts";
