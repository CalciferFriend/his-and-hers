import { z } from "zod";
import { randomUUID } from "node:crypto";

// ─── Attachment schema ────────────────────────────────────────────────────────

/**
 * A single file attachment embedded in a task message (base64-encoded).
 * Supported: PDF, images (PNG/JPEG/WebP/GIF), text, code, markdown, JSON.
 * Hard size limit: 10 MB per attachment (enforced by loadAttachment()).
 */
export const AttachmentPayload = z.object({
  /** Original filename (e.g. "report.pdf") */
  filename: z.string(),
  /** MIME type (e.g. "application/pdf", "image/png", "text/plain") */
  mime_type: z.string(),
  /** Base64-encoded file contents */
  data: z.string(),
  /** Original file size in bytes (pre-encoding) */
  size_bytes: z.number().int().nonnegative(),
});
export type AttachmentPayload = z.infer<typeof AttachmentPayload>;

// ─── Shared base fields ──────────────────────────────────────────────────────

const CofounderMessageBase = z.object({
  version: z.string().default("0.1.0"),
  id: z.string().uuid().default(() => randomUUID()),
  from: z.string(),
  to: z.string(),
  turn: z.number().int().nonnegative().default(0),
  timestamp: z.string().datetime().default(() => new Date().toISOString()),
  done: z.boolean().default(false),
  wake_required: z.boolean().default(false),
  shutdown_after: z.boolean().default(false),
  context_summary: z.string().nullable().default(null),
  budget_remaining: z.number().nullable().default(null),
});

// ─── Typed payload schemas ────────────────────────────────────────────────────

/** Payload for type: "task" — H1 delegates work to H2 */
export const CofounderTaskPayload = z.object({
  objective: z.string(),
  context: z.string().optional(),
  constraints: z.array(z.string()).default([]),
  expected_output: z.string().optional(),
  timeout_seconds: z.number().int().positive().optional(),
  /**
   * File attachments for this task (Phase 7d).
   * H2 strips these from the wake text and injects them via multimodal message API.
   * Max 10 MB soft cap per file; max ~50 MB total per task (transport limit).
   */
  attachments: z.array(AttachmentPayload).default([]),
});
export type CofounderTaskPayload = z.infer<typeof CofounderTaskPayload>;

/** Payload for type: "result" — H2 returns work to H1 */
export const CofounderResultPayload = z.object({
  task_id: z.string().uuid(),
  output: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
  /** Artifacts: file paths, URLs, or base64-encoded data */
  artifacts: z.array(z.string()).default([]),
  tokens_used: z.number().int().nonnegative().optional(),
  duration_ms: z.number().int().nonnegative().optional(),
});
export type CofounderResultPayload = z.infer<typeof CofounderResultPayload>;

/** Payload for type: "heartbeat" — periodic liveness ping */
export const CofounderHeartbeatPayload = z.object({
  gateway_healthy: z.boolean(),
  uptime_seconds: z.number().nonnegative(),
  tailscale_ip: z.string(),
  model: z.string().optional(),
  gpu_available: z.boolean().optional(),
});
export type CofounderHeartbeatPayload = z.infer<typeof CofounderHeartbeatPayload>;

/** Payload for type: "handoff" — structured context/state handoff */
export const CofounderHandoffPayload = z.object({
  handoff_summary: z.string(),
  next_objective: z.string().optional(),
  session_id: z.string().optional(),
});
export type CofounderHandoffPayload = z.infer<typeof CofounderHandoffPayload>;

/** Payload for type: "wake" — request peer to wake up */
export const HHWakePayload = z.object({
  reason: z.string().optional(),
  task_preview: z.string().optional(),
});
export type HHWakePayload = z.infer<typeof HHWakePayload>;

/** Payload for type: "error" — protocol-level error report */
export const HHErrorPayload = z.object({
  code: z.string(),
  message: z.string(),
  recoverable: z.boolean().default(true),
  original_message_id: z.string().uuid().optional(),
});
export type HHErrorPayload = z.infer<typeof HHErrorPayload>;

/** Payload for type: "latent" — latent space communication via Vision Wormhole or KV cache */
export const CofounderLatentPayload = z.object({
  task_id: z.string().uuid(),
  sender_model: z.string(),
  sender_hidden_dim: z.number().int().positive(),

  // Vision Wormhole codec output (primary path for heterogeneous models).
  // Set codec_output_dim=0 and codec_tokens=0 on the KV-cache (LatentMAS) path
  // where no codec compression is used.
  codec_version: z.string().optional(),
  codec_output_dim: z.number().int().nonnegative(),
  codec_tokens: z.number().int().nonnegative(),
  compressed_latent: z.string().optional(), // base64-encoded float32 tensor [tokens x output_dim]

  // LatentMAS KV-cache path (same-family models only, training-free)
  kv_model: z.string().optional(), // must match receiver model exactly
  kv_cache: z.string().optional(), // base64-encoded KV cache

  // Always include text fallback for nodes that don't support latent
  fallback_text: z.string(),
  fallback_required: z.boolean().default(false), // if true, receiver MUST use text fallback

  compression_ratio: z.number().positive().optional(), // raw hidden size / compressed size
});
export type CofounderLatentPayload = z.infer<typeof CofounderLatentPayload>;

