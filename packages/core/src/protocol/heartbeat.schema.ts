import { z } from "zod";

/**
 * CofounderHeartbeat — periodic liveness ping between paired nodes.
 */
export const CofounderHeartbeat = z.object({
  from: z.string(),
  role: z.enum(["h1", "h2"]),
  tailscale_ip: z.string(),
  gateway_port: z.number().int().default(18789),
  gateway_healthy: z.boolean(),
  uptime_seconds: z.number().nonnegative(),
  timestamp: z.string().datetime(),
});
export type CofounderHeartbeat = z.infer<typeof CofounderHeartbeat>;
