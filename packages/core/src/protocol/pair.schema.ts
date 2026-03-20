import { z } from "zod";

/**
 * CofounderPair — paired node registry format.
 * Created during the `cofounder onboard` / `cofounder pair` flow.
 */
export const CofounderPair = z.object({
  established_at: z.string().datetime(),
  pairing_code_hash: z.string(),
  trusted: z.boolean().default(false),
  last_handshake: z.string().datetime().optional(),
  last_heartbeat: z.string().datetime().optional(),
  h1: z.object({
    name: z.string(),
    emoji: z.string().optional(),
    tailscale_hostname: z.string(),
    tailscale_ip: z.string(),
  }),
  h2: z.object({
    name: z.string(),
    emoji: z.string().optional(),
    tailscale_hostname: z.string(),
    tailscale_ip: z.string(),
    wol_enabled: z.boolean().default(false),
  }),
});
export type CofounderPair = z.infer<typeof CofounderPair>;