// ─── Discriminated union variants ────────────────────────────────────────────

export const CofounderTaskMessage = CofounderMessageBase.extend({
  type: z.literal("task"),
  payload: CofounderTaskPayload,
});
export type CofounderTaskMessage = z.infer<typeof CofounderTaskMessage>;

export const CofounderResultMessage = CofounderMessageBase.extend({
  type: z.literal("result"),
  payload: CofounderResultPayload,
});
export type CofounderResultMessage = z.infer<typeof CofounderResultMessage>;

export const CofounderHeartbeatMessage = CofounderMessageBase.extend({
  type: z.literal("heartbeat"),
  payload: CofounderHeartbeatPayload,
});
export type CofounderHeartbeatMessage = z.infer<typeof CofounderHeartbeatMessage>;

export const CofounderHandoffMessage = CofounderMessageBase.extend({
  type: z.literal("handoff"),
  payload: CofounderHandoffPayload,
});
export type CofounderHandoffMessage = z.infer<typeof CofounderHandoffMessage>;

export const CofounderWakeMessage = CofounderMessageBase.extend({
  type: z.literal("wake"),
  payload: HHWakePayload,
});
export type CofounderWakeMessage = z.infer<typeof CofounderWakeMessage>;

export const CofounderErrorMessage = CofounderMessageBase.extend({
  type: z.literal("error"),
  payload: HHErrorPayload,
});
export type CofounderErrorMessage = z.infer<typeof CofounderErrorMessage>;

export const CofounderLatentMessage = CofounderMessageBase.extend({
  type: z.literal("latent"),
  payload: CofounderLatentPayload,
});
export type CofounderLatentMessage = z.infer<typeof CofounderLatentMessage>;

// ─── Discriminated union ─────────────────────────────────────────────────────

/**
 * CofounderMessage — discriminated union on `type`.
 * Every cross-machine communication is wrapped in this format.
 * Payload type is fully typed per message variant — no more JSON.parse(payload).
 */
export const CofounderMessage = z.discriminatedUnion("type", [
  CofounderTaskMessage,
  CofounderResultMessage,
  CofounderHeartbeatMessage,
  CofounderHandoffMessage,
  CofounderWakeMessage,
  CofounderErrorMessage,
  CofounderLatentMessage,
]);
export type CofounderMessage = z.infer<typeof CofounderMessage>;

// ─── Type guard helpers ───────────────────────────────────────────────────────

export function isTaskMessage(msg: CofounderMessage): msg is CofounderTaskMessage {
  return msg.type === "task";
}

export function isResultMessage(msg: CofounderMessage): msg is CofounderResultMessage {
  return msg.type === "result";
}

export function isHeartbeatMessage(msg: CofounderMessage): msg is CofounderHeartbeatMessage {
  return msg.type === "heartbeat";
}

export function isHandoffMessage(msg: CofounderMessage): msg is CofounderHandoffMessage {
  return msg.type === "handoff";
}

export function isWakeMessage(msg: CofounderMessage): msg is CofounderWakeMessage {
  return msg.type === "wake";
}

export function isErrorMessage(msg: CofounderMessage): msg is CofounderErrorMessage {
  return msg.type === "error";
}

export function isLatentMessage(msg: CofounderMessage): msg is CofounderLatentMessage {
  return msg.type === "latent";
}

// ─── Factory helpers ──────────────────────────────────────────────────────────

type TaskMessageOpts = Partial<Pick<CofounderTaskMessage, "turn" | "context_summary" | "budget_remaining" | "wake_required">>;
type ResultMessageOpts = Partial<Pick<CofounderResultMessage, "turn" | "done" | "context_summary">>;

/** Flat-object form for createTaskMessage */
type CreateTaskMessageFlat = {
  from: string;
  to: string;
  objective: string;
  context?: string;
  constraints?: string[];
  expected_output?: string;
  timeout_seconds?: number;
} & TaskMessageOpts;

/** Flat-object form for createResultMessage */
type CreateResultMessageFlat = {
  from: string;
  to: string;
  task_id: string;
  output: string;
  success: boolean;
  error?: string;
  artifacts?: string[];
  tokens_used?: number;
  duration_ms?: number;
} & ResultMessageOpts;

