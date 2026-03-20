/**
 * commands/doctor.ts — `cofounder doctor`
 *
 * Comprehensive health diagnostics for a cofounder node.
 * Checks local + all configured peers and gives actionable remediation hints.
 *
 * Features:
 *   - Local gateway health (this node)
 *   - Tailscale reachability for every peer
 *   - SSH connectivity per peer
 *   - Peer gateway health per peer
 *   - WOL readiness
 *   - Capabilities scan freshness
 *   - Summary with pass/warn/fail counts
 *
 * Usage:
 *   cofounder doctor
 *   cofounder doctor --peer glados   # focus on one peer
 *   cofounder doctor --json          # machine-readable output
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { loadConfig } from "../config/store.ts";
import {
  getTailscaleStatus,
  pingPeer,
  testSSH,
  checkGatewayHealth,
  loadCapabilities,
  loadPeerCapabilities,
  isPeerCapabilityStale,
} from "@cofounder/core";
import { getAllPeers, findPeerByName } from "../peers/select.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CheckStatus = "pass" | "warn" | "fail" | "skip";

interface DoctorCheck {
  name: string;
  status: CheckStatus;
  detail?: string;
  hint?: string;
}

interface DoctorReport {
  checks: DoctorCheck[];
  passed: number;
  warned: number;
  failed: number;
  skipped: number;
  healthy: boolean;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface DoctorOptions {
  peer?: string;
  json?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function icon(status: CheckStatus): string {
  switch (status) {
    case "pass": return pc.green("✓");
    case "warn": return pc.yellow("⚠");
    case "fail": return pc.red("✗");
    case "skip": return pc.dim("–");
  }
}

function statusLabel(status: CheckStatus): string {
  switch (status) {
    case "pass": return pc.green("pass");
    case "warn": return pc.yellow("warn");
    case "fail": return pc.red("fail");
    case "skip": return pc.dim("skip");
  }
}

function makeCheck(
  name: string,
  status: CheckStatus,
  detail?: string,
  hint?: string,
): DoctorCheck {
  return { name, status, detail, hint };
}

function printCheck(c: DoctorCheck) {
  const line = `${icon(c.status)} ${c.name}${c.detail ? pc.dim("  " + c.detail) : ""}`;
  p.log.info(line);
  if (c.hint && (c.status === "warn" || c.status === "fail")) {
    p.log.info(`  ${pc.dim("→")} ${pc.italic(c.hint)}`);
  }
}

// ---------------------------------------------------------------------------
// Check runners
// ---------------------------------------------------------------------------

async function checkLocalGateway(port: number, checks: DoctorCheck[]) {
  const url = `http://127.0.0.1:${port}/health`;
  const ok = await checkGatewayHealth(url);
  checks.push(
    makeCheck(
      "Local gateway health",
      ok ? "pass" : "fail",
      ok ? `port ${port}` : `no response on port ${port}`,
      ok ? undefined : "Start the gateway: openclaw gateway start",
    ),
  );
}

async function checkTailscale(checks: DoctorCheck[]) {
  const ts = await getTailscaleStatus();
  checks.push(
    makeCheck(
      "Tailscale daemon",
      ts.online ? "pass" : "fail",
      ts.online ? (ts.hostname ?? "online") : "not running or not logged in",
      ts.online ? undefined : "Run: tailscale up",
    ),
  );
  return ts.online;
}

async function checkCapabilities(checks: DoctorCheck[]) {
  const caps = await loadCapabilities();
  if (!caps) {
    checks.push(
      makeCheck(
        "Local capabilities",
        "warn",
        "no scan found",
        "Run: cofounder capabilities scan",
      ),
    );
    return;
  }
  const gpuLabel = caps.gpu?.available
    ? caps.gpu.name ?? "GPU detected"
    : "CPU-only";
  checks.push(
    makeCheck(
      "Local capabilities",
      "pass",
      `${gpuLabel}, ${caps.ollama?.models?.length ?? 0} Ollama model(s)`,
    ),
  );
}

async function checkPeer(
  peerName: string,
  peerEmoji: string,
  tailscaleIp: string,
  sshUser: string | undefined,
  sshKeyPath: string | undefined,
  gatewayPort: number,
  wolEnabled: boolean | undefined,
  tailscaleAvailable: boolean,
  checks: DoctorCheck[],
) {
  const prefix = `${peerEmoji} ${peerName}`;

  if (!tailscaleAvailable) {
    checks.push(makeCheck(`${prefix}: Tailscale reachability`, "skip", "Tailscale not available"));
    checks.push(makeCheck(`${prefix}: SSH`, "skip", "Tailscale not available"));
    checks.push(makeCheck(`${prefix}: Gateway`, "skip", "Tailscale not available"));
    return;
  }

  // Tailscale ping
  const reachable = await pingPeer(tailscaleIp, 6000);
  checks.push(
    makeCheck(
      `${prefix}: Tailscale reachability`,
      reachable ? "pass" : (wolEnabled ? "warn" : "fail"),
      reachable ? tailscaleIp : `${tailscaleIp} unreachable`,
      reachable ? undefined : wolEnabled
        ? "Machine may be sleeping — run: cofounder wake"
        : "Check Tailscale status on the peer machine",
    ),
  );

  // SSH
  if (sshUser && sshKeyPath) {
    const sshOk = await testSSH({ host: tailscaleIp, user: sshUser, keyPath: sshKeyPath });
    checks.push(
      makeCheck(
        `${prefix}: SSH`,
        sshOk ? "pass" : "fail",
        sshOk ? `${sshUser}@${tailscaleIp}` : "connection failed",
        sshOk ? undefined : `Check SSH key and user: ssh -i ${sshKeyPath} ${sshUser}@${tailscaleIp}`,
      ),
    );
  } else {
    checks.push(makeCheck(`${prefix}: SSH`, "skip", "no SSH config"));
  }

  // Peer gateway
  if (reachable) {
    const gwUrl = `http://${tailscaleIp}:${gatewayPort}/health`;
    const gwOk = await checkGatewayHealth(gwUrl);
    checks.push(
      makeCheck(
        `${prefix}: Gateway health`,
        gwOk ? "pass" : "warn",
        gwOk ? `port ${gatewayPort}` : `no response on port ${gatewayPort}`,
        gwOk ? undefined : "Start gateway on peer: openclaw gateway start",
      ),
    );
  } else {
    checks.push(makeCheck(`${prefix}: Gateway health`, "skip", "peer unreachable"));
  }

  // Peer capabilities freshness (single-peer cache store)
  const peerCaps = await loadPeerCapabilities();
  if (!peerCaps) {
    checks.push(
      makeCheck(
        `${prefix}: Cached capabilities`,
        "warn",
        "no cached capability report",
        "Run: cofounder capabilities fetch",
      ),
    );
  } else {
    const stale = isPeerCapabilityStale(peerCaps);
    const gpuLabel = peerCaps.gpu?.available
      ? peerCaps.gpu.name ?? "GPU detected"
      : "CPU-only";
    checks.push(
      makeCheck(
        `${prefix}: Cached capabilities`,
        stale ? "warn" : "pass",
        stale
          ? `stale (${gpuLabel})`
          : `fresh (${gpuLabel}, ${peerCaps.ollama?.models?.length ?? 0} model(s))`,
        stale ? "Run: cofounder capabilities fetch" : undefined,
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function doctor(opts: DoctorOptions = {}) {
  if (!opts.json) {
    p.intro(pc.bgCyan(pc.black(" cofounder doctor ")));
  }

  const config = await loadConfig();
  if (!config) {
    if (opts.json) {
      console.log(JSON.stringify({ error: "no config" }));
    } else {
      p.log.error("No configuration found. Run `cofounder onboard` first.");
    }
    process.exitCode = 1;
    return;
  }

  const checks: DoctorCheck[] = [];
  const gwPort = config.gateway_port ?? 18789;

  // --- Local checks ---
  if (!opts.json) p.log.message(pc.bold("Local node"));
  await checkLocalGateway(gwPort, checks);
  const tsAvailable = await checkTailscale(checks);
  await checkCapabilities(checks);

  // --- Peer checks ---
  const allPeers = getAllPeers(config);
  const targetPeers = opts.peer
    ? [findPeerByName(config, opts.peer)].filter(Boolean) as typeof allPeers
    : allPeers;

  if (opts.peer && targetPeers.length === 0) {
    if (!opts.json) {
      p.log.error(`Unknown peer: ${opts.peer}. Known: ${allPeers.map((p) => p.name).join(", ")}`);
    }
    process.exitCode = 1;
    return;
  }

  for (const peer of targetPeers) {
    if (!opts.json) p.log.message(pc.bold(`Peer: ${peer.emoji ?? "🖥"} ${peer.name}`));
    await checkPeer(
      peer.name,
      peer.emoji ?? "🖥",
      peer.tailscale_ip,
      peer.ssh_user,
      peer.ssh_key_path,
      peer.gateway_port ?? 18789,
      peer.wol_enabled,
      tsAvailable,
      checks,
    );
  }

  // --- Summary ---
  const passed = checks.filter((c) => c.status === "pass").length;
  const warned = checks.filter((c) => c.status === "warn").length;
  const failed = checks.filter((c) => c.status === "fail").length;
  const skipped = checks.filter((c) => c.status === "skip").length;
  const healthy = failed === 0;

  const report: DoctorReport = { checks, passed, warned, failed, skipped, healthy };

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    if (!healthy) process.exitCode = 1;
    return;
  }

  p.log.message("");
  for (const c of checks) {
    printCheck(c);
  }

  p.log.message("");
  const summary = [
    passed > 0 ? pc.green(`${passed} passed`) : null,
    warned > 0 ? pc.yellow(`${warned} warnings`) : null,
    failed > 0 ? pc.red(`${failed} failed`) : null,
    skipped > 0 ? pc.dim(`${skipped} skipped`) : null,
  ]
    .filter(Boolean)
    .join("  ");

  if (healthy) {
    p.outro(pc.green(`✓ Healthy`) + pc.dim("  ") + summary);
  } else {
    p.outro(pc.red(`✗ Issues found`) + pc.dim("  ") + summary);
    process.exitCode = 1;
  }
}
