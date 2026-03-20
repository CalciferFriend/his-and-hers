import * as p from "@clack/prompts";
import pc from "picocolors";
import { execFile, exec } from "node:child_process";
import { promisify } from "node:util";
import { getTailscaleStatus, isTailscaleInstalled, getTailscaleVersion } from "@cofounder/core";
import { isCancelled, type WizardContext } from "../context.ts";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

async function checkCommand(cmd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: 5000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Platform-specific Tailscale install helpers ────────────────────────────

async function tryAutoInstallTailscale(): Promise<boolean> {
  const platform = process.platform;

  if (platform === "linux") {
    try {
      // The official one-liner
      await execAsync("curl -fsSL https://tailscale.com/install.sh | sh", { timeout: 120_000 });
      return true;
    } catch {
      return false;
    }
  }

  if (platform === "darwin") {
    // Try brew
    try {
      await execFileAsync("brew", ["install", "--cask", "tailscale"], { timeout: 120_000 });
      return true;
    } catch {
      return false;
    }
  }

  if (platform === "win32") {
    // Try winget
    try {
      await execFileAsync("winget", ["install", "--id", "Tailscale.Tailscale", "-e", "--accept-source-agreements", "--accept-package-agreements"], { timeout: 120_000 });
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

function getManualInstallGuide(): string[] {
  const platform = process.platform;

  if (platform === "win32") {
    return [
      "",
      `  ${pc.bold("Option A:")} ${pc.cyan("winget install Tailscale.Tailscale")}`,
      `  ${pc.bold("Option B:")} Download from ${pc.cyan("https://tailscale.com/download/windows")}`,
      "",
      "  After installing, click the Tailscale icon in the system tray and sign in.",
      "  If you don't have an account, it's free — sign up with Google, Microsoft, or GitHub.",
    ];
  }
  if (platform === "darwin") {
    return [
      "",
      `  ${pc.bold("Option A:")} ${pc.cyan("brew install --cask tailscale")}`,
      `  ${pc.bold("Option B:")} Download from the App Store (search "Tailscale")`,
      "",
      "  After installing, open Tailscale from Applications and sign in.",
    ];
  }
  return [
    "",
    `  Run: ${pc.cyan("curl -fsSL https://tailscale.com/install.sh | sh")}`,
    `  Then: ${pc.cyan("sudo tailscale up")}`,
    "",
    "  Follow the URL it prints to authenticate in your browser.",
    "  If you don't have an account, it's free — sign up with Google, Microsoft, or GitHub.",
  ];
}

function getConnectGuide(): string[] {
  const platform = process.platform;

  if (platform === "win32") {
    return [
      "  Click the Tailscale icon in your system tray and click \"Connect\".",
      "  If you don't see it, search for \"Tailscale\" in the Start menu.",
      "  Sign in if prompted — Google, Microsoft, or GitHub all work.",
    ];
  }
  if (platform === "darwin") {
    return [
      `  Open the Tailscale app from your menu bar, or run:`,
      `  ${pc.cyan("sudo tailscale up")}`,
    ];
  }
  return [
    `  Run: ${pc.cyan("sudo tailscale up")}`,
    "  Follow the URL it prints to authenticate in your browser.",
  ];
}

// ── Main step ──────────────────────────────────────────────────────────────

export async function stepWelcome(ctx: Partial<WizardContext>): Promise<Partial<WizardContext>> {
  p.note(
    `This wizard will configure this machine as a H1 (orchestrator) or H2 (executor) node,\n` +
    `then pair it with a machine running the other role.\n\n` +
    `Cofounder uses ${pc.cyan("Tailscale")} (free, encrypted mesh VPN) to connect your machines.\n` +
    `We'll help you get it set up if you don't have it yet.`,
    "Welcome to cofounder"
  );

  const spinner = p.spinner();
  spinner.start("Checking prerequisites...");

  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.slice(1), 10);
  const ocVersion = await checkCommand("openclaw", ["--version"]);
  const openclawInstalled = ocVersion !== null;
  let tsInstalled = await isTailscaleInstalled();

  spinner.stop("Prerequisites checked.");

  // ── Node check ───────────────────────────────────────────────────────────
  const nodeOk = nodeMajor >= 22;
  p.log.info(`${nodeOk ? pc.green("✓") : pc.red("✗")} Node.js ${nodeVersion} ${nodeOk ? "" : "(need >= 22)"}`);

  if (!nodeOk) {
    p.log.error("Node.js >= 22 is required. Please upgrade and try again.");
    process.exit(1);
  }

  // ── OpenClaw check ───────────────────────────────────────────────────────
  p.log.info(`${openclawInstalled ? pc.green("✓") : pc.yellow("!")} OpenClaw ${ocVersion ?? "not found (optional but recommended)"}`);

  // ── Tailscale: not installed ─────────────────────────────────────────────
  if (!tsInstalled) {
    p.log.info(`${pc.red("✗")} Tailscale — not installed`);

    p.note(
      `Tailscale is a free mesh VPN that connects your machines with zero config.\n` +
      `It works across home networks, cloud servers, and even mobile.\n` +
      `Sign up at ${pc.cyan("https://tailscale.com")} — free for up to 100 devices.`,
      "What is Tailscale?"
    );

    const installChoice = await p.select({
      message: "How would you like to install Tailscale?",
      options: [
        { value: "auto", label: "Install it for me", hint: "we'll run the installer now" },
        { value: "manual", label: "Show me how", hint: "I'll install it myself" },
        { value: "installed", label: "I already installed it", hint: "just not in PATH yet" },
        { value: "skip", label: "Skip for now", hint: "I'll set it up later" },
      ],
    });

    if (isCancelled(installChoice)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    if (installChoice === "auto") {
      const installSpinner = p.spinner();
      installSpinner.start("Installing Tailscale... (this may take a minute)");
      const ok = await tryAutoInstallTailscale();
      if (ok) {
        installSpinner.stop(`${pc.green("✓")} Tailscale installed!`);
        tsInstalled = true;
      } else {
        installSpinner.stop(`${pc.yellow("!")} Auto-install didn't work on this system.`);
        p.log.info("No worries — here's how to install manually:\n");
        for (const line of getManualInstallGuide()) {
          p.log.message(line);
        }
      }
    } else if (installChoice === "manual") {
      p.note(getManualInstallGuide().join("\n"), "Install Tailscale");
    } else if (installChoice === "skip") {
      p.log.info(
        "You can set up Tailscale later and re-run " + pc.cyan("cofounder onboard") + ".\n" +
        "Without it, your machines won't be able to find each other."
      );
      process.exit(0);
    }

    // ── Wait for user to finish installing ──────────────────────────────
    if (!tsInstalled) {
      const ready = await p.confirm({
        message: "Have you finished installing Tailscale?",
        initialValue: false,
      });

      if (isCancelled(ready) || !ready) {
        p.log.info("No rush. Re-run " + pc.cyan("cofounder onboard") + " when you're ready.");
        process.exit(0);
      }

      // Poll a few times
      const retrySpinner = p.spinner();
      retrySpinner.start("Looking for Tailscale...");

      for (let attempt = 0; attempt < 3; attempt++) {
        tsInstalled = await isTailscaleInstalled();
        if (tsInstalled) break;
        await sleep(2000);
      }

      if (!tsInstalled) {
        retrySpinner.stop(`${pc.red("✗")} Still can't find the ${pc.cyan("tailscale")} command.`);
        p.log.error(
          "Make sure Tailscale is installed and in your PATH.\n" +
          "You may need to restart your terminal after installing.\n" +
          "Then re-run " + pc.cyan("cofounder onboard")
        );
        process.exit(1);
      }
      retrySpinner.stop(`${pc.green("✓")} Tailscale found!`);
    }
  } else {
    const tsVersion = await getTailscaleVersion();
    p.log.info(`${pc.green("✓")} Tailscale ${tsVersion ?? ""} installed`);
  }

  // ── Tailscale: installed but not connected ───────────────────────────────
  let ts = await getTailscaleStatus();

  if (!ts.online) {
    p.log.info(`${pc.yellow("!")} Tailscale is installed but not connected.`);
    p.note(getConnectGuide().join("\n"), "Connect to Tailscale");

    const retryOnline = await p.confirm({
      message: "Have you connected? Ready to continue?",
      initialValue: false,
    });

    if (isCancelled(retryOnline) || !retryOnline) {
      p.log.info("Connect Tailscale, then re-run " + pc.cyan("cofounder onboard"));
      process.exit(0);
    }

    // Poll for connection
    const onlineSpinner = p.spinner();
    onlineSpinner.start("Waiting for Tailscale to come online...");

    for (let attempt = 0; attempt < 10; attempt++) {
      ts = await getTailscaleStatus();
      if (ts.online) break;
      await sleep(2000);
    }

    if (!ts.online) {
      onlineSpinner.stop(`${pc.red("✗")} Tailscale still not connected.`);
      p.log.error("Cannot proceed without an active Tailscale connection. Re-run when ready.");
      process.exit(1);
    }
    onlineSpinner.stop(`${pc.green("✓")} Tailscale online as ${pc.cyan(ts.hostname)} (${ts.tailscaleIP})`);
  } else {
    p.log.info(`${pc.green("✓")} Tailscale online as ${pc.cyan(ts.hostname)} (${ts.tailscaleIP})`);
  }

  return {
    ...ctx,
    nodeVersion,
    openclawInstalled,
    tailscaleOnline: true,
    tailscaleHostname: ts.hostname,
    tailscaleIP: ts.tailscaleIP,
  };
}