/** Build a task message with defaults filled (positional or flat-object form) */
export function createTaskMessage(from: string, to: string, payload: CofounderTaskPayload, opts?: TaskMessageOpts): CofounderTaskMessage;
export function createTaskMessage(opts: CreateTaskMessageFlat): CofounderTaskMessage;
export function createTaskMessage(
  fromOrOpts: string | CreateTaskMessageFlat,
  to?: string,
  payload?: CofounderTaskPayload,
  opts?: TaskMessageOpts,
): CofounderTaskMessage {
  if (typeof fromOrOpts === "object") {
    const { from, to: toVal, objective, context, constraints, expected_output, timeout_seconds, ...msgOpts } = fromOrOpts;
    const p: CofounderTaskPayload = CofounderTaskPayload.parse({ objective, context, constraints: constraints ?? [], expected_output, timeout_seconds });
    return CofounderTaskMessage.parse({ from, to: toVal, type: "task", payload: p, ...msgOpts });
  }
  return CofounderTaskMessage.parse({ from: fromOrOpts, to, type: "task", payload, ...opts });
}

/** Build a result message with defaults filled (positional or flat-object form) */
export function createResultMessage(from: string, to: string, payload: CofounderResultPayload, opts?: ResultMessageOpts): CofounderResultMessage;
export function createResultMessage(opts: CreateResultMessageFlat): CofounderResultMessage;
export function createResultMessage(
  fromOrOpts: string | CreateResultMessageFlat,
  to?: string,
  payload?: CofounderResultPayload,
  opts?: ResultMessageOpts,
): CofounderResultMessage {
  if (typeof fromOrOpts === "object") {
    const { from, to: toVal, task_id, output, success, error, artifacts, tokens_used, duration_ms, ...msgOpts } = fromOrOpts;
    const p: CofounderResultPayload = CofounderResultPayload.parse({ task_id, output, success, error, artifacts, tokens_used, duration_ms });
    return CofounderResultMessage.parse({ from, to: toVal, type: "result", done: true, payload: p, ...msgOpts });
  }
  return CofounderResultMessage.parse({ from: fromOrOpts, to, type: "result", done: true, payload, ...opts });
}

/** Build a heartbeat message */
export function createHeartbeatMessage(
  from: string,
  to: string,
  payload: CofounderHeartbeatPayload,
): CofounderHeartbeatMessage {
  return CofounderHeartbeatMessage.parse({ from, to, type: "heartbeat", payload });
}

/** Build a wake message */
export function createWakeMessage(
  from: string,
  to: string,
  reason?: string,
): CofounderWakeMessage {
  return CofounderWakeMessage.parse({ from, to, type: "wake", payload: { reason } });
}

/** Build a latent message */
export function createLatentMessage(
  from: string,
  to: string,
  payload: CofounderLatentPayload,
  opts?: Partial<Pick<CofounderLatentMessage, "turn" | "context_summary">>,
): CofounderLatentMessage {
  return CofounderLatentMessage.parse({ from, to, type: "latent", payload, ...opts });
}

// ─── Latent serialization helpers ────────────────────────────────────────────

/**
 * Serialize a Float32Array tensor to base64 string for transport.
 * Uses float16 encoding to reduce bandwidth (2 bytes per value vs 4).
 *
 * @param tensor - The float tensor to serialize
 * @param tokens - Number of latent tokens (first dimension)
 * @param dim - Dimension per token (second dimension)
 * @returns base64-encoded string
 */
export function serializeLatent(tensor: Float32Array, tokens: number, dim: number): string {
  if (tensor.length !== tokens * dim) {
    throw new Error(`Tensor size mismatch: expected ${tokens * dim}, got ${tensor.length}`);
  }

  // Serialize as float32 (4 bytes/element). Production Vision Wormhole codecs will
  // output float16 (2 bytes/element) for bandwidth efficiency — swap in a float16
  // library (e.g. @petamoriken/float16) when upstream codecs are available.
  const f32 = new Float32Array(tensor); // copy to ensure clean buffer ownership
  const buffer = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
  return buffer.toString("base64");
}

/**
 * Deserialize a base64-encoded latent tensor back to Float32Array.
 *
 * @param encoded - Base64-encoded tensor string
 * @param tokens - Number of latent tokens
 * @param dim - Dimension per token
 * @returns Float32Array tensor
 */
export function deserializeLatent(encoded: string, tokens: number, dim: number): Float32Array {
  const buffer = Buffer.from(encoded, "base64");
  const expectedSize = tokens * dim * 4; // 4 bytes per float32

  if (buffer.length !== expectedSize) {
    throw new Error(`Buffer size mismatch: expected ${expectedSize} bytes, got ${buffer.length}`);
  }

  // Wrap the buffer's underlying ArrayBuffer into a Float32Array.
  // Use slice() to get a clean copy with correct byteOffset alignment.
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return new Float32Array(ab);
}
