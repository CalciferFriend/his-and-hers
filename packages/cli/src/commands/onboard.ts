import * as p from "@clack/prompts";
import pc from "picocolors";
import { createEmptyContext } from "../wizard/context.ts";
import { stepWelcome } from "../wizard/steps/welcome.ts";
import { stepRole } from "../wizard/steps/role.ts";
import { stepIdentity } from "../wizard/steps/identity.ts";
import { stepProvider } from "../wizard/steps/provider.ts";
import { stepPeer } from "../wizard/steps/peer.ts";
import { stepWOL } from "../wizard/steps/wol.ts";
import { stepGatewayBind } from "../wizard/steps/gateway_bind.ts";
import { stepAutologin } from "../wizard/steps/autologin.ts";
import { stepStartup } from "../wizard/steps/startup.ts";
import { stepSoul } from "../wizard/steps/soul.ts";
import { stepValidate } from "../wizard/steps/validate.ts";
import { stepFinalize } from "../wizard/steps/finalize.ts";

export async function onboard() {
  p.intro(pc.bgCyan(pc.black(" his-and-hers onboard ")));

  let ctx = createEmptyContext();

  // Step 1: Welcome — version check, OpenClaw check, Tailscale check
  ctx = await stepWelcome(ctx);

  // Step 2: Role — h1 or h2
  ctx = await stepRole(ctx);

  // Step 3: Identity — name, emoji, persona
  ctx = await stepIdentity(ctx);

  // Step 4: Provider — LLM provider + API key → keychain
  ctx = await stepProvider(ctx);

  // Step 5: Peer — remote node connection details
  ctx = await stepPeer(ctx);

  // Step 6: WOL — Wake-on-LAN config if H2 sleeps
  ctx = await stepWOL(ctx);

  // Step 7: Gateway bind — bind mode for both nodes
  ctx = await stepGatewayBind(ctx);

  // Step 8: AutoLogin — Windows registry for headless WOL boot
  ctx = await stepAutologin(ctx);

  // Step 9: Startup — install gateway startup script on H2
  ctx = await stepStartup(ctx);

  // Step 10: Soul — install SOUL.md / IDENTITY.md templates
  ctx = await stepSoul(ctx);

  // Step 11: Validate — full round-trip connectivity test
  ctx = await stepValidate(ctx);

  // Step 12: Finalize — write config, generate pairing code, print summary
  ctx = await stepFinalize(ctx);

  p.outro(`Setup complete. Run ${pc.cyan("hh status")} to check your pair.`);
}
