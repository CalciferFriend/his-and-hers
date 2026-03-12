import { z } from "zod";

/**
 * HHHandoff — structured task handoff format.
 * Tom sends this to Jerry when delegating work.
 */
export const HHHandoff = z.object({
  task_id: z.string().uuid(),
  from_role: z.enum(["tom", "jerry"]),
  to_role: z.enum(["tom", "jerry"]),
  objective: z.string(),
  context: z.string().optional(),
  constraints: z.array(z.string()).default([]),
  expected_output: z.string().optional(),
  timeout_seconds: z.number().int().positive().optional(),
  wake_if_sleeping: z.boolean().default(true),
  shutdown_when_done: z.boolean().default(false),
});
export type HHHandoff = z.infer<typeof HHHandoff>;
