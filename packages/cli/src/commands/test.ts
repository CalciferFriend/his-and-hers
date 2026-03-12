/**
 * commands/test.ts — `hh test`
 *
 * End-to-end connectivity validator.
 *
 * Flow:
 *   1. Load config — error if not configured
 *   2. Resolve peer (--peer <name>)
 *   Step 1 — Tailscale reachability: ping peer tailscale IP
 *   Step 2 — Gateway health: check /health endpoint
 *   Step 3 — Round-trip message: send a TJWakeMessage, measure RTT
 *   3. Print summary table (green ✓ pass / red ✗ fail)
 *   4. Exit code 0 if all pass, 1 if any fail
 *   5. --json: output results as JSON
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { loadConfig } from "../config/store.ts";
import { getPeer, formatPeerList } from "../peers/select.ts";
import { pingPeer, checkGatewayHealth, createWakeMessage, wakeAgent } from "@his-and-hers/core";

export interface TestOptions {
  peer?: string;
  json?: boolean;
}

interface StepResult {
  step: string;
  passed: boolean;
  rttMs?: number;
  error?: string;
}

export async function tjTest(opts: TestOptions = {}) {
  const config = await loadConfig();

  if (!config) {
    p.log.error("No configuration found. Run `hh onboard` first.");
    process.exit(1);
  }

  let peer;
  try {
    peer = getPeer(config, opts.peer);
  } catch (err) {
    p.log.error(String(err));
    if ((config.peer_nodes ?? []).length > 0) {
      p.log.info(`Available peers:\n${formatPeerList(config)}`);
    }
    process.exit(1);
  }

  if (!opts.json) {
    p.intro(
      `${pc.bold("HH Connectivity Test")} → ${peer.emoji ?? ""} ${peer.name} (${peer.tailscale_ip})`,
    );
  }

  const results: StepResult[] = [];
  const peerPort = peer.gateway_port ?? 18789;

  // ── Step 1: Tailscale reachability ────────────────────────────────────────
  const step1: StepResult = { step: "Tailscale reachability", passed: false };
  if (!opts.json) {
    const s = p.spinner();
    s.start(`Step 1 — pinging ${peer.tailscale_ip}...`);
    const t0 = Date.now();
    const reachable = await pingPeer(peer.tailscale_ip, 5000);
    step1.rttMs = Date.now() - t0;
    step1.passed = reachable;
    if (!reachable) {
      step1.error = `${peer.name} is unreachable on Tailscale`;
      s.stop(pc.red(`✗ ${peer.name} is not reachable (${step1.rttMs}ms)`));
    } else {
      s.stop(pc.green(`✓ ${peer.name} is reachable (${step1.rttMs}ms)`));
    }
  } else {
    const t0 = Date.now();
    const reachable = await pingPeer(peer.tailscale_ip, 5000);
    step1.rttMs = Date.now() - t0;
    step1.passed = reachable;
    if (!reachable) step1.error = `${peer.name} is unreachable on Tailscale`;
  }
  results.push(step1);

  // ── Step 2: Gateway health ────────────────────────────────────────────────
  const step2: StepResult = { step: "Gateway health", passed: false };
  const healthUrl = `http://${peer.tailscale_ip}:${peerPort}/health`;
  if (!opts.json) {
    const s = p.spinner();
    s.start(`Step 2 — checking gateway at ${healthUrl}...`);
    const t0 = Date.now();
    const healthy = await checkGatewayHealth(healthUrl);
    step2.rttMs = Date.now() - t0;
    step2.passed = healthy;
    if (!healthy) {
      step2.error = `Gateway at ${healthUrl} is not healthy`;
      s.stop(pc.red(`✗ Gateway not healthy (${step2.rttMs}ms)`));
    } else {
      s.stop(pc.green(`✓ Gateway healthy (${step2.rttMs}ms)`));
    }
  } else {
    const t0 = Date.now();
    const healthy = await checkGatewayHealth(healthUrl);
    step2.rttMs = Date.now() - t0;
    step2.passed = healthy;
    if (!healthy) step2.error = `Gateway at ${healthUrl} is not healthy`;
  }
  results.push(step2);

  // ── Step 3: Round-trip wake message ───────────────────────────────────────
  const step3: StepResult = { step: "Round-trip wake message", passed: false };
  if (!peer.gateway_token) {
    step3.error = "No gateway token — run `hh pair` first";
    step3.passed = false;
    if (!opts.json) {
      p.log.warn(`Step 3 — ${pc.yellow("skipped")} (no gateway token)`);
    }
  } else {
    const wakeMsg = createWakeMessage(
      config.this_node.name,
      peer.name,
      "hh test connectivity check",
    );
    const wakeText = `[HHMessage:wake from ${wakeMsg.from} id=${wakeMsg.id}] connectivity test`;

    if (!opts.json) {
      const s = p.spinner();
      s.start(`Step 3 — sending round-trip wake to ${peer.name}...`);
      const t0 = Date.now();
      const wakeResult = await wakeAgent({
        url: `ws://${peer.tailscale_ip}:${peerPort}`,
        token: peer.gateway_token,
        text: wakeText,
        mode: "now",
      });
      step3.rttMs = Date.now() - t0;
      step3.passed = wakeResult.ok;
      if (!wakeResult.ok) {
        step3.error = wakeResult.error ?? "wake delivery failed";
        s.stop(pc.red(`✗ Round-trip failed: ${step3.error} (${step3.rttMs}ms)`));
      } else {
        s.stop(pc.green(`✓ Round-trip successful (${step3.rttMs}ms)`));
      }
    } else {
      const t0 = Date.now();
      const wakeResult = await wakeAgent({
        url: `ws://${peer.tailscale_ip}:${peerPort}`,
        token: peer.gateway_token,
        text: wakeText,
        mode: "now",
      });
      step3.rttMs = Date.now() - t0;
      step3.passed = wakeResult.ok;
      if (!wakeResult.ok) step3.error = wakeResult.error ?? "wake delivery failed";
    }
  }
  results.push(step3);

  // ── Output ────────────────────────────────────────────────────────────────
  const allPassed = results.every((r) => r.passed);

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          peer: peer.name,
          tailscale_ip: peer.tailscale_ip,
          passed: allPassed,
          steps: results,
        },
        null,
        2,
      ),
    );
    process.exit(allPassed ? 0 : 1);
    return;
  }

  // Summary table
  console.log();
  console.log(pc.bold("  Summary"));
  console.log(pc.dim("  ─────────────────────────────────────────────────"));
  const COL_STEP = 28;
  const COL_STATUS = 8;
  const COL_RTT = 10;
  for (const r of results) {
    const status = r.passed
      ? pc.green("✓ pass")
      : pc.red("✗ fail");
    const rtt = r.rttMs !== undefined ? pc.dim(`${r.rttMs}ms`) : pc.dim("—");
    const stepLabel = r.step.padEnd(COL_STEP);
    const statusLabel = status.padEnd(COL_STATUS);
    const rttLabel = rtt.padEnd(COL_RTT);
    console.log(`  ${stepLabel} ${statusLabel} ${rttLabel}`);
    if (!r.passed && r.error) {
      console.log(`    ${pc.dim("→")} ${pc.red(r.error)}`);
    }
  }
  console.log(pc.dim("  ─────────────────────────────────────────────────"));

  if (allPassed) {
    p.outro(pc.green("All checks passed! ✓"));
  } else {
    p.outro(pc.red("Some checks failed. See above for details."));
  }

  process.exit(allPassed ? 0 : 1);
}
