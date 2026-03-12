import * as p from "@clack/prompts";
import pc from "picocolors";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getTailscaleStatus } from "@his-and-hers/core";
import type { WizardContext } from "../context.ts";

const execFileAsync = promisify(execFile);

async function checkCommand(cmd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: 5000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function stepWelcome(ctx: Partial<WizardContext>): Promise<Partial<WizardContext>> {
  p.note(
    `This wizard will configure this machine as a Tom (orchestrator) or Jerry (executor) node,\n` +
    `then pair it with a machine running the other role.\n\n` +
    `Both machines must have Tailscale installed and connected to the same tailnet.`,
    "Welcome to his-and-hers"
  );

  const spinner = p.spinner();
  spinner.start("Checking prerequisites...");

  // Node version
  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.slice(1), 10);

  // OpenClaw check
  const ocVersion = await checkCommand("openclaw", ["--version"]);
  const openclawInstalled = ocVersion !== null;

  // Tailscale check
  const ts = await getTailscaleStatus();

  spinner.stop("Prerequisites checked.");

  // Report results
  const nodeOk = nodeMajor >= 22;
  p.log.info(`${nodeOk ? pc.green("✓") : pc.red("✗")} Node.js ${nodeVersion} ${nodeOk ? "" : "(need >= 22)"}`);
  p.log.info(`${openclawInstalled ? pc.green("✓") : pc.yellow("!")} OpenClaw ${ocVersion ?? "not found (optional but recommended)"}`);
  p.log.info(`${ts.online ? pc.green("✓") : pc.red("✗")} Tailscale ${ts.online ? `online as ${pc.cyan(ts.hostname)} (${ts.tailscaleIP})` : "not running"}`);

  if (!nodeOk) {
    p.log.error("Node.js >= 22 is required. Please upgrade and try again.");
    process.exit(1);
  }

  if (!ts.online) {
    p.log.error("Tailscale must be running and connected. Start Tailscale and try again.");
    process.exit(1);
  }

  return {
    ...ctx,
    nodeVersion,
    openclawInstalled,
    tailscaleOnline: ts.online,
    tailscaleHostname: ts.hostname,
    tailscaleIP: ts.tailscaleIP,
  };
}
