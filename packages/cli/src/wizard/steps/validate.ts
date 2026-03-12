import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  pingPeer,
  testSSH,
  checkGatewayHealth,
  sendMagicPacket,
  waitForPeer,
} from "@his-and-hers/core";
import { isCancelled, type WizardContext } from "../context.ts";

interface CheckResult {
  name: string;
  pass: boolean;
  skip?: boolean;
  detail?: string;
}

export async function stepValidate(ctx: Partial<WizardContext>): Promise<Partial<WizardContext>> {
  const runValidation = await p.confirm({
    message: "Run full connectivity validation?",
    initialValue: true,
  });

  if (isCancelled(runValidation)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  if (!runValidation) {
    p.log.warn("Skipping validation — you can run `tj doctor` later to check.");
    return { ...ctx, validationPassed: false };
  }

  p.log.info(`${pc.bold("Full round-trip validation:")}`);

  const results: CheckResult[] = [];
  const peerIP = ctx.peerTailscaleIP!;
  const gwPort = ctx.peerGatewayPort ?? 18789;
  const healthEndpoint = `http://${peerIP}:${gwPort}/health`;

  // Step 1: WOL (if enabled and peer is unreachable)
  if (ctx.wolEnabled) {
    const spinner = p.spinner();
    spinner.start("1/5 — Checking if peer needs waking...");

    const alreadyUp = await pingPeer(peerIP);

    if (alreadyUp) {
      spinner.stop(`${pc.green("✓")} Peer already online — skipping WOL.`);
      results.push({ name: "WOL", pass: true, skip: true, detail: "Peer already online" });
    } else {
      spinner.stop("Peer offline — sending magic packet...");

      const wolSpinner = p.spinner();
      wolSpinner.start("1/5 — WOL: Sending magic packet and waiting for boot...");

      try {
        await sendMagicPacket({
          mac: ctx.wolMAC!,
          broadcastIP: ctx.wolBroadcastIP!,
          port: ctx.wolRouterPort,
        });

        const peerUp = await waitForPeer(peerIP, {
          intervalMs: (ctx.wolPollIntervalSeconds ?? 2) * 1000,
          maxAttempts: Math.ceil((ctx.wolTimeoutSeconds ?? 120) / (ctx.wolPollIntervalSeconds ?? 2)),
        });

        if (peerUp) {
          wolSpinner.stop(`${pc.green("✓")} WOL: Peer woke up and is reachable.`);
          results.push({ name: "WOL", pass: true });
        } else {
          wolSpinner.stop(`${pc.red("✗")} WOL: Peer did not come online within timeout.`);
          results.push({ name: "WOL", pass: false, detail: "Timed out waiting for peer" });
        }
      } catch (err) {
        wolSpinner.stop(`${pc.red("✗")} WOL: Failed to send magic packet.`);
        results.push({ name: "WOL", pass: false, detail: String(err) });
      }
    }
  } else {
    results.push({ name: "WOL", pass: true, skip: true, detail: "Not configured" });
  }

  // Step 2: Tailscale ping
  const s2 = p.spinner();
  s2.start("2/5 — Tailscale ping...");
  const pingOk = await pingPeer(peerIP);
  if (pingOk) {
    s2.stop(`${pc.green("✓")} Tailscale ping: Peer reachable.`);
  } else {
    s2.stop(`${pc.red("✗")} Tailscale ping: Peer unreachable.`);
  }
  results.push({ name: "Tailscale ping", pass: pingOk });

  // Step 3: SSH
  const s3 = p.spinner();
  s3.start("3/5 — SSH connection...");
  const sshOk = await testSSH({
    host: peerIP,
    user: ctx.peerSSHUser!,
    keyPath: ctx.peerSSHKeyPath!,
  });
  if (sshOk) {
    s3.stop(`${pc.green("✓")} SSH: Connection successful.`);
  } else {
    s3.stop(`${pc.red("✗")} SSH: Connection failed.`);
  }
  results.push({ name: "SSH", pass: sshOk });

  // Step 4: Gateway health
  const s4 = p.spinner();
  s4.start("4/5 — Gateway health check...");
  const gwOk = await checkGatewayHealth(healthEndpoint);
  if (gwOk) {
    s4.stop(`${pc.green("✓")} Gateway: ${healthEndpoint} is healthy.`);
  } else {
    s4.stop(`${pc.red("✗")} Gateway: ${healthEndpoint} not responding.`);
  }
  results.push({ name: "Gateway health", pass: gwOk });

  // Step 5: Summary
  const allPassed = results.filter((r) => !r.skip).every((r) => r.pass);
  const skipped = results.filter((r) => r.skip).length;
  const failed = results.filter((r) => !r.pass && !r.skip);

  p.log.info("");
  p.log.info(pc.bold("Validation summary:"));
  for (const r of results) {
    const icon = r.skip ? pc.dim("○") : r.pass ? pc.green("✓") : pc.red("✗");
    const detail = r.detail ? pc.dim(` (${r.detail})`) : "";
    p.log.info(`  ${icon} ${r.name}${detail}`);
  }
  p.log.info("");

  if (allPassed) {
    p.log.success("All checks passed.");
  } else {
    p.log.warn(`${failed.length} check(s) failed. Run \`tj doctor\` for detailed diagnostics.`);
  }

  return { ...ctx, validationPassed: allPassed };
}
