/**
 * schedule/schema.ts
 *
 * Zod schema for HHSchedule entries stored in ~/.cofounder/schedules.json
 */

import { z } from "zod";

export const HHSchedule = z.object({
  id: z.string(), // uuid
  cron: z.string(), // cron expression e.g. "0 2 * * *"
  task: z.string(), // task description to delegate
  peer: z.string().optional(), // optional peer name (--peer flag in cofounder send)
  latent: z.boolean().optional(), // use latent mode if supported
  name: z.string().optional(), // optional human-friendly label
  created_at: z.string(), // ISO timestamp
  last_run: z.string().optional(), // ISO of last execution
  next_run: z.string().optional(), // ISO of next expected run
  enabled: z.boolean(), // schedule is active
  notify_webhook: z.string().optional(), // Discord/Slack/generic webhook URL for completion notifications
});

export type HHSchedule = z.infer<typeof HHSchedule>;

export const HHScheduleList = z.array(HHSchedule);
export type HHScheduleList = z.infer<typeof HHScheduleList>;
