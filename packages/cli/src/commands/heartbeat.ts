/**
 * commands/heartbeat.ts — `tj heartbeat [send|show]`
 *
 * Manage and display heartbeat state for the Tom/Jerry pair.
 *
 * Subcommands:
 *   tj heartbeat send   — build a HHHeartbeatMessage, deliver via wakeAgent,
 *                         record receipt time in config
 *   tj heartbeat show   — display last heartbeat info (default)
 *
 * The heartbeat payload includes:
 *   - gateway_healthy: whether our local gateway /health is live
 *   - uptime_seconds: process uptime (used as proxy for system uptime)
 *   - tailscale_ip: our Tailscale IP
 *   - model: configured LLM model for this node
 *   - gpu_available: false on Tom (cloud), potentially true on Jerry
 *
 * On receipt, the peer's OpenClaw session (GLaDOS/Calcifer) can run
 * `tj heartbeat record --from <name> --at <iso>` to update its own
 * config's last_heartbeat field. This is the lightweight liveness protocol
 * that `tj status` reads.
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { loadConfig, patchConfig } from "../config/store.ts";
import {
  checkGatewayHealth,
  getTailscaleStatus,
  pingPeer,
  createHeartbeatMessage,
  wakeAgent,
} from "@his-and-hers/core";

export type HeartbeatAction = "send" | "show" | "record";

export interface HeartbeatRecordOptions {
  from?: string;
  at?: string;
}

export async function heartbeat(action: HeartbeatAction = "show", opts: HeartbeatRecordOptions = {}) {
  const config = await loadConfig();

  if (!config) {
    p.log.error("No configuration found. Run `tj onboard` first.");
    process.exitCode = 1;
    return;
  }

  switch (action) {
    case "show":
      return showHeartbeat(config);
    case "send":
      return sendHeartbeat(config);
    case "record":
      return recordHeartbeat(config, opts);
  }
}

// ── show ─────────────────────────────────────────────────────────────────────

function showHeartbeat(config: Awaited<ReturnType<typeof loadConfig>>): void {
  if (!config) return;
  const thisNode = config.this_node;
  const peerNode = config.peer_node;

  p.intro(pc.bgCyan(pc.black(" tj heartbeat ")));

  // This node's last known heartbeat (from pair.last_heartbeat)
  const myLastHb = config.pair?.last_heartbeat;
  const peerLastHb = config.last_heartbeat;

  p.log.info(
    `${thisNode.emoji ?? "🖥"}  ${pc.bold(thisNode.name)} — last heartbeat sent: ${
      myLastHb ? relativeTime(myLastHb) : pc.dim("never")
    }`,
  );
  p.log.info(
    `${peerNode.emoji ?? "🖥"}  ${pc.bold(peerNode.name)} — last heartbeat received: ${
      peerLastHb ? relativeTime(peerLastHb) : pc.dim("never")
    }`,
  );

  if (peerLastHb) {
    const ageSecs = Math.round((Date.now() - new Date(peerLastHb).getTime()) / 1000);
    const interval = config.protocol?.heartbeat_interval_seconds ?? 60;
    if (ageSecs > interval * 3) {
      p.log.warn(
        `Peer heartbeat is ${formatAge(ageSecs)} old — run \`tj heartbeat send\` to check in.`,
      );
    } else {
      p.log.success(`Peer is healthy (last seen ${formatAge(ageSecs)} ago).`);
    }
  }
}

// ── send ─────────────────────────────────────────────────────────────────────

async function sendHeartbeat(config: Awaited<ReturnType<typeof loadConfig>>) {
  if (!config) return;
  const thisNode = config.this_node;
  const peerNode = config.peer_node;

  p.intro(pc.bgCyan(pc.black(" tj heartbeat send ")));

  // 1. Local gateway health
  const gwPort = config.gateway_port ?? 18789;
  const localHealth = await checkGatewayHealth(`http://127.0.0.1:${gwPort}/health`);
  p.log.info(`Local gateway: ${localHealth ? pc.green("healthy") : pc.yellow("not responding")}`);

  // 2. Tailscale status (to get our current IP in case it changed)
  const ts = await getTailscaleStatus();
  const ourIP = ts.tailscaleIP || thisNode.tailscale_ip;

  // 3. Build heartbeat message
  const uptimeSecs = process.uptime();
  const msg = createHeartbeatMessage(thisNode.name, peerNode.name, {
    gateway_healthy: localHealth,
    uptime_seconds: Math.round(uptimeSecs),
    tailscale_ip: ourIP,
    model: thisNode.provider?.model,
    gpu_available: false, // Tom is always cloud; Jerry side sets this
  });

  // 4. Check peer reachability
  const reachS = p.spinner();
  reachS.start(`Pinging ${peerNode.name}...`);
  const reachable = await pingPeer(peerNode.tailscale_ip, 5000);

  if (!reachable) {
    reachS.stop(pc.yellow(`${peerNode.name} is offline — heartbeat will be queued.`));
    // Still update our own "sent" timestamp so `tj status` knows we tried
    await patchConfig({
      pair: {
        ...(config.pair ?? {
          established_at: new Date().toISOString(),
          pairing_code_hash: "",
          trusted: false,
        }),
        last_heartbeat: new Date().toISOString(),
      },
    });
    p.outro("Heartbeat recorded locally. Peer was offline.");
    return;
  }
  reachS.stop(pc.green(`✓ ${peerNode.name} is reachable`));

  // 5. Check peer gateway
  const peerPort = peerNode.gateway_port ?? 18789;
  const peerHealthy = await checkGatewayHealth(
    `http://${peerNode.tailscale_ip}:${peerPort}/health`,
  );
  if (!peerHealthy) {
    p.log.warn(`Peer gateway not responding on port ${peerPort} — cannot deliver heartbeat.`);
    await patchConfig({
      pair: {
        ...(config.pair ?? {
          established_at: new Date().toISOString(),
          pairing_code_hash: "",
          trusted: false,
        }),
        last_heartbeat: new Date().toISOString(),
      },
    });
    p.outro("Peer Tailscale reachable but gateway offline.");
    return;
  }

  // 6. Deliver via wakeAgent
  if (!peerNode.gateway_token) {
    p.log.error("Peer gateway token not set. Run `tj pair` to exchange tokens.");
    process.exitCode = 1;
    return;
  }

  const sendS = p.spinner();
  sendS.start("Delivering heartbeat...");

  // Format heartbeat as a human-readable + machine-readable wake text so
  // the peer's OpenClaw session can parse it and run `tj heartbeat record`
  const wakeText =
    `[HHHeartbeat from ${msg.from}] ` +
    `gateway=${msg.payload.gateway_healthy} ` +
    `uptime=${msg.payload.uptime_seconds}s ` +
    `model=${msg.payload.model ?? "unknown"} ` +
    `ip=${msg.payload.tailscale_ip} ` +
    `at=${msg.timestamp}`;

  const wakeResult = await wakeAgent({
    url: `ws://${peerNode.tailscale_ip}:${peerPort}`,
    token: peerNode.gateway_token,
    text: wakeText,
    mode: "now",
  });

  if (wakeResult.ok) {
    sendS.stop(pc.green(`✓ Heartbeat delivered to ${peerNode.name}`));
  } else {
    sendS.stop(pc.yellow(`Delivery failed: ${wakeResult.error}`));
  }

  // 7. Update our sent-at timestamp
  await patchConfig({
    pair: {
      ...(config.pair ?? {
        established_at: new Date().toISOString(),
        pairing_code_hash: "",
        trusted: false,
      }),
      last_heartbeat: new Date().toISOString(),
    },
  });

  p.outro(wakeResult.ok ? `Heartbeat sent to ${peerNode.name}.` : "Heartbeat attempted (delivery uncertain).");
}

// ── record ───────────────────────────────────────────────────────────────────

async function recordHeartbeat(
  config: Awaited<ReturnType<typeof loadConfig>>,
  opts: HeartbeatRecordOptions,
) {
  if (!config) return;
  const fromName = opts.from ?? "peer";
  const at = opts.at ?? new Date().toISOString();

  await patchConfig({ last_heartbeat: at });

  p.log.success(
    `Heartbeat from ${pc.bold(fromName)} recorded at ${pc.dim(at)}`,
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const ageSecs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  return `${formatAge(ageSecs)} ago (${new Date(iso).toLocaleTimeString()})`;
}

function formatAge(secs: number): string {
  if (secs < 120) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  return `${(secs / 3600).toFixed(1)}h`;
}
