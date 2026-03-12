import { z } from "zod";

/**
 * HHPair — paired node registry format.
 * Created during the `hh onboard` / `hh pair` flow.
 */
export const HHPair = z.object({
  established_at: z.string().datetime(),
  pairing_code_hash: z.string(),
  trusted: z.boolean().default(false),
  last_handshake: z.string().datetime().optional(),
  last_heartbeat: z.string().datetime().optional(),
  tom: z.object({
    name: z.string(),
    emoji: z.string().optional(),
    tailscale_hostname: z.string(),
    tailscale_ip: z.string(),
  }),
  jerry: z.object({
    name: z.string(),
    emoji: z.string().optional(),
    tailscale_hostname: z.string(),
    tailscale_ip: z.string(),
    wol_enabled: z.boolean().default(false),
  }),
});
export type HHPair = z.infer<typeof HHPair>;
