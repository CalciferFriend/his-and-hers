import { z } from "zod";

/**
 * CofounderHandoff — structured task handoff format.
 * H1 sends this to H2 when delegating work.
 */
export const CofounderHandoff = z.object({
  task_id: z.string().uuid(),
  from_role: z.enum(["h1", "h2"]),
  to_role: z.enum(["h1", "h2"]),
  objective: z.string(),
  context: z.string().optional(),
  constraints: z.array(z.string()).default([]),
  expected_output: z.string().optional(),
  timeout_seconds: z.number().int().positive().optional(),
  wake_if_sleeping: z.boolean().default(true),
  shutdown_when_done: z.boolean().default(false),
});
export type CofounderHandoff = z.infer<typeof CofounderHandoff>;
