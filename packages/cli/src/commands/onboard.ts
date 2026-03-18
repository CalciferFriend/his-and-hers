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
import { stepFirewall } from "../wizard/steps/firewall.ts";
import { stepStartup } from "../wizard/steps/startup.ts";
import { stepSoul } from "../wizard/steps/soul.ts";
import { stepValidate } from "../wizard/steps/validate.ts";
import { stepFinalize } from "../wizard/steps/finalize.ts";
import {
  createDefaultContext,
  validateFastOnboardOptions,
  canRunFastMode,
  type FastOnboardOptions
} from "../wizard/defaults.ts";

export interface OnboardOptions {
  yes?: boolean;
  role?: "h1" | "h2";
  name?: string;
  model?: string;
  peer?: string;
}

export async function onboard(options: OnboardOptions = {}) {
  // Fast onboarding mode (--yes)
  if (options.yes) {
    return await fastOnboard(options);
  }

  // Normal interactive wizard
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

  // Step 9: Firewall — Windows inbound rule for gateway port (H2/Windows only)
  ctx = await stepFirewall(ctx);

  // Step 10: Startup — install gateway + watch daemon startup script on H2
  ctx = await stepStartup(ctx);

  // Step 11: Soul — install SOUL.md / IDENTITY.md templates
  ctx = await stepSoul(ctx);

  // Step 12: Validate — full round-trip connectivity test
  ctx = await stepValidate(ctx);

  // Step 13: Finalize — write config, generate pairing code, print summary
  ctx = await stepFinalize(ctx);

  p.outro(`Setup complete. Run ${pc.cyan("hh status")} to check your pair.`);
}

/**
 * Fast onboarding mode - non-interactive setup with sane defaults
 * Usage: hh onboard --yes --role=h1 --name=Alice --model=sonnet
 */
async function fastOnboard(options: OnboardOptions) {
  p.intro(pc.bgCyan(pc.black(" his-and-hers fast onboard ")));

  // Validate options
  const errors = validateFastOnboardOptions(options as FastOnboardOptions);
  if (errors.length > 0) {
    p.log.error(errors.join("\n"));
    p.outro(pc.red("Fast onboard failed. Use --role=h1 or --role=h2"));
    process.exit(1);
  }

  // Check prerequisites
  const prereqCheck = await canRunFastMode();
  if (!prereqCheck.ok) {
    p.log.error(prereqCheck.reason || "Prerequisites not met");
    p.outro(pc.red("Fast onboard failed"));
    process.exit(1);
  }

  // Create default context
  const spinner = p.spinner();
  spinner.start("Configuring with defaults...");

  let ctx = createDefaultContext(options as FastOnboardOptions);

  // Run minimal required steps
  try {
    // Step 1: Welcome (just gather system info, no prompts)
    ctx = await stepWelcome(ctx);

    // Skip steps 2-3 (role, identity) - already set via defaults
    spinner.message("Configuring gateway...");

    // Step 7: Gateway bind (auto-configure based on role)
    ctx = await stepGatewayBind(ctx);

    // Step 11: Soul templates (install defaults)
    spinner.message("Installing templates...");
    ctx = await stepSoul(ctx);

    // Step 13: Finalize (write config, skip pairing code for now)
    spinner.message("Writing config...");
    ctx = await stepFinalize(ctx);

    spinner.stop("Configuration complete!");

    // Success message
    p.log.success(`Node configured as ${pc.cyan(ctx.role || "unknown")} - ${pc.cyan(ctx.name || "unknown")}`);
    p.log.info(`To pair with a remote node, exchange pairing codes or run ${pc.cyan("hh pair --code <code>")}`);
    p.outro(`Run ${pc.cyan("hh status")} to check configuration`);

  } catch (error) {
    spinner.stop("Failed");
    p.log.error(String(error));
    p.outro(pc.red("Fast onboard failed"));
    process.exit(1);
  }
}
