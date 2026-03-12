import { z } from "zod";
import { randomUUID } from "node:crypto";

// ─── Shared base fields ──────────────────────────────────────────────────────

const HHMessageBase = z.object({
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
export const HHTaskPayload = z.object({
  objective: z.string(),
  context: z.string().optional(),
  constraints: z.array(z.string()).default([]),
  expected_output: z.string().optional(),
  timeout_seconds: z.number().int().positive().optional(),
});
export type HHTaskPayload = z.infer<typeof HHTaskPayload>;

/** Payload for type: "result" — H2 returns work to H1 */
export const HHResultPayload = z.object({
  task_id: z.string().uuid(),
  output: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
  /** Artifacts: file paths, URLs, or base64-encoded data */
  artifacts: z.array(z.string()).default([]),
  tokens_used: z.number().int().nonnegative().optional(),
  duration_ms: z.number().int().nonnegative().optional(),
});
export type HHResultPayload = z.infer<typeof HHResultPayload>;

/** Payload for type: "heartbeat" — periodic liveness ping */
export const HHHeartbeatPayload = z.object({
  gateway_healthy: z.boolean(),
  uptime_seconds: z.number().nonnegative(),
  tailscale_ip: z.string(),
  model: z.string().optional(),
  gpu_available: z.boolean().optional(),
});
export type HHHeartbeatPayload = z.infer<typeof HHHeartbeatPayload>;

/** Payload for type: "handoff" — structured context/state handoff */
export const HHHandoffPayload = z.object({
  handoff_summary: z.string(),
  next_objective: z.string().optional(),
  session_id: z.string().optional(),
});
export type HHHandoffPayload = z.infer<typeof HHHandoffPayload>;

/** Payload for type: "wake" — request peer to wake up */
export const TJWakePayload = z.object({
  reason: z.string().optional(),
  task_preview: z.string().optional(),
});
export type TJWakePayload = z.infer<typeof TJWakePayload>;

/** Payload for type: "error" — protocol-level error report */
export const TJErrorPayload = z.object({
  code: z.string(),
  message: z.string(),
  recoverable: z.boolean().default(true),
  original_message_id: z.string().uuid().optional(),
});
export type TJErrorPayload = z.infer<typeof TJErrorPayload>;

/** Payload for type: "latent" — latent space communication via Vision Wormhole or KV cache */
export const HHLatentPayload = z.object({
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
export type HHLatentPayload = z.infer<typeof HHLatentPayload>;

// ─── Discriminated union variants ────────────────────────────────────────────

export const HHTaskMessage = HHMessageBase.extend({
  type: z.literal("task"),
  payload: HHTaskPayload,
});
export type HHTaskMessage = z.infer<typeof HHTaskMessage>;

export const HHResultMessage = HHMessageBase.extend({
  type: z.literal("result"),
  payload: HHResultPayload,
});
export type HHResultMessage = z.infer<typeof HHResultMessage>;

export const HHHeartbeatMessage = HHMessageBase.extend({
  type: z.literal("heartbeat"),
  payload: HHHeartbeatPayload,
});
export type HHHeartbeatMessage = z.infer<typeof HHHeartbeatMessage>;

export const HHHandoffMessage = HHMessageBase.extend({
  type: z.literal("handoff"),
  payload: HHHandoffPayload,
});
export type HHHandoffMessage = z.infer<typeof HHHandoffMessage>;

export const TJWakeMessage = HHMessageBase.extend({
  type: z.literal("wake"),
  payload: TJWakePayload,
});
export type TJWakeMessage = z.infer<typeof TJWakeMessage>;

export const TJErrorMessage = HHMessageBase.extend({
  type: z.literal("error"),
  payload: TJErrorPayload,
});
export type TJErrorMessage = z.infer<typeof TJErrorMessage>;

export const HHLatentMessage = HHMessageBase.extend({
  type: z.literal("latent"),
  payload: HHLatentPayload,
});
export type HHLatentMessage = z.infer<typeof HHLatentMessage>;

// ─── Discriminated union ─────────────────────────────────────────────────────

/**
 * HHMessage — discriminated union on `type`.
 * Every cross-machine communication is wrapped in this format.
 * Payload type is fully typed per message variant — no more JSON.parse(payload).
 */
export const HHMessage = z.discriminatedUnion("type", [
  HHTaskMessage,
  HHResultMessage,
  HHHeartbeatMessage,
  HHHandoffMessage,
  TJWakeMessage,
  TJErrorMessage,
  HHLatentMessage,
]);
export type HHMessage = z.infer<typeof HHMessage>;

// ─── Type guard helpers ───────────────────────────────────────────────────────

export function isTaskMessage(msg: HHMessage): msg is HHTaskMessage {
  return msg.type === "task";
}

export function isResultMessage(msg: HHMessage): msg is HHResultMessage {
  return msg.type === "result";
}

export function isHeartbeatMessage(msg: HHMessage): msg is HHHeartbeatMessage {
  return msg.type === "heartbeat";
}

export function isHandoffMessage(msg: HHMessage): msg is HHHandoffMessage {
  return msg.type === "handoff";
}

export function isWakeMessage(msg: HHMessage): msg is TJWakeMessage {
  return msg.type === "wake";
}

export function isErrorMessage(msg: HHMessage): msg is TJErrorMessage {
  return msg.type === "error";
}

export function isLatentMessage(msg: HHMessage): msg is HHLatentMessage {
  return msg.type === "latent";
}

// ─── Factory helpers ──────────────────────────────────────────────────────────

/** Build a task message with defaults filled */
export function createTaskMessage(
  from: string,
  to: string,
  payload: HHTaskPayload,
  opts?: Partial<Pick<HHTaskMessage, "turn" | "context_summary" | "budget_remaining" | "wake_required">>,
): HHTaskMessage {
  return HHTaskMessage.parse({ from, to, type: "task", payload, ...opts });
}

/** Build a result message with defaults filled */
export function createResultMessage(
  from: string,
  to: string,
  payload: HHResultPayload,
  opts?: Partial<Pick<HHResultMessage, "turn" | "done" | "context_summary">>,
): HHResultMessage {
  return HHResultMessage.parse({ from, to, type: "result", done: true, payload, ...opts });
}

/** Build a heartbeat message */
export function createHeartbeatMessage(
  from: string,
  to: string,
  payload: HHHeartbeatPayload,
): HHHeartbeatMessage {
  return HHHeartbeatMessage.parse({ from, to, type: "heartbeat", payload });
}

/** Build a wake message */
export function createWakeMessage(
  from: string,
  to: string,
  reason?: string,
): TJWakeMessage {
  return TJWakeMessage.parse({ from, to, type: "wake", payload: { reason } });
}

/** Build a latent message */
export function createLatentMessage(
  from: string,
  to: string,
  payload: HHLatentPayload,
  opts?: Partial<Pick<HHLatentMessage, "turn" | "context_summary">>,
): HHLatentMessage {
  return HHLatentMessage.parse({ from, to, type: "latent", payload, ...opts });
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
