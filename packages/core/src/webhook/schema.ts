/**
 * core/webhook/schema.ts
 *
 * Zod schemas for inbound webhook configuration.
 * An inbound webhook = a local HTTP path that receives external POST requests
 * and dispatches tasks to a peer.
 */

import { z } from "zod";

// ─── Schema ──────────────────────────────────────────────────────────────────

/**
 * A registered inbound webhook.
 *
 * When the cofounder webhook server receives a POST to `path`, it:
 *   1. Verifies the HMAC signature if `secret` is set
 *   2. Interpolates `task_template` with `{{body.*}}`, `{{headers.*}}`, `{{query.*}}`
 *   3. Dispatches the task to `peer` (or auto-routes if omitted)
 */
export const HHWebhookSchema = z.object({
  /** UUID */
  id: z.string().uuid(),

  /** URL path the server listens on, e.g. "/hooks/deploy" */
  path: z
    .string()
    .regex(/^\/[^\s]*$/, "path must start with /")
    .min(2),

  /** Optional human-readable label */
  name: z.string().optional(),

  /**
   * Task template dispatched to the peer.
   * Supports {{body.<key>}}, {{headers.<key>}}, {{query.<key>}} interpolation.
   * Also {{body_raw}} for the full request body as a JSON string.
   *
   * Example: "Review PR #{{body.number}}: {{body.pull_request.title}}"
   */
  task_template: z.string().min(1),

  /** Target peer name. Omit to let routeTask() pick automatically. */
  peer: z.string().optional(),

  /**
   * Optional shared secret for HMAC signature verification.
   * When set, the server verifies `X-Hub-Signature-256` (GitHub style) or
   * the header named by `secret_header` before dispatching.
   */
  secret: z.string().optional(),

  /**
   * Header to read the HMAC signature from.
   * Defaults to "X-Hub-Signature-256" (GitHub webhooks).
   * Format: "sha256=<hex-digest>"
   */
  secret_header: z.string().default("X-Hub-Signature-256"),

  /** Whether this webhook is active. Defaults to true. */
  enabled: z.boolean().default(true),

  /** ISO 8601 creation timestamp */
  created_at: z.string().datetime(),

  /** Number of times this webhook has fired */
  trigger_count: z.number().int().min(0).default(0),

  /** ISO 8601 timestamp of last successful trigger, or null */
  last_triggered_at: z.string().datetime().nullable().default(null),
});

export type HHWebhook = z.infer<typeof HHWebhookSchema>;

export const HHWebhookListSchema = z.array(HHWebhookSchema);

// ─── Add input ────────────────────────────────────────────────────────────────

export interface AddWebhookInput {
  path: string;
  task_template: string;
  name?: string;
  peer?: string;
  secret?: string;
  secret_header?: string;
}

// ─── Webhook request context (passed to template interpolation) ───────────────

export interface WebhookRequestContext {
  body: Record<string, unknown>;
  headers: Record<string, string>;
  query: Record<string, string>;
  /** Raw JSON body string */
  body_raw: string;
  /** The matched webhook config */
  webhook: HHWebhook;
}

// ─── Delivery result ──────────────────────────────────────────────────────────

export interface WebhookDeliveryResult {
  ok: boolean;
  task_id?: string;
  peer?: string;
  task?: string;
  error?: string;
}
