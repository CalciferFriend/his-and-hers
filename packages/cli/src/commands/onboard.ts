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
import { getTailscaleStatus, getTailscalePeers, isTailscaleInstalled } from "@cofounder/core";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── Animated intro ─────────────────────────────────────────────────────────

const WAVE_FRAMES = [
  // Frame 1: arms down
  [
    "    o       o    ",
    "   /|\\     /|\\   ",
    "   / \\     / \\   ",
  ],
  // Frame 2: right person waves up
  [
    "    o      \\o    ",
    "   /|\\      |\\   ",
    "   / \\     / \\   ",
  ],
  // Frame 3: both wave
  [
    "   \\o      \\o    ",
    "    |\\      |\\   ",
    "   / \\     / \\   ",
  ],
  // Frame 4: wave high
  [
    "   \\o/     \\o/   ",
    "    |       |    ",
    "   / \\     / \\   ",
  ],
  // Frame 5: alt wave
  [
    "   \\o       o/   ",
    "    |\\     /|    ",
    "   / \\     / \\   ",
  ],
  // Frame 6: wave high again
  [
    "   \\o/     \\o/   ",
    "    |       |    ",
    "   / \\     / \\   ",
  ],
  // Frame 7: alt wave
  [
    "    o/     \\o    ",
    "   /|       |\\   ",
    "   / \\     / \\   ",
  ],
  // Frame 8: both wave high
  [
    "   \\o/     \\o/   ",
    "    |       |    ",
    "   / \\     / \\   ",
  ],
];

