/**
 * commands/capabilities.ts — `tj capabilities`
 *
 * Manage and query the Jerry capability registry.
 *
 * Subcommands:
 *
 *   tj capabilities scan
 *     Probe this machine and print a capability report.
 *     Does NOT save — use `--save` to persist.
 *
 *   tj capabilities advertise
 *     Scan + save to ~/.tom-and-jerry/capabilities.json.
 *     Jerry should run this after setup and periodically (or via cron).
 *
 *   tj capabilities fetch
 *     Tom fetches Jerry's report via the peer gateway (/capabilities endpoint)
 *     or via SSH fallback, saves to ~/.tom-and-jerry/peer-capabilities.json.
 *
 *   tj capabilities show [--peer]
 *     Print this node's (or peer's) last known capability report.
 *
 *   tj capabilities route "<task>"
 *     Show what routing decision would be made for a given task string,
 *     using stored peer capabilities.
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { loadConfig } from "../config/store.ts";
import {
  scanCapabilities,
  saveCapabilities,
  savePeerCapabilities,
  loadCapabilities,
  loadPeerCapabilities,
  isPeerCapabilityStale,
  type TJCapabilityReport,
} from "@tom-and-jerry/core";
import { routeTask } from "@tom-and-jerry/core";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatReport(report: TJCapabilityReport, label: string): void {
  p.log.info(`${pc.bold(label)} — ${pc.dim(`reported ${formatAge(report.reported_at)}`)}`);
  p.log.info(`  Node:     ${report.node}`);
  p.log.info(`  Platform: ${report.platform}`);

  // GPU
  const gpu = report.gpu;
  if (gpu.available) {
    const vram = gpu.vram_gb ? ` (${gpu.vram_gb} GB VRAM)` : "";
    p.log.info(`  GPU:      ${pc.green("✓")} ${gpu.name ?? "available"}${vram} [${gpu.backend ?? "?"}]`);
  } else {
    p.log.info(`  GPU:      ${pc.dim("none detected")}`);
  }

  // Ollama
  const ollama = report.ollama;
  if (ollama.running) {
    const models = ollama.models.length > 0
      ? ollama.models.join(", ")
      : pc.dim("(no models downloaded)");
    p.log.info(`  Ollama:   ${pc.green("✓")} running at ${ollama.base_url}`);
    p.log.info(`  Models:   ${models}`);
  } else {
    p.log.info(`  Ollama:   ${pc.dim("not running")}`);
  }

  // Skills
  if (report.skills.length > 0) {
    p.log.info(`  Skills:   ${report.skills.map((s) => pc.cyan(s)).join("  ")}`);
  } else {
    p.log.info(`  Skills:   ${pc.dim("none detected")}`);
  }

  // WOL
  p.log.info(`  WOL:      ${report.wol_enabled ? pc.green("✓ enabled") : pc.dim("not configured")}`);

  if (report.notes) {
    p.log.info(`  Notes:    ${pc.italic(report.notes)}`);
  }

  if (report.fetched_at) {
    p.log.info(`  Fetched:  ${formatAge(report.fetched_at)}`);
  }
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 120_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

// ─── Subcommands ─────────────────────────────────────────────────────────────

export async function capabilitiesScan(opts: { save?: boolean; notes?: string } = {}) {
  const config = await loadConfig();

  p.intro(pc.bgCyan(pc.black(" tj capabilities scan ")));

  const s = p.spinner();
  s.start("Probing local capabilities...");

  const report = await scanCapabilities({
    nodeName: config?.this_node.name ?? "local",
    wolEnabled: config?.peer_node.wol?.enabled ?? false,
    notes: opts.notes,
  });

  s.stop("Scan complete.");

  formatReport(report, "Local capabilities");

  if (opts.save) {
    await saveCapabilities(report);
    p.log.success(`Saved → ~/.tom-and-jerry/capabilities.json`);
  } else {
    p.log.info(pc.dim("Use `tj capabilities advertise` to save and share this report."));
  }

  p.outro("");
}

export async function capabilitiesAdvertise(opts: { notes?: string } = {}) {
  const config = await loadConfig();

  if (!config) {
    p.log.error("No configuration found. Run `tj onboard` first.");
    return;
  }

  p.intro(pc.bgCyan(pc.black(" tj capabilities advertise ")));

  const s = p.spinner();
  s.start("Scanning capabilities...");

  const report = await scanCapabilities({
    nodeName: config.this_node.name,
    wolEnabled: config.peer_node.wol?.enabled ?? false,
    notes: opts.notes,
  });

  s.stop("Scan complete.");
  formatReport(report, "Advertising as");

  await saveCapabilities(report);
  p.log.success(`Saved → ~/.tom-and-jerry/capabilities.json`);

  const skillCount = report.skills.length;
  const modelCount = report.ollama.models.length;
  p.log.info(
    skillCount > 0
      ? `${pc.green(String(skillCount))} skill(s) advertised. ${pc.green(String(modelCount))} Ollama model(s).`
      : pc.dim("No skills detected. Your peer will use heuristic routing."),
  );

  p.outro("Done. Tom can now fetch this with `tj capabilities fetch`.");
}

export async function capabilitiesFetch() {
  const config = await loadConfig();

  if (!config) {
    p.log.error("No configuration found. Run `tj onboard` first.");
    return;
  }

  p.intro(pc.bgCyan(pc.black(" tj capabilities fetch ")));

  const peer = config.peer_node;
  const peerPort = peer.gateway_port ?? peer.gateway?.port ?? 18789;
  const capUrl = `http://${peer.tailscale_ip}:${peerPort}/capabilities`;

  const s = p.spinner();
  s.start(`Fetching capabilities from ${peer.name} (${capUrl})...`);

  try {
    const res = await fetch(capUrl, { signal: AbortSignal.timeout(8000) });

    if (!res.ok) {
      s.stop(pc.red(`Gateway returned HTTP ${res.status}`));
      p.log.warn("Peer may not have advertised capabilities yet.");
      p.log.info(`Ask ${peer.name} to run: tj capabilities advertise`);
      p.outro("Fetch failed.");
      return;
    }

    const raw = await res.json();
    const report = (raw as TJCapabilityReport);

    s.stop(pc.green(`✓ Fetched from ${peer.name}`));
    formatReport(report, `${peer.emoji ?? ""} ${peer.name} capabilities`);

    await savePeerCapabilities(report);
    p.log.success("Saved → ~/.tom-and-jerry/peer-capabilities.json");
    p.log.info(pc.dim("`tj send` will now use these capabilities for routing."));

  } catch (err) {
    s.stop(pc.red("Fetch failed"));
    p.log.error(`${err}`);
    p.log.info(`Try: ssh ${peer.ssh_user}@${peer.tailscale_ip} "cat ~/.tom-and-jerry/capabilities.json"`);
  }

  p.outro("");
}

export async function capabilitiesShow(opts: { peer?: boolean } = {}) {
  p.intro(pc.bgCyan(pc.black(" tj capabilities show ")));

  if (opts.peer) {
    const report = await loadPeerCapabilities();
    if (!report) {
      p.log.warn("No peer capability report found. Run `tj capabilities fetch` first.");
      p.outro("");
      return;
    }
    if (isPeerCapabilityStale(report)) {
      p.log.warn(pc.yellow("⚠ Peer capabilities are stale (>24h). Run `tj capabilities fetch` to refresh."));
    }
    formatReport(report, "Peer capabilities (cached)");
  } else {
    const report = await loadCapabilities();
    if (!report) {
      p.log.warn("No capability report found. Run `tj capabilities advertise` first.");
      p.outro("");
      return;
    }
    formatReport(report, "Local capabilities");
  }

  p.outro("");
}

export async function capabilitiesRoute(task: string) {
  p.intro(pc.bgCyan(pc.black(" tj capabilities route ")));

  const peerCaps = await loadPeerCapabilities();

  p.log.info(`Task:  ${pc.italic(task)}`);

  if (peerCaps) {
    const age = isPeerCapabilityStale(peerCaps) ? pc.yellow(" (stale)") : "";
    p.log.info(`Peer:  ${peerCaps.node}${age}`);
  } else {
    p.log.info(pc.dim("No peer capabilities cached — using keyword heuristics."));
  }

  const decision = routeTask(task, peerCaps);
  const hintColor = decision.hint === "jerry-local" ? pc.yellow : pc.cyan;

  p.log.info("");
  p.log.info(`Route:  ${hintColor(pc.bold(decision.hint))}`);
  p.log.info(`Reason: ${decision.reason}`);

  if (decision.suggested_model) {
    p.log.info(`Model:  ${pc.cyan(decision.suggested_model)} (Ollama on peer)`);
  }

  p.outro("");
}
