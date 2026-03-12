import { z } from "zod";
import { randomUUID } from "node:crypto";

// ─── Shared base fields ──────────────────────────────────────────────────────

const TJMessageBase = z.object({
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

/** Payload for type: "task" — Tom delegates work to Jerry */
export const TJTaskPayload = z.object({
  objective: z.string(),
  context: z.string().optional(),
  constraints: z.array(z.string()).default([]),
  expected_output: z.string().optional(),
  timeout_seconds: z.number().int().positive().optional(),
});
export type TJTaskPayload = z.infer<typeof TJTaskPayload>;

/** Payload for type: "result" — Jerry returns work to Tom */
export const TJResultPayload = z.object({
  task_id: z.string().uuid(),
  output: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
  /** Artifacts: file paths, URLs, or base64-encoded data */
  artifacts: z.array(z.string()).default([]),
  tokens_used: z.number().int().nonnegative().optional(),
  duration_ms: z.number().int().nonnegative().optional(),
});
export type TJResultPayload = z.infer<typeof TJResultPayload>;

/** Payload for type: "heartbeat" — periodic liveness ping */
export const TJHeartbeatPayload = z.object({
  gateway_healthy: z.boolean(),
  uptime_seconds: z.number().nonnegative(),
  tailscale_ip: z.string(),
  model: z.string().optional(),
  gpu_available: z.boolean().optional(),
});
export type TJHeartbeatPayload = z.infer<typeof TJHeartbeatPayload>;

/** Payload for type: "handoff" — structured context/state handoff */
export const TJHandoffPayload = z.object({
  handoff_summary: z.string(),
  next_objective: z.string().optional(),
  session_id: z.string().optional(),
});
export type TJHandoffPayload = z.infer<typeof TJHandoffPayload>;

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
export const TJLatentPayload = z.object({
  task_id: z.string().uuid(),
  sender_model: z.string(),
  sender_hidden_dim: z.number().int().positive(),

  // Vision Wormhole codec output (primary path for heterogeneous models)
  codec_version: z.string().optional(),
  codec_output_dim: z.number().int().positive(),
  codec_tokens: z.number().int().positive(),
  compressed_latent: z.string().optional(), // base64-encoded float16 tensor [tokens x output_dim]

  // LatentMAS KV-cache path (same-family models only, training-free)
  kv_model: z.string().optional(), // must match receiver model exactly
  kv_cache: z.string().optional(), // base64-encoded KV cache

  // Always include text fallback for nodes that don't support latent
  fallback_text: z.string(),
  fallback_required: z.boolean().default(false), // if true, receiver MUST use text fallback

  compression_ratio: z.number().positive().optional(), // raw hidden size / compressed size
});
export type TJLatentPayload = z.infer<typeof TJLatentPayload>;

// ─── Discriminated union variants ────────────────────────────────────────────

export const TJTaskMessage = TJMessageBase.extend({
  type: z.literal("task"),
  payload: TJTaskPayload,
});
export type TJTaskMessage = z.infer<typeof TJTaskMessage>;

export const TJResultMessage = TJMessageBase.extend({
  type: z.literal("result"),
  payload: TJResultPayload,
});
export type TJResultMessage = z.infer<typeof TJResultMessage>;

export const TJHeartbeatMessage = TJMessageBase.extend({
  type: z.literal("heartbeat"),
  payload: TJHeartbeatPayload,
});
export type TJHeartbeatMessage = z.infer<typeof TJHeartbeatMessage>;

export const TJHandoffMessage = TJMessageBase.extend({
  type: z.literal("handoff"),
  payload: TJHandoffPayload,
});
export type TJHandoffMessage = z.infer<typeof TJHandoffMessage>;

export const TJWakeMessage = TJMessageBase.extend({
  type: z.literal("wake"),
  payload: TJWakePayload,
});
export type TJWakeMessage = z.infer<typeof TJWakeMessage>;

export const TJErrorMessage = TJMessageBase.extend({
  type: z.literal("error"),
  payload: TJErrorPayload,
});
export type TJErrorMessage = z.infer<typeof TJErrorMessage>;

export const TJLatentMessage = TJMessageBase.extend({
  type: z.literal("latent"),
  payload: TJLatentPayload,
});
export type TJLatentMessage = z.infer<typeof TJLatentMessage>;

// ─── Discriminated union ─────────────────────────────────────────────────────

/**
 * TJMessage — discriminated union on `type`.
 * Every cross-machine communication is wrapped in this format.
 * Payload type is fully typed per message variant — no more JSON.parse(payload).
 */
export const TJMessage = z.discriminatedUnion("type", [
  TJTaskMessage,
  TJResultMessage,
  TJHeartbeatMessage,
  TJHandoffMessage,
  TJWakeMessage,
  TJErrorMessage,
  TJLatentMessage,
]);
export type TJMessage = z.infer<typeof TJMessage>;

// ─── Type guard helpers ───────────────────────────────────────────────────────

export function isTaskMessage(msg: TJMessage): msg is TJTaskMessage {
  return msg.type === "task";
}

export function isResultMessage(msg: TJMessage): msg is TJResultMessage {
  return msg.type === "result";
}

export function isHeartbeatMessage(msg: TJMessage): msg is TJHeartbeatMessage {
  return msg.type === "heartbeat";
}

export function isHandoffMessage(msg: TJMessage): msg is TJHandoffMessage {
  return msg.type === "handoff";
}

export function isWakeMessage(msg: TJMessage): msg is TJWakeMessage {
  return msg.type === "wake";
}

export function isErrorMessage(msg: TJMessage): msg is TJErrorMessage {
  return msg.type === "error";
}

export function isLatentMessage(msg: TJMessage): msg is TJLatentMessage {
  return msg.type === "latent";
}

// ─── Factory helpers ──────────────────────────────────────────────────────────

/** Build a task message with defaults filled */
export function createTaskMessage(
  from: string,
  to: string,
  payload: TJTaskPayload,
  opts?: Partial<Pick<TJTaskMessage, "turn" | "context_summary" | "budget_remaining" | "wake_required">>,
): TJTaskMessage {
  return TJTaskMessage.parse({ from, to, type: "task", payload, ...opts });
}

/** Build a result message with defaults filled */
export function createResultMessage(
  from: string,
  to: string,
  payload: TJResultPayload,
  opts?: Partial<Pick<TJResultMessage, "turn" | "done" | "context_summary">>,
): TJResultMessage {
  return TJResultMessage.parse({ from, to, type: "result", done: true, payload, ...opts });
}

/** Build a heartbeat message */
export function createHeartbeatMessage(
  from: string,
  to: string,
  payload: TJHeartbeatPayload,
): TJHeartbeatMessage {
  return TJHeartbeatMessage.parse({ from, to, type: "heartbeat", payload });
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
  payload: TJLatentPayload,
  opts?: Partial<Pick<TJLatentMessage, "turn" | "context_summary">>,
): TJLatentMessage {
  return TJLatentMessage.parse({ from, to, type: "latent", payload, ...opts });
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