const BANNER = [
  "                 __                       _            ",
  "   ___ ___  / _|___  _   _ _ __   __| | ___ _ __ ",
  "  / __/ _ \\| |_/ _ \\| | | | '_ \\ / _` |/ _ \\ '__|",
  " | (_| (_) |  _| (_) | |_| | | | | (_| |  __/ |   ",
  "  \\___\\___/|_|  \\___/ \\__,_|_| |_|\\__,_|\\___|_|   ",
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function center(text: string, cols: number): string {
  // eslint-disable-next-line no-control-regex -- intentional ANSI escape stripping
  const stripped = text.replace(/\x1B\[[0-9;]*m/g, "");
  const pad = Math.max(0, Math.floor((cols - stripped.length) / 2));
  return " ".repeat(pad) + text;
}

function drawRule(cols: number): string {
  const inner = cols - 4;
  return pc.dim("  " + "\u2500".repeat(Math.max(0, inner)) + "  ");
}

async function playIntroAnimation(): Promise<void> {
  const cols = process.stdout.columns ?? 80;
  const rows = process.stdout.rows ?? 24;
  const clear = "\x1B[2J\x1B[H";
  const hide = "\x1B[?25l"; // hide cursor during animation
  const show = "\x1B[?25h"; // restore cursor

  process.stdout.write(hide);

  // ── Act 1: figures walk in from the edges ────────────────────────────────
  const walkFrames = 8;
  for (let i = 0; i < walkFrames; i++) {
    process.stdout.write(clear);
    const vpad = Math.floor(rows / 2) - 2;
    process.stdout.write("\n".repeat(Math.max(1, vpad)));

    // They start far apart and close in
    const gap = Math.max(1, 14 - i * 2);
    const spacing = " ".repeat(gap);
    const lines = [
      `  o${spacing}o  `,
      ` /|\\${spacing.slice(0, -1)}/|\\`,
      ` / \\${spacing.slice(0, -1)}/ \\`,
    ];
    for (const line of lines) {
      process.stdout.write(center(pc.dim(line), cols) + "\n");
    }
    await sleep(180);
  }

  // ── Act 2: figures wave at you (the user) ────────────────────────────────
  // Repeat wave cycle 3 times for a natural rhythm
  for (let cycle = 0; cycle < 3; cycle++) {
    for (const frame of WAVE_FRAMES) {
      process.stdout.write(clear);
      const vpad = Math.floor(rows / 2) - 2;
      process.stdout.write("\n".repeat(Math.max(1, vpad)));
      for (const line of frame) {
        process.stdout.write(center(pc.cyan(line), cols) + "\n");
      }
      await sleep(280);
    }
  }

  // ── Act 3: hold final pose, breathing dots ───────────────────────────────
  const lastFrame = WAVE_FRAMES[WAVE_FRAMES.length - 1];

  await sleep(500);

  for (let dots = 1; dots <= 3; dots++) {
    process.stdout.write(clear);
    const vpad = Math.floor(rows / 2) - 3;
    process.stdout.write("\n".repeat(Math.max(1, vpad)));
    for (const line of lastFrame) {
      process.stdout.write(center(pc.cyan(line), cols) + "\n");
    }
    process.stdout.write("\n");
    process.stdout.write(center(pc.dim(".".repeat(dots)), cols) + "\n");
    await sleep(600);
  }

  await sleep(800);

  // ── Act 4: banner fades in line by line ──────────────────────────────────
  process.stdout.write(clear);
  process.stdout.write("\n");

  for (let i = 0; i < BANNER.length; i++) {
    process.stdout.write(center(pc.cyan(pc.bold(BANNER[i])), cols) + "\n");
    await sleep(120);
  }

  await sleep(600);

  // Figures appear below banner
  process.stdout.write("\n");
  for (const line of lastFrame) {
    process.stdout.write(center(pc.cyan(line), cols) + "\n");
    await sleep(80);
  }

  await sleep(800);

  // Messages type out
  process.stdout.write("\n");
  const msg1 = "Time to get your cofounders to meet each other.";
  process.stdout.write(center(pc.bold(msg1), cols) + "\n");
  await sleep(1000);

  const msg2 = "This should be an exciting partnership.";
  process.stdout.write(center(pc.white(msg2), cols) + "\n");
  await sleep(1200);

  process.stdout.write("\n");
  process.stdout.write(center(pc.dim("Questions? Email Nic@virlo.ai"), cols) + "\n");
  await sleep(2000);

  // ── Transition: clear to the persistent header ───────────────────────────
  process.stdout.write(clear);
  process.stdout.write(show);
}

function printHeader(): void {
  const cols = process.stdout.columns ?? 80;

  // Compact banner
  for (const line of BANNER) {
    process.stdout.write(center(pc.cyan(pc.bold(line)), cols) + "\n");
  }

  // Figures waving
  const finalFrame = WAVE_FRAMES[WAVE_FRAMES.length - 1];
  process.stdout.write("\n");
  for (const line of finalFrame) {
    process.stdout.write(center(pc.cyan(line), cols) + "\n");
  }

  process.stdout.write("\n");
  process.stdout.write(center(pc.dim("Questions? Email Nic@virlo.ai"), cols) + "\n");
  process.stdout.write("\n");
  process.stdout.write(drawRule(cols) + "\n");
  process.stdout.write("\n");
}

// ── Command ────────────────────────────────────────────────────────────────

export interface OnboardOptions {
  yes?: boolean;
  role?: "h1" | "h2";
  name?: string;
  model?: string;
  peer?: string;
  peerSshUser?: string;
  peerSshKey?: string;
  peerOs?: "linux" | "windows" | "macos";
  wolMac?: string;
  wolBroadcastIp?: string;
}

export async function onboard(options: OnboardOptions = {}) {
  // --yes flag: silent auto-config (all values from flags + auto-detection)
  if (options.yes) {
    return await fastOnboard(options);
  }

  // No TTY (AI agent / piped input): output conversational setup guide
  // The agent relays the questions to the user, collects answers, then re-runs with --yes
  if (!process.stdin.isTTY) {
    return await conversationalOnboard(options);
  }

  // Play the intro animation, then print the persistent header
  if (process.stdout.isTTY) {
    await playIntroAnimation();
  }
  printHeader();

  // Normal interactive wizard
  p.intro(pc.bgCyan(pc.black(" cofounder onboard ")));

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

  p.outro(`Setup complete. Run ${pc.cyan("cofounder status")} to check your pair.`);
}

/**
 * Conversational onboarding mode — for AI agents running without a TTY.
 *
 * Instead of skipping the wizard, this outputs a structured setup guide
 * that the AI agent can relay to the user as a conversation. The agent
 * collects the user's answers and re-runs with `--yes` and the appropriate flags.
 *
 * This preserves the branding and first-run experience even when an AI agent
 * is mediating the setup.
 */
async function conversationalOnboard(options: OnboardOptions) {
  const log = (msg: string) => console.log(msg);

  // ── Branding — the agent should relay this to the user ─────────────────
  log("");
  log("═══════════════════════════════════════════════════════════════");
  log("");
  log("                      c o f o u n d e r");
  log("");
  log("           Two agents. Separate machines. One command.");
  log("");
  log("═══════════════════════════════════════════════════════════════");
  log("");
  log("Welcome! Let's set up cofounder on this machine.");
  log("");
  log("Cofounder connects two AI agents running on physically separate");
  log("machines. One agent (H1) orchestrates — always on, always watching.");
  log("The other (H2) executes — sleeps until needed, wakes on demand,");
  log("does the heavy lifting, disappears when done.");
  log("");
  log("This wizard will configure this machine and pair it with a partner.");
  log("Questions? Email Nic@virlo.ai");
  log("");

  // ── Auto-detect everything we can ──────────────────────────────────────
  log("--- AUTO-DETECTED ENVIRONMENT ---");
  log("");

  const nodeVersion = process.version;
  log(`Node.js:    ${nodeVersion}`);

  const tsInstalled = await isTailscaleInstalled();
  log(`Tailscale:  ${tsInstalled ? "installed" : "NOT INSTALLED — install from https://tailscale.com"}`);

  let tsHostname = "";
  let tsPeers: Array<{ hostname: string; tailscaleIP: string; os: string; online: boolean }> = [];

  if (tsInstalled) {
    const ts = await getTailscaleStatus();
    tsHostname = ts.hostname;
    log(`This node:  ${ts.hostname} (${ts.tailscaleIP}) — ${ts.online ? "online" : "OFFLINE"}`);

    if (ts.online) {
      tsPeers = await getTailscalePeers();
      if (tsPeers.length > 0) {
        log(`Tailscale peers on this network:`);
        for (const peer of tsPeers) {
          log(`  ${peer.online ? "●" : "○"} ${peer.hostname} (${peer.tailscaleIP}) — ${peer.os}`);
        }
      } else {
        log(`No Tailscale peers found. The partner machine needs Tailscale too.`);
      }
    }
  }

  log(`Platform:   ${process.platform}`);
  log(`OpenClaw:   ${(await checkCommandExists("openclaw")) ? "installed" : "not found"}`);

  log("");

  // ── Output the questions the agent should ask ──────────────────────────
  log("--- SETUP QUESTIONS ---");
  log("");
  log("Ask the user these questions to configure cofounder. Use the");
  log("auto-detected values as defaults where available.");
  log("");

  log("1. ROLE — What role should this machine play?");
  log("   Options: h1 (orchestrator — always on, delegates work)");
  log("            h2 (executor — heavy compute, sleeps when idle)");
  if (tsHostname) {
    const suggestedRole = process.platform === "win32" ? "h2" : "h1";
    log(`   Suggested: ${suggestedRole} (based on platform: ${process.platform})`);
  }
  log(`   Flag: --role h1  OR  --role h2`);
  log("");

  log("2. NAME — What should this agent be called?");
  log(`   Default: ${tsHostname || "hostname"}`);
  log(`   Flag: --name <name>`);
  log("");

  log("3. PEER — Which Tailscale machine is the partner?");
  if (tsPeers.length > 0) {
    log("   Available peers:");
    for (const peer of tsPeers) {
      log(`     ${peer.hostname} (${peer.os}, ${peer.online ? "online" : "offline"})`);
    }
  } else {
    log("   No peers detected. The user can provide a Tailscale hostname.");
  }
  log(`   Flag: --peer <hostname>`);
  log("");

  log("4. PEER SSH — How do we connect to the partner via SSH?");
  log(`   SSH user flag:   --peer-ssh-user <username>`);
  log(`   SSH key flag:    --peer-ssh-key <path>`);
  log(`   Peer OS flag:    --peer-os linux|windows|macos`);
  log("");

  log("5. WAKE-ON-LAN (optional) — Can H1 wake H2 from sleep?");
  log("   Only needed if H2 sleeps/shuts down between tasks.");
  log(`   MAC flag:        --wol-mac <AA:BB:CC:DD:EE:FF>`);
  log(`   Broadcast flag:  --wol-broadcast-ip <IP>`);
  log("");

  // ── Output the command to run ──────────────────────────────────────────
  log("--- NEXT STEP ---");
  log("");
  log("After collecting the user's answers, run cofounder onboard with --yes");
  log("and the appropriate flags. Example:");
  log("");

  // Build example command from any flags already provided
  const parts = ["cofounder onboard --yes"];
  parts.push(`--role ${options.role || "<ROLE>"}`);
  parts.push(`--name ${options.name || tsHostname || "<NAME>"}`);
  if (tsPeers.length === 1) {
    parts.push(`--peer ${tsPeers[0].hostname}`);
  } else {
    parts.push(`--peer ${options.peer || "<PEER_HOSTNAME>"}`);
  }
  parts.push(`--peer-ssh-user ${options.peerSshUser || "<SSH_USER>"}`);
  parts.push(`--peer-ssh-key ${options.peerSshKey || "<SSH_KEY_PATH>"}`);

  log(`  ${parts.join(" \\\n    ")}`);
  log("");
  log("The --yes flag runs the full setup non-interactively using the");
  log("provided flags and auto-detected values.");
  log("");
}

async function checkCommandExists(cmd: string): Promise<boolean> {
  try {
    const { execFile: ef } = await import("node:child_process");
    const { promisify: pfy } = await import("node:util");
    await pfy(ef)(cmd, ["--version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fast onboarding mode — fully non-interactive for AI agents and --yes.
 *
 * No @clack/prompts interactive calls (select, confirm, text).
 * Auto-detects Tailscale info, installs soul templates, writes config.
 *
 * Usage:
 *   cofounder onboard --yes --role=h1
 *   cofounder onboard --yes --role=h1 --peer=glados --peer-ssh-user=nicol --peer-ssh-key=~/.ssh/id_ed25519
 *   cofounder onboard --yes --role=h2 --peer=calcifer --wol-mac=D8:5E:D3:04:18:B4
 *
 * Also triggers automatically when stdin is not a TTY (e.g. AI agent execution).
 */
async function fastOnboard(options: OnboardOptions) {
  const log = (msg: string) => console.log(msg);

  log(`${pc.bgCyan(pc.black(" cofounder fast onboard "))} (non-interactive mode)`);

  // Validate options
  const errors = validateFastOnboardOptions(options as FastOnboardOptions);
  if (errors.length > 0) {
    log(pc.red(errors.join("\n")));
    log(pc.red("Fast onboard failed. Use --role=h1 or --role=h2"));
    process.exit(1);
  }

  // ── Prerequisites (non-interactive — just check and fail) ──────────────
  const prereqCheck = await canRunFastMode();
  if (!prereqCheck.ok) {
    log(pc.red(prereqCheck.reason || "Prerequisites not met"));
    process.exit(1);
  }

  // ── Tailscale info (replaces interactive stepWelcome) ──────────────────
  const nodeVersion = process.version;
  log(`${pc.green("✓")} Node.js ${nodeVersion}`);

  const tsInstalled = await isTailscaleInstalled();
  if (!tsInstalled) {
    log(pc.red("✗ Tailscale not installed. Install Tailscale and re-run."));
    process.exit(1);
  }

  const ts = await getTailscaleStatus();
  if (!ts.online) {
    log(pc.red("✗ Tailscale installed but not connected. Run: tailscale up"));
    process.exit(1);
  }
  log(`${pc.green("✓")} Tailscale online as ${pc.cyan(ts.hostname)} (${ts.tailscaleIP})`);

  // ── Build context from defaults + CLI flags ────────────────────────────
  let ctx = createDefaultContext(options as FastOnboardOptions);
  ctx = {
    ...ctx,
    nodeVersion,
    openclawInstalled: true, // already checked by canRunFastMode
    tailscaleOnline: true,
    tailscaleHostname: ts.hostname,
    tailscaleIP: ts.tailscaleIP,
  };

  // If peer hostname is provided, resolve its Tailscale IP from peers list
  if (ctx.peerTailscaleHostname && !ctx.peerTailscaleIP) {
    const peers = await getTailscalePeers();
    const peerEntry = peers.find(
      (peer) => peer.hostname.toLowerCase().startsWith(ctx.peerTailscaleHostname!.toLowerCase())
    );
    if (peerEntry) {
      ctx.peerTailscaleIP = peerEntry.tailscaleIP;
      // Auto-detect peer OS from Tailscale if not explicitly provided
      if (!options.peerOs && peerEntry.os) {
        ctx.peerOS = peerEntry.os === "windows" ? "windows" : peerEntry.os === "macOS" ? "macos" : "linux";
      }
      log(`${pc.green("✓")} Peer ${pc.cyan(ctx.peerTailscaleHostname)} resolved to ${peerEntry.tailscaleIP} (${peerEntry.os})`);
    } else {
      log(pc.yellow(`⚠ Peer "${ctx.peerTailscaleHostname}" not found in Tailscale network`));
    }
  }

  log(`${pc.green("✓")} Role: ${pc.cyan(ctx.role || "unknown")}, Name: ${pc.cyan(ctx.name || "unknown")}`);

  // ── Gateway bind (already non-interactive — uses spinners only) ────────
  try {
    ctx = await stepGatewayBind(ctx);
  } catch (err) {
    log(pc.yellow(`⚠ Gateway config: ${err}`));
  }

  // ── Soul templates (auto-install, no confirm) ──────────────────────────
  try {
    const role = ctx.role!;
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const templatesDir = join(thisDir, "..", "..", "..", "..", "templates");
    const targetDir = join(process.env.HOME ?? process.env.USERPROFILE ?? "~", ".cofounder");
    const files = ["SOUL.md", "IDENTITY.md", "AGENTS.md"];

    await mkdir(targetDir, { recursive: true });

    let installed = 0;
    for (const file of files) {
      const src = join(templatesDir, role, file);
      try {
        const content = await readFile(src, "utf-8");
        const personalized = content
          .replace(/\*\*H1\*\*/g, role === "h1" ? `**${ctx.name}**` : "**H1**")
          .replace(/\*\*H2\*\*/g, role === "h2" ? `**${ctx.name}**` : "**H2**");
        await writeFile(join(targetDir, file), personalized);
        installed++;
      } catch { /* template file not found — skip */ }
    }
    ctx.soulTemplateCopied = installed > 0;
    log(`${pc.green("✓")} ${installed} template(s) installed to ${targetDir}`);
  } catch {
    ctx.soulTemplateCopied = false;
    log(pc.yellow("⚠ Could not install soul templates"));
  }

  // ── Finalize (already non-interactive — writes config, prints summary) ─
  try {
    ctx = await stepFinalize(ctx);
  } catch (err) {
    log(pc.red(`Failed to write config: ${err}`));
    process.exit(1);
  }

  log("");
  log(pc.green(`Node configured as ${ctx.role} — ${ctx.name}`));
  if (ctx.peerTailscaleHostname) {
    log(`Peer: ${ctx.peerTailscaleHostname} (${ctx.peerTailscaleIP || "IP not resolved"})`);
  } else {
    log(`No peer configured. Run ${pc.cyan("cofounder pair --code <code>")} to pair later.`);
  }
  log(`Run ${pc.cyan("cofounder status")} to check configuration.`);
}
